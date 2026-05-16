import {
  deleteMedia as dbDeleteMedia,
  getAllMedia as dbGetAllMedia,
  getMedia as dbGetMedia,
  getMediaByContentHash,
  getMediaBySourceUrl,
  getMeta,
  putMedia,
  putMeta
} from "../lib/db.js";
import { inferCategory, createEmptyRules, trainRules } from "../lib/classifier.js";
import { extensionApi, makeDownloadName } from "../lib/utils.js";
import { blobToDataUrl, computeContentHash } from "./utils.js";

const MODEL_PATH = "src/models/mobilenet-v2-050/model.json";

const DEFAULT_FILTER_CONFIG = {
  minWidth: 80,
  minHeight: 60,
  minArea: 5000,
  minRatio: 0.22,
  maxRatio: 4.8,
  minFileSize: 10_240
};

async function classifyWithVision(media) {
  if (media.type !== "image") {
    return null;
  }

  try {
    const aiRuntime = await import("../generated/ai.bundle.js");
    return await aiRuntime.classifyImageBlob(
      media.blob,
      extensionApi.runtime.getURL(MODEL_PATH)
    );
  } catch (error) {
    console.warn("MaterialBox local AI unavailable", error);
    return null;
  }
}

async function classifyInPageContext(tabId, blob, mediaType) {
  if (!tabId || mediaType !== "image") {
    return null;
  }

  try {
    const dataUrl = await blobToDataUrl(blob);
    const response = await extensionApi.tabs.sendMessage(tabId, {
      type: "CLASSIFY_BLOB_IN_PAGE",
      dataUrl
    });
    return response?.ok ? response.result : null;
  } catch (error) {
    console.warn("MaterialBox page-side classification unavailable", error);
    return null;
  }
}

