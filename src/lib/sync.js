import { guessExtension } from "./utils.js";

function toUtf8Bytes(value) {
  return new TextEncoder().encode(value);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : typeof value === "string"
      ? toUtf8Bytes(value)
      : new Uint8Array(await value.arrayBuffer());
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function hmac(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, typeof value === "string" ? toUtf8Bytes(value) : value));
}

function formatAmzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8)
  };
}

function normalizePath(value = "") {
  return String(value).replace(/^\/+|\/+$/g, "");
}

function normalizeEndpoint(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function encodeKeySegments(key) {
  return key.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
}

function getBlobKey(prefix, item) {
  const ext = guessExtension(item.mimeType, item.sourceUrl);
  const baseName = item.contentHash || item.id;
  const safePrefix = normalizePath(prefix);
  return `${safePrefix ? `${safePrefix}/` : ""}blobs/${baseName}.${ext}`;
}

async function signS3Request(settings, method, key, body, contentType = "application/octet-stream") {
  const endpoint = normalizeEndpoint(settings.s3.endpoint);
  const bucket = normalizePath(settings.s3.bucket);
  const objectKey = `${bucket}/${normalizePath(key)}`;
  const encodedPath = `/${encodeKeySegments(objectKey)}`;
  const url = new URL(endpoint.toString());
  url.pathname = `${endpoint.pathname}${encodedPath}`;

  const { amzDate, dateStamp } = formatAmzDate();
  const payloadHash = await sha256Hex(body ?? "");
  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`
  ].join("\n");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    encodedPath,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash
  ].join("\n");
  const region = settings.s3.region || "us-east-1";
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = await hmac(toUtf8Bytes(`AWS4${settings.s3.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const headers = {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${settings.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };

  if (body) {
    headers["content-type"] = contentType;
  }

  return { url, headers };
}

async function s3Request(settings, method, key, body, contentType) {
  const { url, headers } = await signS3Request(settings, method, key, body, contentType);
  const response = await fetch(url, {
    method,
    headers,
    body
  });
  if (!response.ok) {
    throw new Error(`S3 ${method} failed with HTTP ${response.status}`);
  }
  return response;
}

async function ensureWebDavCollection(baseUrl, path, settings) {
  const segments = normalizePath(path).split("/").filter(Boolean);
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const url = new URL(currentPath, baseUrl).toString();
    const response = await fetch(url, { method: "MKCOL", headers: getWebDavHeaders(settings) });
    if (!response.ok && ![301, 405].includes(response.status)) {
      throw new Error(`WebDAV MKCOL failed with HTTP ${response.status}`);
    }
  }
}

function getWebDavHeaders(settings, contentType) {
  const headers = {};
  if (settings.webdav.username || settings.webdav.password) {
    headers.Authorization = `Basic ${btoa(`${settings.webdav.username}:${settings.webdav.password}`)}`;
  }
  if (contentType) {
    headers["content-type"] = contentType;
  }
  return headers;
}

async function webDavPut(settings, key, body, contentType) {
  const baseUrl = settings.webdav.url.endsWith("/") ? settings.webdav.url : `${settings.webdav.url}/`;
  const normalizedPath = normalizePath(settings.webdav.path);
  if (normalizedPath) {
    await ensureWebDavCollection(baseUrl, normalizedPath, settings);
    await ensureWebDavCollection(baseUrl, `${normalizedPath}/blobs`, settings);
  }
  const response = await fetch(new URL(`${normalizePath(key)}`, baseUrl), {
    method: "PUT",
    headers: getWebDavHeaders(settings, contentType),
    body
  });
  if (!response.ok) {
    throw new Error(`WebDAV PUT failed with HTTP ${response.status}`);
  }
}

async function webDavGet(settings, key) {
  const baseUrl = settings.webdav.url.endsWith("/") ? settings.webdav.url : `${settings.webdav.url}/`;
  const response = await fetch(new URL(`${normalizePath(key)}`, baseUrl), {
    method: "GET",
    headers: getWebDavHeaders(settings)
  });
  if (!response.ok) {
    throw new Error(`WebDAV GET failed with HTTP ${response.status}`);
  }
  return response;
}

function getManifestKey(settings) {
  if (settings.provider === "s3") {
    const prefix = normalizePath(settings.s3.prefix);
    return `${prefix ? `${prefix}/` : ""}index.json`;
  }
  const path = normalizePath(settings.webdav.path);
  return `${path ? `${path}/` : ""}index.json`;
}

export async function uploadSyncArchive(settings, payload) {
  const manifestItems = [];
  for (const item of payload.items) {
    const blobKey = getBlobKey(
      settings.provider === "s3" ? settings.s3.prefix : settings.webdav.path,
      item
    );
    if (settings.provider === "s3") {
      await s3Request(settings, "PUT", blobKey, item.blob, item.mimeType || "application/octet-stream");
    } else {
      await webDavPut(settings, blobKey, item.blob, item.mimeType || "application/octet-stream");
    }
    manifestItems.push({
      id: item.id,
      type: item.type,
      mimeType: item.mimeType,
      sourceUrl: item.sourceUrl,
      pageUrl: item.pageUrl,
      pageTitle: item.pageTitle,
      title: item.title,
      alt: item.alt,
      width: item.width,
      height: item.height,
      category: item.category,
      ai: item.ai,
      tags: item.tags,
      contentHash: item.contentHash,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      blobKey
    });
  }

  const manifest = JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    rules: payload.rules,
    items: manifestItems
  });

  const manifestKey = getManifestKey(settings);
  if (settings.provider === "s3") {
    await s3Request(settings, "PUT", manifestKey, manifest, "application/json");
  } else {
    await webDavPut(settings, manifestKey, manifest, "application/json");
  }

  return manifestItems.length;
}

export async function downloadSyncArchive(settings) {
  const manifestKey = getManifestKey(settings);
  const manifestResponse = settings.provider === "s3"
    ? await s3Request(settings, "GET", manifestKey)
    : await webDavGet(settings, manifestKey);
  const manifest = await manifestResponse.json();
  const items = [];

  for (const entry of manifest.items ?? []) {
    const blobResponse = settings.provider === "s3"
      ? await s3Request(settings, "GET", entry.blobKey)
      : await webDavGet(settings, entry.blobKey);
    const blob = await blobResponse.blob();
    items.push({
      ...entry,
      blob
    });
  }

  return {
    items,
    rules: manifest.rules ?? null
  };
}

export async function testSyncConnection(settings) {
  const probeName = `probe-${Date.now()}.txt`;
  const probeBody = "materialbox-sync-probe";
  if (settings.provider === "s3") {
    const prefix = normalizePath(settings.s3.prefix);
    const key = `${prefix ? `${prefix}/` : ""}${probeName}`;
    await s3Request(settings, "PUT", key, probeBody, "text/plain");
    await s3Request(settings, "DELETE", key);
    return true;
  }

  const basePath = normalizePath(settings.webdav.path);
  if (basePath) {
    await ensureWebDavCollection(settings.webdav.url.endsWith("/") ? settings.webdav.url : `${settings.webdav.url}/`, basePath, settings);
  }
  const key = `${basePath ? `${basePath}/` : ""}${probeName}`;
  await webDavPut(settings, key, probeBody, "text/plain");
  const baseUrl = settings.webdav.url.endsWith("/") ? settings.webdav.url : `${settings.webdav.url}/`;
  const response = await fetch(new URL(key, baseUrl), {
    method: "DELETE",
    headers: getWebDavHeaders(settings)
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`WebDAV DELETE failed with HTTP ${response.status}`);
  }
  return true;
}