async function fetchAsBlob(sourceUrl) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status}`);
  }
  return response.blob();
}

function looksLikeGarbageUrl(sourceUrl = "") {
  return /(sprite|spacer|blank|pixel|tracker|beacon|emoji|avatar|favicon|badge|placeholder)/i.test(sourceUrl);
}

async function isUsefulFetchedMedia(payload, blob) {
  const config = await getFilterConfig();

  if (payload.type === "image") {
    if ((payload.width ?? 0) < config.minWidth || (payload.height ?? 0) < config.minHeight) {
      return false;
    }
    if ((payload.width ?? 0) * (payload.height ?? 0) < config.minArea) {
      return false;
    }
    const ratio = (payload.width ?? 1) / Math.max(payload.height ?? 1, 1);
    if (ratio > config.maxRatio || ratio < config.minRatio) {
      return false;
    }
    if (looksLikeGarbageUrl(payload.sourceUrl) && (payload.width ?? 0) <= 320 && (payload.height ?? 0) <= 320) {
      return false;
    }
    if (blob.size < config.minFileSize && !payload.mimeType?.includes("svg") && !blob.type.includes("svg")) {
      return false;
    }
  }

  if (payload.type === "video") {
    if ((payload.width ?? 0) < 240 || (payload.height ?? 0) < 135) {
      return false;
    }
    if (blob.size < 65_536) {
      return false;
    }
  }

  return true;
}

async function getRules() {
  return (await getMeta("classificationRules", createEmptyRules())) ?? createEmptyRules();
}

export async function saveFromSource(payload) {
  const blob = payload.blob ?? await fetchAsBlob(payload.sourceUrl);
  if (!await isUsefulFetchedMedia(payload, blob)) {
    return { saved: false, filtered: true, item: null };
  }

  const contentHash = await computeContentHash(blob);
  const duplicate = await getMediaBySourceUrl(payload.sourceUrl) ?? await getMediaByContentHash(contentHash);
  if (duplicate) {
    return { saved: false, filtered: false, item: duplicate, deduped: true };
  }

  const rules = await getRules();
  const media = {
    id: crypto.randomUUID(),
    blob,
    type: payload.type,
    mimeType: blob.type || payload.mimeType || "",
    sourceUrl: payload.sourceUrl,
    pageUrl: payload.pageUrl ?? "",
    pageTitle: payload.pageTitle ?? "",
    title: payload.title ?? payload.fileName ?? "",
    alt: payload.alt ?? "",
    width: payload.width ?? 0,
    height: payload.height ?? 0,
    tags: payload.tags ?? [],
    contentHash,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const ruleAi = inferCategory(media, rules);
  const pageAi = await classifyInPageContext(payload.tabId, blob, payload.type);
  const visionAi = pageAi ?? await classifyWithVision({ ...media, blob });
  media.category = visionAi?.label ?? ruleAi.label;
  media.ai = {
    ...ruleAi,
    provider: visionAi?.provider ?? "rules",
    imagePredictions: visionAi?.predictions ?? [],
    visionCategory: visionAi?.label ?? null,
    visionConfidence: visionAi?.confidence ?? null
  };

  await putMedia(media);
  return { saved: true, filtered: false, item: media, deduped: false };
}

export async function saveMany(items) {
  const savedItems = [];
  let filteredCount = 0;
  for (const item of items) {
    try {
      const result = await saveFromSource(item);
      if (result.item) {
        savedItems.push(result.item);
      }
      if (result.filtered) {
        filteredCount += 1;
      }
    } catch (error) {
      console.warn("MaterialBox save failed", item.sourceUrl, error);
    }
  }
  return { savedItems, filteredCount };
}

export async function deleteMedia(id) {
  await dbDeleteMedia(id);
}

export async function deleteMediaBatch(ids) {
  for (const id of ids) {
    await dbDeleteMedia(id);
  }
}

export async function getMedia(id) {
  return dbGetMedia(id);
}

export async function getAllMedia() {
  return dbGetAllMedia();
}

export async function updateCategory(id, category) {
  const item = await dbGetMedia(id);
  if (!item) {
    return null;
  }

  const rules = await getRules();
  const updatedRules = trainRules(item, category, rules);
  const ai = inferCategory(item, updatedRules);
  item.category = category;
  item.ai = {
    ...ai,
    manualOverride: true
  };
  item.updatedAt = Date.now();

  await putMeta("classificationRules", updatedRules);
  await putMedia(item);

  return item;
}

export async function exportMedia(ids) {
  for (const id of ids) {
    const item = await dbGetMedia(id);
    if (!item) {
      continue;
    }
    const dataUrl = await blobToDataUrl(item.blob);
    await extensionApi.downloads.download({
      url: dataUrl,
      filename: makeDownloadName(item),
      saveAs: true
    });
  }
}

export async function exportMediaAsZip(ids) {
  const items = [];
  for (const id of ids) {
    const item = await dbGetMedia(id);
    if (item) {
      items.push(item);
    }
  }
  if (!items.length) {
    return;
  }

  const exporter = await import("../generated/export.bundle.js");
  const zipBlob = await exporter.buildZipBlob(items);
  const dataUrl = await blobToDataUrl(zipBlob);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  await extensionApi.downloads.download({
    url: dataUrl,
    filename: `materialbox-export-${timestamp}.zip`,
    saveAs: true
  });
}

export async function getRulesSummary() {
  const rules = await getRules();
  const categories = Object.keys(rules.learned ?? {});
  return {
    categories,
    tokenCount: categories.reduce(
      (sum, category) => sum + Object.keys(rules.learned[category] ?? {}).length,
      0
    )
  };
}

export async function getAiStatus() {
  try {
    const aiRuntime = await import("../generated/ai.bundle.js");
    return await aiRuntime.getModelMeta(extensionApi.runtime.getURL(MODEL_PATH));
  } catch (error) {
    throw new Error(error.message);
  }
}

export async function getFilterConfig() {
  const config = await getMeta("filterConfig", DEFAULT_FILTER_CONFIG);
  return config ?? DEFAULT_FILTER_CONFIG;
}

export async function updateFilterConfig(updates) {
  const current = await getFilterConfig();
  const updated = { ...current, ...updates };
  await putMeta("filterConfig", updated);
  return updated;
}
