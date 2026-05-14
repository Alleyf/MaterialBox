import { getAllMedia, getMeta, putMedia, putMeta, getTags, addTag, removeTag, addTagToMedia, removeTagFromMedia, getCollections, createCollection, updateCollection, deleteCollection, addToCollection, removeFromCollection, getCollectionItems } from "../lib/db.js";
import { createLazyLoader } from "../lib/lazyload.js";
import { inferCategory } from "../lib/classifier.js";
import { getCategoryOptions, getLanguage, setLanguage, t } from "../lib/i18n.js";
import { classifyImageBlobInPage } from "../lib/page-classifier.js";
import { showToast } from "../lib/toast.js";
import { extensionApi, formatBytes, formatDate } from "../lib/utils.js";
import { createShortcutHandler } from "../lib/shortcuts.js";
import { createHistoryManager, createBatchAction } from "../lib/history.js";

const state = {
  language: "en",
  items: [],
  search: "",
  category: "all",
  mediaType: "all",
  rulesSummary: { categories: [], tokenCount: 0 },
  aiStatus: null,
  selectedIds: new Set(),
  exportDirectoryHandle: null,
  exportDirectoryName: "",
  syncSettings: createDefaultSyncSettings(),
  focusedIndex: -1,
  commandPaletteOpen: false,
  history: createHistoryManager(),
  tags: [],
  selectedTag: "all",
  advancedFilters: {
    dateFrom: null,
    dateTo: null,
    sourceDomain: "",
    minWidth: null,
    maxWidth: null
  },
  collections: [],
  selectedCollection: null
};

function createDefaultSyncSettings() {
  return {
    provider: "none",
    s3: {
      endpoint: "",
      bucket: "",
      region: "us-east-1",
      accessKeyId: "",
      secretAccessKey: "",
      prefix: "materialbox"
    },
    webdav: {
      url: "",
      username: "",
      password: "",
      path: "materialbox"
    }
  };
}

function mergeSyncSettings(value = {}) {
  const defaults = createDefaultSyncSettings();
  return {
    provider: value.provider ?? defaults.provider,
    s3: {
      ...defaults.s3,
      ...(value.s3 ?? {})
    },
    webdav: {
      ...defaults.webdav,
      ...(value.webdav ?? {})
    }
  };
}

function matchesFilters(item) {
  const needle = state.search.trim().toLowerCase();
  const haystack = [
    item.title,
    item.pageTitle,
    item.sourceUrl,
    item.pageUrl,
    item.category,
    ...(item.tags ?? [])
  ].join(" ").toLowerCase();

  if (needle && !haystack.includes(needle)) {
    return false;
  }
  if (state.category !== "all" && item.category !== state.category) {
    return false;
  }
  if (state.mediaType !== "all" && item.type !== state.mediaType) {
    return false;
  }
  if (state.selectedTag !== "all" && (!item.tags || !item.tags.includes(state.selectedTag))) {
    return false;
  }
  
  const { dateFrom, dateTo, sourceDomain, minWidth, maxWidth } = state.advancedFilters;
  
  if (dateFrom) {
    const itemDate = new Date(item.createdAt).setHours(0, 0, 0, 0);
    const fromDate = new Date(dateFrom).getTime();
    if (itemDate < fromDate) return false;
  }
  
  if (dateTo) {
    const itemDate = new Date(item.createdAt).setHours(23, 59, 59, 999);
    const toDate = new Date(dateTo).getTime();
    if (itemDate > toDate) return false;
  }
  
  if (sourceDomain) {
    try {
      const url = new URL(item.sourceUrl);
      if (!url.hostname.includes(sourceDomain.toLowerCase())) {
        return false;
      }
    } catch {
      return false;
    }
  }
  
  if (minWidth && item.width < minWidth) {
    return false;
  }
  
  if (maxWidth && item.width > maxWidth) {
    return false;
  }
  
  return true;
}

function getVisibleItems() {
  let items = state.items.filter(matchesFilters);
  
  if (state.selectedCollection) {
    const collection = state.collections.find(c => c.id === state.selectedCollection);
    if (collection) {
      if (collection.isSmart && collection.rules) {
        items = items.filter(item => {
          if (collection.rules.category && item.category !== collection.rules.category) return false;
          if (collection.rules.type && item.type !== collection.rules.type) return false;
          if (collection.rules.sourceDomain) {
            try {
              const url = new URL(item.sourceUrl);
              if (!url.hostname.includes(collection.rules.sourceDomain)) return false;
            } catch {
              return false;
            }
          }
          return true;
        });
      } else {
        const collectionIds = new Set(collection.items);
        items = items.filter(item => collectionIds.has(item.id));
      }
    }
  }
  
  return items;
}

function getCategoryCounts() {
  const counts = new Map();
  for (const item of state.items) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return counts;
}

function createPreviewUrl(item) {
  return URL.createObjectURL(item.blob);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function setFeedback(message = "") {
  safeSet("feedback", message);
}

function showDashboardToast(message, tone = "success", duration = 2600) {
  showToast({
    title: "MaterialBox",
    message,
    tone,
    duration
  });
}

function safeName(value) {
  return String(value ?? "material")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "material";
}

function guessExtension(item) {
  const mimeMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv"
  };
  return mimeMap[item.mimeType] ?? "bin";
}

function buildItemFilename(item, suffix = "") {
  const suffixPart = suffix ? `-${safeName(suffix)}` : "";
  return `${safeName(item.title || item.pageTitle || item.id)}${suffixPart}-${item.id}.${guessExtension(item)}`;
}

async function ensureDirectoryPermission(handle) {
  if (!handle?.queryPermission || !handle?.requestPermission) {
    return false;
  }
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") {
    return true;
  }
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

async function writeFileToDirectory(handle, filename, blob) {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function downloadBlobFallback(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function exportBlobFromPage(blob, filename) {
  if (state.exportDirectoryHandle && await ensureDirectoryPermission(state.exportDirectoryHandle)) {
    await writeFileToDirectory(state.exportDirectoryHandle, filename, blob);
    setFeedback(t(state.language, "savedToFolder", { name: state.exportDirectoryName }));
    showDashboardToast(t(state.language, "savedToFolder", { name: state.exportDirectoryName }));
    return true;
  }

  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      startIn: "documents"
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    setFeedback(t(state.language, "savedFile", { name: filename }));
    showDashboardToast(t(state.language, "savedFile", { name: filename }));
    return true;
  }

  downloadBlobFallback(blob, filename);
  setFeedback(t(state.language, "downloadedFile", { name: filename }));
  showDashboardToast(t(state.language, "downloadedFile", { name: filename }));
  return true;
}

async function computeContentHash(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hashBuffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas, mimeType, quality) {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Canvas export failed"));
      }
    }, mimeType, quality);
  });
}

async function saveDerivedItem(blob, baseItem, suffix, mimeType, mediaType = baseItem.type) {
  const ruleAi = inferCategory({
    ...baseItem,
    mimeType,
    type: mediaType,
    sourceUrl: `derived://${baseItem.id}/${suffix}`
  });
  const visionAi = mediaType === "image"
    ? await classifyImageBlobInPage(blob).catch(() => null)
    : null;

  const newItem = {
    id: crypto.randomUUID(),
    blob,
    type: mediaType,
    mimeType,
    sourceUrl: `derived://${baseItem.id}/${suffix}`,
    pageUrl: baseItem.pageUrl,
    pageTitle: baseItem.pageTitle,
    title: `${baseItem.title || baseItem.pageTitle || "material"} · ${suffix}`,
    alt: baseItem.alt ?? "",
    width: baseItem.width ?? 0,
    height: baseItem.height ?? 0,
    category: visionAi?.label ?? ruleAi.label,
    ai: {
      ...ruleAi,
      provider: visionAi?.provider ?? "rules",
      imagePredictions: visionAi?.predictions ?? [],
      visionCategory: visionAi?.label ?? null,
      visionConfidence: visionAi?.confidence ?? null
    },
    tags: baseItem.tags ?? [],
    contentHash: await computeContentHash(blob),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await putMedia(newItem);
  await loadData();
  const message = t(state.language, "derivedSaved", { suffix });
  setFeedback(message);
  showDashboardToast(message);
}

function parseAspectRatio(value) {
  if (value === "free") {
    return null;
  }
  const [width, height] = value.split(":").map(Number);
  return width && height ? width / height : null;
}

async function processImageVariant(item, options) {
  const bitmap = await createImageBitmap(item.blob);
  const aspectRatio = parseAspectRatio(options.aspectRatio);
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;
  let sourceX = 0;
  let sourceY = 0;

  const editorState = options.editorState ?? { zoom: 1, focalX: 0.5, focalY: 0.5 };
  const zoom = Math.max(1, Number(editorState.zoom) || 1);

  if (aspectRatio) {
    const currentRatio = bitmap.width / bitmap.height;
    if (currentRatio > aspectRatio) {
      sourceWidth = bitmap.height * aspectRatio;
    } else {
      sourceHeight = bitmap.width / aspectRatio;
    }
  }

  sourceWidth /= zoom;
  sourceHeight /= zoom;
  sourceX = (Number(editorState.focalX) || 0.5) * bitmap.width - sourceWidth / 2;
  sourceY = (Number(editorState.focalY) || 0.5) * bitmap.height - sourceHeight / 2;
  sourceX = Math.max(0, Math.min(sourceX, bitmap.width - sourceWidth));
  sourceY = Math.max(0, Math.min(sourceY, bitmap.height - sourceHeight));

  const targetWidth = Math.min(Number(options.maxWidth) || sourceWidth, sourceWidth);
  const targetHeight = Math.round((sourceHeight / sourceWidth) * targetWidth);
  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight
  );
  bitmap.close();

  const mimeType = options.format === "png"
    ? "image/png"
    : options.format === "jpeg"
      ? "image/jpeg"
      : "image/webp";
  const blob = await canvasToBlob(canvas, mimeType, options.quality);

  return {
    blob,
    mimeType
  };
}

async function loadVideoElement(blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("Video metadata load failed"));
  });
  return { video, url };
}

async function processVideoClip(item, options) {
  const { video, url } = await loadVideoElement(item.blob);
  const start = Math.max(0, Math.min(Number(options.startTime) || 0, video.duration));
  const end = Math.max(start + 0.25, Math.min(Number(options.endTime) || video.duration, video.duration));
  const bitrate = Number(options.bitrate) || 2500000;
  const stream = video.captureStream();
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const chunks = [];

  await new Promise((resolve, reject) => {
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: bitrate
    });

    recorder.ondataavailable = (event) => {
      if (event.data?.size) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => reject(new Error("Video recording failed"));
    recorder.onstop = resolve;

    const stopRecording = () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      video.pause();
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };

    const handleTimeUpdate = () => {
      if (video.currentTime >= end) {
        stopRecording();
      }
    };

    video.currentTime = start;
    video.addEventListener("seeked", async function onSeeked() {
      video.removeEventListener("seeked", onSeeked);
      video.addEventListener("timeupdate", handleTimeUpdate);
      recorder.start();
      await video.play();
    });
  });

  URL.revokeObjectURL(url);

  return {
    blob: new Blob(chunks, { type: "video/webm" }),
    mimeType: "video/webm"
  };
}

function renderDirectorySummary() {
  const summary = document.getElementById("directory-summary");
  if (state.exportDirectoryName) {
    summary.textContent = t(state.language, "currentDirectory", { name: state.exportDirectoryName });
    return;
  }
  summary.textContent = t(state.language, "defaultDirectory");
}

function safeSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderFilters() {
  const categoryFilter = document.getElementById("category-filter");
  const languageSelect = document.getElementById("language-select-element");
  const searchInput = document.getElementById("search");
  const tabs = [...document.querySelectorAll(".tab")];
  const selectionCount = state.selectedIds.size;

  languageSelect.value = state.language;
  searchInput.placeholder = t(state.language, "searchPlaceholder");
  safeSet("import-btn", t(state.language, "importMedia"));
  safeSet("export-btn", t(state.language, "exportFiltered"));
  safeSet("smart-classify-btn", t(state.language, "smartClassify"));
  safeSet("select-visible-btn", t(state.language, "selectVisible"));
  safeSet("choose-directory-btn", t(state.language, "chooseFolder"));
  safeSet("clear-directory-btn", t(state.language, "clearFolder"));
  safeSet("export-directory-title", t(state.language, "exportDirectory"));
  safeSet("workspace-tools-title", t(state.language, "workspaceTools"));
  safeSet("workspace-tools-copy", t(state.language, "workspaceToolsCopy"));
  safeSet("sync-open-btn", t(state.language, "syncPanel"));
  safeSet("sync-panel-title", t(state.language, "syncPanel"));
  safeSet("sync-panel-copy", t(state.language, "syncPanelCopy"));
  safeSet("sync-panel-hint", t(state.language, "syncProviderHint"));
  safeSet("sync-provider-label", t(state.language, "syncProvider"));
  const _el = document.querySelector('#sync-provider-select option[value="none"]');
if (_el) _el.textContent = t(state.language, "syncNone");
  const _el = document.querySelector('#sync-provider-select option[value="s3"]');
if (_el) _el.textContent = t(state.language, "syncS3");
  const _el = document.querySelector('#sync-provider-select option[value="webdav"]');
if (_el) _el.textContent = t(state.language, "syncWebdav");
  safeSet("sync-s3-endpoint-label", t(state.language, "s3Endpoint"));
  safeSet("sync-s3-bucket-label", t(state.language, "s3Bucket"));
  safeSet("sync-s3-region-label", t(state.language, "s3Region"));
  safeSet("sync-s3-access-label", t(state.language, "s3AccessKey"));
  safeSet("sync-s3-secret-label", t(state.language, "s3SecretKey"));
  safeSet("sync-s3-prefix-label", t(state.language, "s3Prefix"));
  safeSet("sync-webdav-url-label", t(state.language, "webdavUrl"));
  safeSet("sync-webdav-user-label", t(state.language, "webdavUser"));
  safeSet("sync-webdav-pass-label", t(state.language, "webdavPass"));
  safeSet("sync-webdav-path-label", t(state.language, "webdavPath"));
  safeSet("sync-save-btn", t(state.language, "syncSave"));
  safeSet("sync-test-btn", t(state.language, "syncTest"));
  safeSet("sync-upload-btn", t(state.language, "syncUpload"));
  safeSet("sync-download-btn", t(state.language, "syncDownload"));
  safeSet("studio-panel-title", t(state.language, "studioPanel"));
  safeSet("studio-panel-copy", t(state.language, "studioPanelCopy"));
  safeSet("studio-panel-hint", t(state.language, "studioPanelHint"));
  safeSet("command-search-label", t(state.language, "commandSearch"));
  safeSet("view-pill", t(state.language, "localStudioPill"));
  safeSet("smart-categories-title", t(state.language, "smartCategories"));
  safeSet("clear-selection-btn", selectionCount
    ? `${t(state.language, "clearSelection")} (${selectionCount})`
    : t(state.language, "clearSelection"));
  safeSet("delete-selected-btn", selectionCount
    ? `${t(state.language, "deleteSelected")} (${selectionCount})`
    : t(state.language, "deleteSelected"));

  tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.type === state.mediaType);
  });
  const _el = document.querySelector('[data-type="all"]');
if (_el) _el.textContent = t(state.language, "tabAll");
  const _el = document.querySelector('[data-type="image"]');
if (_el) _el.textContent = t(state.language, "tabImage");
  const _el = document.querySelector('[data-type="video"]');
if (_el) _el.textContent = t(state.language, "tabVideo");

  categoryFilter.innerHTML = [
    `<option value="all">${t(state.language, "allCategories")}</option>`,
    ...getCategoryOptions(state.language).map(
      (option) => `<option value="${option.value}">${option.label}</option>`
    )
  ].join("");
  categoryFilter.value = state.category;
}

function renderSyncSettings() {
  const { provider, s3, webdav } = state.syncSettings;
  document.getElementById("sync-provider-select").value = provider;
  document.getElementById("sync-s3-endpoint").value = s3.endpoint ?? "";
  document.getElementById("sync-s3-bucket").value = s3.bucket ?? "";
  document.getElementById("sync-s3-region").value = s3.region ?? "";
  document.getElementById("sync-s3-access").value = s3.accessKeyId ?? "";
  document.getElementById("sync-s3-secret").value = s3.secretAccessKey ?? "";
  document.getElementById("sync-s3-prefix").value = s3.prefix ?? "";
  document.getElementById("sync-webdav-url").value = webdav.url ?? "";
  document.getElementById("sync-webdav-user").value = webdav.username ?? "";
  document.getElementById("sync-webdav-pass").value = webdav.password ?? "";
  document.getElementById("sync-webdav-path").value = webdav.path ?? "";
  document.getElementById("sync-s3-fields").hidden = provider !== "s3";
  document.getElementById("sync-webdav-fields").hidden = provider !== "webdav";
}

function renderCategoryChips() {
  const counts = getCategoryCounts();
  const visibleCount = getVisibleItems().length;
  const chipHost = document.getElementById("category-chips");
  const summary = document.getElementById("category-summary");
  const options = getCategoryOptions(state.language)
    .filter((option) => (counts.get(option.value) ?? 0) > 0);

  summary.textContent = `${options.length} categories · ${visibleCount} visible`;
  chipHost.innerHTML = `
    <button class="category-chip ${state.category === "all" ? "is-active" : ""}" data-category="all">
      <span>${t(state.language, "allCategories")}</span>
      <strong>${state.items.length}</strong>
    </button>
    ${options.map((option) => `
      <button
        class="category-chip ${state.category === option.value ? "is-active" : ""}"
        data-category="${option.value}"
      >
        <span>${option.label}</span>
        <strong>${counts.get(option.value) ?? 0}</strong>
      </button>
    `).join("")}
  `;

  chipHost.querySelectorAll("[data-category]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.category = chip.dataset.category;
      document.getElementById("category-filter").value = state.category;
      renderCategoryChips();
      renderGrid();
    });
  });
}

function getTagCounts() {
  const counts = new Map();
  for (const item of state.items) {
    if (item.tags) {
      for (const tagId of item.tags) {
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function renderTagChips() {
  const counts = getTagCounts();
  const chipHost = document.getElementById("tag-chips");
  const tagMap = new Map(state.tags.map(tag => [tag.id, tag]));

  const usedTags = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([tagId]) => tagMap.get(tagId))
    .filter(Boolean);

  chipHost.innerHTML = `
    <button class="category-chip ${state.selectedTag === "all" ? "is-active" : ""}" data-tag="all">
      <span>${t(state.language, "allCategories")}</span>
      <strong>${state.items.length}</strong>
    </button>
    ${usedTags.map((tag) => `
      <button
        class="category-chip ${state.selectedTag === tag.id ? "is-active" : ""}"
        data-tag="${tag.id}"
        style="--tag-color: ${tag.color}"
      >
        <span>${tag.name}</span>
        <strong>${counts.get(tag.id) ?? 0}</strong>
      </button>
    `).join("")}
  `;

  chipHost.querySelectorAll("[data-tag]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.selectedTag = chip.dataset.tag;
      renderTagChips();
      renderGrid();
    });
  });
}

function renderHeader(visibleItems) {
  const imageCount = state.items.filter((item) => item.type === "image").length;
  const videoCount = state.items.filter((item) => item.type === "video").length;
  const activeType = state.mediaType === "all"
    ? t(state.language, "tabAll")
    : state.mediaType === "image"
      ? t(state.language, "tabImage")
      : t(state.language, "tabVideo");
  const activeCategory = state.category === "all"
    ? t(state.language, "allCategories")
    : t(state.language, state.category);
  setText("title", t(state.language, "dashboardTitle"));
  setText("subtitle", t(state.language, "dashboardSubtitle"));
  setText("summary-text", t(state.language, "filterSummary", {
    visible: visibleItems.length,
    total: state.items.length
  }));
  setText("summary-total", String(state.items.length));
  setText("model-summary", t(state.language, "trainedModel"));
  setText("model-strength", String(state.rulesSummary.tokenCount));
  setText("hero-visible", String(visibleItems.length));
  setText("hero-images", String(imageCount));
  setText("hero-videos", String(videoCount));
  setText("hero-selection", String(state.selectedIds.size));
  const _el = document.querySelector('.hero-card:nth-child(1) .hero-card-label');
if (_el) _el.textContent = t(state.language, "visibleNow");
  const _el = document.querySelector('.hero-card:nth-child(2) .hero-card-label');
if (_el) _el.textContent = t(state.language, "imageCountTitle");
  const _el = document.querySelector('.hero-card:nth-child(3) .hero-card-label');
if (_el) _el.textContent = t(state.language, "videoCountTitle");
  const _el = document.querySelector('.hero-card:nth-child(4) .hero-card-label');
if (_el) _el.textContent = t(state.language, "selectionTitle");
  setText("hero-visible-copy", t(state.language, "visibleNowCopy", {
    type: activeType,
    category: activeCategory
  }));
  const _el = document.querySelector('.hero-card:nth-child(2) .hero-card-copy');
if (_el) _el.textContent = t(state.language, "imageCountCopy");
  const _el = document.querySelector('.hero-card:nth-child(3) .hero-card-copy');
if (_el) _el.textContent = t(state.language, "videoCountCopy");
  setText("hero-selection-copy", state.selectedIds.size
    ? t(state.language, "selectionReady", { count: state.selectedIds.size })
    : t(state.language, "selectionIdle"));
}

function renderPreview(item) {
  const dialog = document.getElementById("preview-dialog");
  const previewUrl = createPreviewUrl(item);
  const predictionText = (item.ai?.imagePredictions ?? [])
    .slice(0, 3)
    .map((entry) => `${entry.label} (${Math.round(entry.probability * 100)}%)`)
    .join(" · ");
  const mediaMarkup = item.type === "video"
    ? `<video id="studio-video" src="${previewUrl}" controls></video>`
    : `<img src="${previewUrl}" alt="">`;

  const imageTools = item.type === "image" ? `
    <section class="studio-card">
      <h3>${t(state.language, "imageStudio")}</h3>
      <p>${t(state.language, "previewToolsCopy")}</p>
      <div class="studio-form">
        <div class="studio-preview-card">
          <span class="studio-preview-label">${t(state.language, "cropEditor")}</span>
          <div id="image-editor-stage" class="image-editor-stage">
            <img id="image-editor-image" src="${previewUrl}" alt="" />
          </div>
          <span class="studio-note">${t(state.language, "dragCropHint")}</span>
        </div>
        <label>
          ${t(state.language, "cropPreset")}
          <select id="image-aspect">
            <option value="free">Free</option>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="16:9">16:9</option>
          </select>
        </label>
        <label>
          ${t(state.language, "formatLabel")}
          <select id="image-format">
            <option value="webp">WEBP</option>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
          </select>
        </label>
        <label>
          ${t(state.language, "maxWidthLabel")}
          <input id="image-max-width" type="number" min="320" step="10" value="${Math.max(640, Math.min(item.width || 1600, 1600))}" />
        </label>
        <label>
          ${t(state.language, "qualityLabel")}
          <input id="image-quality" type="range" min="0.4" max="0.98" step="0.02" value="0.82" />
        </label>
        <label>
          ${t(state.language, "zoomLabel")}
          <input id="image-zoom" type="range" min="1" max="4" step="0.01" value="1" />
        </label>
        <div class="studio-preview-card">
          <span class="studio-preview-label">${t(state.language, "processedPreview")}</span>
          <img id="image-preview-result" alt="" />
        </div>
        <div class="studio-actions">
          <button id="image-export-btn" class="primary">${t(state.language, "exportDerived")}</button>
          <button id="image-save-btn" class="ghost">${t(state.language, "saveDerived")}</button>
        </div>
      </div>
    </section>
  ` : "";

  const videoTools = item.type === "video" ? `
    <section class="studio-card">
      <h3>${t(state.language, "videoStudio")}</h3>
      <p>${t(state.language, "previewToolsCopy")}</p>
      <div class="studio-form">
        <div class="inline">
          <label>
            ${t(state.language, "startTime")}
            <input id="video-start" type="number" min="0" step="0.1" value="0" />
          </label>
          <label>
            ${t(state.language, "endTime")}
            <input id="video-end" type="number" min="0.1" step="0.1" value="5" />
          </label>
        </div>
        <label>
          ${t(state.language, "bitrateLabel")}
          <select id="video-bitrate">
            <option value="1500000">1.5 Mbps</option>
            <option value="3000000" selected>3 Mbps</option>
            <option value="6000000">6 Mbps</option>
          </select>
        </label>
        <div class="studio-preview-card">
          <span class="studio-preview-label">${t(state.language, "clipPreview")}</span>
          <div class="trim-bar">
            <span id="trim-range"></span>
          </div>
          <span id="clip-duration" class="studio-note"></span>
        </div>
        <div class="studio-actions">
          <button id="video-export-btn" class="primary">${t(state.language, "exportClip")}</button>
          <button id="video-save-btn" class="ghost">${t(state.language, "saveClip")}</button>
        </div>
        <span class="studio-note">${t(state.language, "clipFormatNote")}</span>
      </div>
    </section>
  ` : "";

  document.getElementById("preview-content").innerHTML = `
    <div class="studio">
      <section class="studio-stage">
        <div class="studio-head">
          <div class="studio-headline">
            <p class="studio-kicker">Material Studio</p>
            <strong>${item.title || item.pageTitle || item.category}</strong>
          </div>
          <button id="studio-close-btn" class="ghost studio-close" aria-label="Close">×</button>
        </div>
        <div class="studio-media">${mediaMarkup}</div>
        <div class="studio-meta">
          <div class="studio-chip-row">
            <span class="studio-chip">${item.type === "video" ? t(state.language, "tabVideo") : t(state.language, "tabImage")}</span>
            <span class="studio-chip">${formatBytes(item.blob.size)}</span>
          </div>
          <span>${t(state.language, "aiCategory")}: ${t(state.language, item.ai?.label ?? "uncategorized")} (${Math.round((item.ai?.confidence ?? 0) * 100)}%)</span>
          <span>${t(state.language, "size")}: ${formatBytes(item.blob.size)}</span>
          <span>${t(state.language, "savedAt")}: ${formatDate(item.createdAt, state.language)}</span>
          <a href="${item.pageUrl}" target="_blank" rel="noreferrer">${t(state.language, "sourcePage")}</a>
          <a href="${item.sourceUrl}" target="_blank" rel="noreferrer">${t(state.language, "sourceMedia")}</a>
        </div>
      </section>
      <aside class="studio-side">
        ${imageTools}
        ${videoTools}
        <section class="studio-card">
          <h3>${t(state.language, "manualCategory")}</h3>
          <p>${t(state.language, "studioReady")}</p>
          <div class="studio-form">
            <label>
              ${t(state.language, "manualCategory")}
              <select id="manual-category-select">
                ${getCategoryOptions(state.language).map((option) => `
                  <option value="${option.value}" ${option.value === item.category ? "selected" : ""}>${option.label}</option>
                `).join("")}
              </select>
            </label>
            <button id="manual-category-btn" class="ghost">${t(state.language, "applyCategory")}</button>
          </div>
        </section>
      </aside>
    </div>
  `;

  dialog.showModal();
  document.getElementById("studio-close-btn").addEventListener("click", () => dialog.close());
  document.getElementById("manual-category-btn").addEventListener("click", async () => {
    const category = document.getElementById("manual-category-select").value;
    await updateCategory(item.id, category);
    const message = t(state.language, "categoryUpdated", { category: t(state.language, category) });
    setFeedback(message);
    showDashboardToast(message);
    dialog.close();
  });

  if (item.type === "image") {
    let previewRequest = 0;
    let processedImageUrl = null;
    let processedImage = null;
    let previewTimer = null;
    const imageInputs = [
      document.getElementById("image-aspect"),
      document.getElementById("image-format"),
      document.getElementById("image-max-width"),
      document.getElementById("image-quality"),
      document.getElementById("image-zoom")
    ];
    const editorStage = document.getElementById("image-editor-stage");
    const editorImage = document.getElementById("image-editor-image");
    const imageEditorState = {
      zoom: 1,
      focalX: 0.5,
      focalY: 0.5,
      displayWidth: 0,
      displayHeight: 0
    };

    const getImageOptions = () => ({
      aspectRatio: document.getElementById("image-aspect").value,
      format: document.getElementById("image-format").value,
      maxWidth: document.getElementById("image-max-width").value,
      quality: Number(document.getElementById("image-quality").value),
      editorState: imageEditorState
    });

    const clampEditorFocal = () => {
      imageEditorState.focalX = Math.max(0, Math.min(imageEditorState.focalX, 1));
      imageEditorState.focalY = Math.max(0, Math.min(imageEditorState.focalY, 1));
    };

    const syncImageEditorView = () => {
      const sourceWidth = editorImage.naturalWidth || item.width || 1;
      const sourceHeight = editorImage.naturalHeight || item.height || 1;
      const aspectRatio = parseAspectRatio(document.getElementById("image-aspect").value) ?? (sourceWidth / sourceHeight);
      editorStage.style.aspectRatio = String(aspectRatio);
      const stageWidth = editorStage.clientWidth || 320;
      const stageHeight = editorStage.clientHeight || Math.max(220, Math.round(stageWidth / aspectRatio));
      const baseScale = Math.max(stageWidth / sourceWidth, stageHeight / sourceHeight);
      const zoom = Math.max(1, Number(document.getElementById("image-zoom").value) || 1);
      imageEditorState.zoom = zoom;
      const displayWidth = sourceWidth * baseScale * zoom;
      const displayHeight = sourceHeight * baseScale * zoom;
      imageEditorState.displayWidth = displayWidth;
      imageEditorState.displayHeight = displayHeight;
      clampEditorFocal();

      let left = stageWidth / 2 - imageEditorState.focalX * displayWidth;
      let top = stageHeight / 2 - imageEditorState.focalY * displayHeight;
      const minLeft = Math.min(0, stageWidth - displayWidth);
      const minTop = Math.min(0, stageHeight - displayHeight);
      left = Math.min(0, Math.max(minLeft, left));
      top = Math.min(0, Math.max(minTop, top));

      editorImage.style.width = `${displayWidth}px`;
      editorImage.style.height = `${displayHeight}px`;
      editorImage.style.left = `${left}px`;
      editorImage.style.top = `${top}px`;
    };

    const refreshImagePreview = async () => {
      const requestId = ++previewRequest;
      setFeedback(t(state.language, "studioSaving"));
      const nextProcessed = await processImageVariant(item, getImageOptions());
      if (requestId !== previewRequest) {
        return;
      }
      processedImage = nextProcessed;
      if (processedImageUrl) {
        URL.revokeObjectURL(processedImageUrl);
      }
      processedImageUrl = URL.createObjectURL(nextProcessed.blob);
      document.getElementById("image-preview-result").src = processedImageUrl;
      setFeedback("");
    };

    const scheduleImagePreviewRefresh = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        void refreshImagePreview();
      }, 90);
    };

    for (const input of imageInputs) {
      input.addEventListener("input", () => {
        syncImageEditorView();
        scheduleImagePreviewRefresh();
      });
      input.addEventListener("change", () => {
        syncImageEditorView();
        scheduleImagePreviewRefresh();
      });
    }

    editorImage.addEventListener("load", () => {
      syncImageEditorView();
      void refreshImagePreview();
    }, { once: true });

    let dragPointerId = null;
    let lastPointerX = 0;
    let lastPointerY = 0;

    editorStage.addEventListener("pointerdown", (event) => {
      dragPointerId = event.pointerId;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      editorStage.classList.add("is-dragging");
      editorStage.setPointerCapture(event.pointerId);
    });

    editorStage.addEventListener("pointermove", (event) => {
      if (dragPointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - lastPointerX;
      const deltaY = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      imageEditorState.focalX -= deltaX / Math.max(imageEditorState.displayWidth, 1);
      imageEditorState.focalY -= deltaY / Math.max(imageEditorState.displayHeight, 1);
      clampEditorFocal();
      syncImageEditorView();
      scheduleImagePreviewRefresh();
    });

    const endDrag = (event) => {
      if (dragPointerId !== event.pointerId) {
        return;
      }
      editorStage.classList.remove("is-dragging");
      editorStage.releasePointerCapture(event.pointerId);
      dragPointerId = null;
    };

    editorStage.addEventListener("pointerup", endDrag);
    editorStage.addEventListener("pointercancel", endDrag);

    editorStage.addEventListener("wheel", (event) => {
      event.preventDefault();
      const zoomInput = document.getElementById("image-zoom");
      const currentZoom = Number(zoomInput.value) || 1;
      const nextZoom = Math.max(1, Math.min(4, currentZoom + (event.deltaY > 0 ? -0.08 : 0.08)));
      zoomInput.value = nextZoom.toFixed(2);
      syncImageEditorView();
      scheduleImagePreviewRefresh();
    }, { passive: false });

    if (editorImage.complete) {
      syncImageEditorView();
      void refreshImagePreview();
    }

    document.getElementById("image-export-btn").addEventListener("click", async () => {
      setFeedback(t(state.language, "studioSaving"));
      const processed = processedImage ?? await processImageVariant(item, getImageOptions());
      await exportBlobFromPage(processed.blob, buildItemFilename(item, "edited").replace(/\.\w+$/, processed.mimeType === "image/png" ? ".png" : processed.mimeType === "image/jpeg" ? ".jpg" : ".webp"));
    });

    document.getElementById("image-save-btn").addEventListener("click", async () => {
      setFeedback(t(state.language, "studioSaving"));
      const processed = processedImage ?? await processImageVariant(item, getImageOptions());
      await saveDerivedItem(processed.blob, item, "edited", processed.mimeType, "image");
    });

    dialog.addEventListener("close", () => {
      clearTimeout(previewTimer);
      if (processedImageUrl) {
        URL.revokeObjectURL(processedImageUrl);
      }
    }, { once: true });
  }

  if (item.type === "video") {
    const studioVideo = document.getElementById("studio-video");
    const startInput = document.getElementById("video-start");
    const endInput = document.getElementById("video-end");
    const bitrateInput = document.getElementById("video-bitrate");
    const trimRange = document.getElementById("trim-range");
    const clipDuration = document.getElementById("clip-duration");

    const updateVideoPreview = () => {
      const duration = studioVideo.duration || 0;
      const start = Math.max(0, Math.min(Number(startInput.value) || 0, duration));
      const end = Math.max(start + 0.2, Math.min(Number(endInput.value) || duration, duration || start + 0.2));
      startInput.value = start.toFixed(1);
      endInput.value = end.toFixed(1);
      const startPercent = duration ? (start / duration) * 100 : 0;
      const widthPercent = duration ? ((end - start) / duration) * 100 : 100;
      trimRange.style.left = `${startPercent}%`;
      trimRange.style.width = `${Math.max(widthPercent, 4)}%`;
      clipDuration.textContent = `${t(state.language, "clipDuration")}: ${(end - start).toFixed(1)}s`;
      if (studioVideo.currentTime < start || studioVideo.currentTime > end) {
        studioVideo.currentTime = start;
      }
      if (studioVideo.readyState >= 2) {
        void studioVideo.play().catch(() => {});
      }
    };

    const loopSelection = () => {
      const end = Number(endInput.value) || studioVideo.duration || 0;
      const start = Number(startInput.value) || 0;
      if (studioVideo.currentTime >= end) {
        studioVideo.currentTime = start;
      }
    };

    studioVideo.addEventListener("timeupdate", loopSelection);
    studioVideo.addEventListener("loadedmetadata", () => {
      const duration = Number(studioVideo.duration.toFixed(1));
      endInput.value = String(Math.min(duration, 8));
      updateVideoPreview();
    }, { once: true });
    startInput.addEventListener("input", updateVideoPreview);
    endInput.addEventListener("input", updateVideoPreview);
    bitrateInput.addEventListener("change", updateVideoPreview);

    document.getElementById("video-export-btn").addEventListener("click", async () => {
      setFeedback(t(state.language, "studioSaving"));
      const processed = await processVideoClip(item, {
        startTime: startInput.value,
        endTime: endInput.value,
        bitrate: bitrateInput.value
      });
      await exportBlobFromPage(processed.blob, buildItemFilename({ ...item, mimeType: processed.mimeType }, "clip").replace(/\.\w+$/, ".webm"));
    });

    document.getElementById("video-save-btn").addEventListener("click", async () => {
      setFeedback(t(state.language, "studioSaving"));
      const processed = await processVideoClip(item, {
        startTime: startInput.value,
        endTime: endInput.value,
        bitrate: bitrateInput.value
      });
      await saveDerivedItem(processed.blob, item, "clip", processed.mimeType, "video");
    });
  }

  dialog.addEventListener("close", () => URL.revokeObjectURL(previewUrl), { once: true });
}

async function updateCategory(id, category) {
  await extensionApi.runtime.sendMessage({ type: "UPDATE_CATEGORY", id, category });
  await loadData();
}

async function deleteItem(id) {
  if (!confirm(t(state.language, "confirmDelete"))) {
    return;
  }
  const item = state.items.find(i => i.id === id);
  state.selectedIds.delete(id);
  
  const action = createBatchAction(
    "delete",
    { id, item },
    async () => {
      if (item) {
        await putMedia(item);
      }
    },
    async () => {
      await extensionApi.runtime.sendMessage({ type: "DELETE_MEDIA", id });
    }
  );
  
  state.history.push(action);
  await extensionApi.runtime.sendMessage({ type: "DELETE_MEDIA", id });
  await loadData();
}

async function deleteSelectedItems() {
  const ids = [...state.selectedIds];
  if (!ids.length) {
    return;
  }
  if (!confirm(t(state.language, "confirmDeleteSelected", { count: ids.length }))) {
    return;
  }
  
  const items = state.items.filter(i => ids.includes(i.id));
  
  const action = createBatchAction(
    "delete-batch",
    { ids, items },
    async () => {
      for (const item of items) {
        await putMedia(item);
      }
    },
    async () => {
      await extensionApi.runtime.sendMessage({ type: "DELETE_MEDIA_BATCH", ids });
    }
  );
  
  state.history.push(action);
  await extensionApi.runtime.sendMessage({ type: "DELETE_MEDIA_BATCH", ids });
  state.selectedIds.clear();
  await loadData();
}

async function chooseExportDirectory() {
  if (!("showDirectoryPicker" in window)) {
    setFeedback(t(state.language, "directoryUnsupported"));
    return;
  }
  const handle = await window.showDirectoryPicker({
    mode: "readwrite",
    startIn: "documents",
    id: "materialbox-export-directory"
  });
  state.exportDirectoryHandle = handle;
  state.exportDirectoryName = handle.name;
  await putMeta("exportDirectoryHandle", handle);
  await putMeta("exportDirectoryName", handle.name);
  renderDirectorySummary();
  const message = t(state.language, "directorySet", { name: handle.name });
  setFeedback(message);
  showDashboardToast(message);
}

async function clearExportDirectory() {
  state.exportDirectoryHandle = null;
  state.exportDirectoryName = "";
  await putMeta("exportDirectoryHandle", null);
  await putMeta("exportDirectoryName", "");
  renderDirectorySummary();
  setFeedback(t(state.language, "directoryCleared"));
  showDashboardToast(t(state.language, "directoryCleared"), "info");
}

function readSyncSettingsFromForm() {
  return mergeSyncSettings({
    provider: document.getElementById("sync-provider-select").value,
    s3: {
      endpoint: document.getElementById("sync-s3-endpoint").value.trim(),
      bucket: document.getElementById("sync-s3-bucket").value.trim(),
      region: document.getElementById("sync-s3-region").value.trim() || "us-east-1",
      accessKeyId: document.getElementById("sync-s3-access").value.trim(),
      secretAccessKey: document.getElementById("sync-s3-secret").value.trim(),
      prefix: document.getElementById("sync-s3-prefix").value.trim() || "materialbox"
    },
    webdav: {
      url: document.getElementById("sync-webdav-url").value.trim(),
      username: document.getElementById("sync-webdav-user").value.trim(),
      password: document.getElementById("sync-webdav-pass").value.trim(),
      path: document.getElementById("sync-webdav-path").value.trim() || "materialbox"
    }
  });
}

async function saveSyncSettings() {
  state.syncSettings = readSyncSettingsFromForm();
  await putMeta("cloudSyncSettings", state.syncSettings);
  renderSyncSettings();
  showDashboardToast(t(state.language, "syncSaved"));
}

async function runSyncAction(action) {
  state.syncSettings = readSyncSettingsFromForm();
  if (state.syncSettings.provider === "none") {
    showDashboardToast(t(state.language, "syncMissingProvider"), "error", 3200);
    return;
  }
  await putMeta("cloudSyncSettings", state.syncSettings);
  setFeedback(t(state.language, "studioSaving"));
  const result = await extensionApi.runtime.sendMessage({
    type: action === "upload" ? "SYNC_UPLOAD" : "SYNC_DOWNLOAD",
    settings: state.syncSettings
  });
  if (!result?.ok) {
    throw new Error(result?.error || t(state.language, "saveFailed"));
  }
  const message = action === "upload"
    ? t(state.language, "syncUploadDone", { count: result.count ?? 0 })
    : t(state.language, "syncDownloadDone", { count: result.count ?? 0 });
  setFeedback(message);
  showDashboardToast(message);
  if (action === "download") {
    await loadData();
  }
}

async function runSyncTest() {
  state.syncSettings = readSyncSettingsFromForm();
  if (state.syncSettings.provider === "none") {
    showDashboardToast(t(state.language, "syncMissingProvider"), "error", 3200);
    return;
  }
  await putMeta("cloudSyncSettings", state.syncSettings);
  const result = await extensionApi.runtime.sendMessage({
    type: "SYNC_TEST",
    settings: state.syncSettings
  });
  if (!result?.ok) {
    throw new Error(result?.error || t(state.language, "saveFailed"));
  }
  showDashboardToast(t(state.language, "syncTestDone"));
}

async function reclassifyAllItems() {
  const btn = document.getElementById("smart-classify-btn");
  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
    <span>Classifying...</span>
  `;
  
  let count = 0;
  const total = state.items.length;
  
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    setFeedback(`Classifying ${i + 1}/${total}...`);
    
    const ruleAi = inferCategory(item);
    const visionAi = item.type === "image"
      ? await classifyImageBlobInPage(item.blob).catch(() => null)
      : null;
    item.category = visionAi?.label ?? ruleAi.label;
    item.ai = {
      ...ruleAi,
      provider: visionAi?.provider ?? "rules",
      imagePredictions: visionAi?.predictions ?? [],
      visionCategory: visionAi?.label ?? null,
      visionConfidence: visionAi?.confidence ?? null,
      reclassifiedAt: Date.now()
    };
    item.updatedAt = Date.now();
    await putMedia(item);
    count += 1;
  }
  
  await loadData();
  
  btn.disabled = false;
  btn.innerHTML = originalContent;
  
  const message = t(state.language, "reclassifyDone", { count });
  setFeedback(message);
  showDashboardToast(message);
}

function renderGrid() {
  const visibleItems = getVisibleItems();
  renderHeader(visibleItems);
  renderCategoryChips();
  renderFilters();
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");

  if (!visibleItems.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    empty.textContent = t(state.language, "emptyState");
    return;
  }

  empty.hidden = true;
  grid.innerHTML = "";

  const lazyLoader = createLazyLoader();

  for (let index = 0; index < visibleItems.length; index++) {
    const item = visibleItems[index];
    const previewUrl = createPreviewUrl(item);
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = item.id;
    if (index === state.focusedIndex) {
      card.classList.add("is-focused");
    }
    const media = item.type === "video"
      ? `<video src="${previewUrl}" muted playsinline></video>`
      : `<img src="${previewUrl}" alt="">`;
    card.innerHTML = `
      <div class="thumb">
        ${media}
        <span class="badge">${t(state.language, item.category)}</span>
        <input class="card-select" type="checkbox" ${state.selectedIds.has(item.id) ? "checked" : ""} />
        <div class="thumb-actions">
          <button class="thumb-action" data-action="preview">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
          <button class="thumb-action" data-action="export">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button class="thumb-action" data-action="delete">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
      <div class="card-body">
        <div class="card-topline">
          <span class="type-badge ${item.type === "video" ? "video" : ""}">${item.type === "video" ? t(state.language, "tabVideo") : t(state.language, "tabImage")}</span>
          <span class="type-badge">${Math.round((item.ai?.confidence ?? 0) * 100)}% AI</span>
        </div>
        <h2 class="card-title">${item.title || item.pageTitle || item.sourceUrl}</h2>
        <div class="card-meta">
          <span>${t(state.language, "size")}: ${formatBytes(item.blob.size)}</span>
          <span>${t(state.language, "savedAt")}: ${formatDate(item.createdAt, state.language)}</span>
          <a href="${item.pageUrl || item.sourceUrl}" target="_blank" rel="noreferrer">${item.pageTitle || item.sourceUrl}</a>
        </div>
        <div class="card-footer">
          <button class="btn btn-sm btn-secondary" data-action="preview">${t(state.language, "preview")}</button>
          <div class="card-actions">
            <button class="btn btn-sm btn-icon btn-ghost" data-action="export" title="${t(state.language, "exportItem")}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button class="btn btn-sm btn-icon btn-danger" data-action="delete" title="${t(state.language, "deleteItem")}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    card.querySelector(".card-select").addEventListener("change", (event) => {
      if (event.target.checked) {
        state.selectedIds.add(item.id);
      } else {
        state.selectedIds.delete(item.id);
      }
      renderFilters();
    });
    card.querySelector(".thumb").addEventListener("click", (event) => {
      if (event.target.closest(".card-select")) {
        return;
      }
      renderPreview(item);
    });
    card.querySelector(".title").addEventListener("click", () => renderPreview(item));
    card.querySelector('[data-action="preview"]').addEventListener("click", () => renderPreview(item));
    card.querySelector('[data-action="export"]').addEventListener("click", async () => {
      await exportBlobFromPage(item.blob, buildItemFilename(item));
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => deleteItem(item.id));
    card.querySelector(".badge").addEventListener("click", async (event) => {
      event.stopPropagation();
      const options = getCategoryOptions(state.language);
      const nextIndex = (options.findIndex((option) => option.value === item.category) + 1) % options.length;
      await updateCategory(item.id, options[nextIndex].value);
    });
    card.addEventListener("remove", () => URL.revokeObjectURL(previewUrl));
    grid.appendChild(card);
  }
}

async function importFiles(fileList) {
  let count = 0;
  for (const file of fileList) {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      continue;
    }
    const ruleAi = inferCategory({
      title: file.name.replace(/\.[^.]+$/, ""),
      alt: "",
      pageTitle: "",
      pageUrl: "",
      sourceUrl: `import://${file.name}`,
      mimeType: file.type,
      type: file.type.startsWith("video/") ? "video" : "image",
      width: 0,
      height: 0
    });
    const visionAi = file.type.startsWith("image/")
      ? await classifyImageBlobInPage(file).catch(() => null)
      : null;
    const item = {
      id: crypto.randomUUID(),
      blob: file,
      type: file.type.startsWith("video/") ? "video" : "image",
      mimeType: file.type,
      sourceUrl: `import://${file.name}`,
      pageUrl: "",
      pageTitle: "",
      title: file.name.replace(/\.[^.]+$/, ""),
      alt: "",
      width: 0,
      height: 0,
      category: visionAi?.label ?? ruleAi.label,
      ai: {
        ...ruleAi,
        provider: visionAi?.provider ?? "rules",
        imagePredictions: visionAi?.predictions ?? [],
        visionCategory: visionAi?.label ?? null,
        visionConfidence: visionAi?.confidence ?? null
      },
      tags: [],
      contentHash: await computeContentHash(file),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await putMedia(item);
    count += 1;
  }
  await loadData();
  const message = t(state.language, "importDone", { count });
  setFeedback(message);
  showDashboardToast(message);
}

function getGridColumns() {
  const grid = document.getElementById("grid");
  const style = window.getComputedStyle(grid);
  const templateColumns = style.gridTemplateColumns;
  return templateColumns.split(" ").length || 4;
}

function getVisibleItemAtIndex(index) {
  const visibleItems = getVisibleItems();
  return visibleItems[index] || null;
}

function getCurrentFocusedItem() {
  if (state.focusedIndex < 0) return null;
  return getVisibleItemAtIndex(state.focusedIndex);
}

function navigateGrid(direction) {
  const visibleItems = getVisibleItems();
  if (!visibleItems.length) return;
  
  const cols = getGridColumns();
  let newIndex = state.focusedIndex;
  
  if (newIndex < 0) {
    newIndex = 0;
  } else {
    switch (direction) {
      case "up":
        newIndex = Math.max(0, newIndex - cols);
        break;
      case "down":
        newIndex = Math.min(visibleItems.length - 1, newIndex + cols);
        break;
      case "left":
        newIndex = Math.max(0, newIndex - 1);
        break;
      case "right":
        newIndex = Math.min(visibleItems.length - 1, newIndex + 1);
        break;
    }
  }
  
  state.focusedIndex = newIndex;
  const item = visibleItems[newIndex];
  if (item) {
    const card = document.querySelector(`[data-id="${item.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
}

function toggleSelectionFocused() {
  const item = getCurrentFocusedItem();
  if (!item) return;
  
  if (state.selectedIds.has(item.id)) {
    state.selectedIds.delete(item.id);
  } else {
    state.selectedIds.add(item.id);
  }
  renderGrid();
}

function previewFocused() {
  const item = getCurrentFocusedItem();
  if (!item) return;
  renderPreview(item);
}

function exportFocused() {
  const item = getCurrentFocusedItem();
  if (!item) return;
  const visibleItems = getVisibleItems();
  if (state.selectedIds.has(item.id)) {
    const selectedItems = visibleItems.filter(i => state.selectedIds.has(i.id));
    if (selectedItems.length === 1) {
      exportBlobFromPage(item.blob, buildItemFilename(item));
    } else {
      exportSelectedItemsAsZip(selectedItems);
    }
  } else {
    exportBlobFromPage(item.blob, buildItemFilename(item));
  }
}

function deleteFocused() {
  const item = getCurrentFocusedItem();
  if (!item) return;
  deleteItem(item.id);
}

function cycleCategoryFocused() {
  const item = getCurrentFocusedItem();
  if (!item) return;
  const options = getCategoryOptions(state.language);
  const nextIndex = (options.findIndex((option) => option.value === item.category) + 1) % options.length;
  updateCategory(item.id, options[nextIndex].value);
}

function selectAllVisible() {
  for (const item of getVisibleItems()) {
    state.selectedIds.add(item.id);
  }
  renderGrid();
}

function invertSelection() {
  const visibleIds = new Set(getVisibleItems().map(i => i.id));
  for (const id of visibleIds) {
    if (state.selectedIds.has(id)) {
      state.selectedIds.delete(id);
    } else {
      state.selectedIds.add(id);
    }
  }
  renderGrid();
}

async function exportSelectedItemsAsZip(items) {
  if (!items.length) return;
  if (items.length === 1) {
    await exportBlobFromPage(items[0].blob, buildItemFilename(items[0]));
    return;
  }
  const exporter = await import("../generated/export.bundle.js");
  const zipBlob = await exporter.buildZipBlob(items);
  await exportBlobFromPage(
    zipBlob,
    `materialbox-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`
  );
  setFeedback(t(state.language, "zipDone"));
  showDashboardToast(t(state.language, "zipDone"));
}

const COMMANDS = [
  { id: "undo", labelKey: "undo", shortcut: "⌘Z", action: () => performUndo(), condition: () => state.history.getState().canUndo },
  { id: "redo", labelKey: "redo", shortcut: "⌘⇧Z", action: () => performRedo(), condition: () => state.history.getState().canRedo },
  { id: "select-all", labelKey: "selectVisible", shortcut: "A", action: () => selectAllVisible() },
  { id: "clear-selection", labelKey: "clearSelection", shortcut: "Esc", action: () => { state.selectedIds.clear(); renderGrid(); } },
  { id: "export-selected", labelKey: "exportFiltered", shortcut: "E", action: () => {
    const items = getVisibleItems().filter(i => state.selectedIds.has(i.id));
    exportSelectedItemsAsZip(items);
  }},
  { id: "delete-selected", labelKey: "deleteSelected", shortcut: "Del", action: () => deleteSelectedItems() },
  { id: "smart-classify", labelKey: "smartClassify", shortcut: "", action: () => reclassifyAllItems() },
  { id: "open-sync", labelKey: "syncPanel", shortcut: "", action: () => document.getElementById("sync-dialog").showModal() },
  { id: "import", labelKey: "importMedia", shortcut: "", action: () => document.getElementById("import-input").click() },
  { id: "view-all", labelKey: "tabAll", shortcut: "", action: () => { state.mediaType = "all"; state.category = "all"; renderGrid(); } },
  { id: "view-images", labelKey: "tabImage", shortcut: "", action: () => { state.mediaType = "image"; renderGrid(); } },
  { id: "view-videos", labelKey: "tabVideo", shortcut: "", action: () => { state.mediaType = "video"; renderGrid(); } },
  { id: "focus-search", labelKey: "searchPlaceholder", shortcut: "/", action: () => { closeCommandPalette(); document.getElementById("search").focus(); } }
];

function renderCommandResults(query = "") {
  const resultsContainer = document.getElementById("command-results");
  const filtered = COMMANDS
    .filter(cmd => {
      if (cmd.condition && !cmd.condition()) return false;
      const label = t(state.language, cmd.labelKey).toLowerCase();
      const q = query.toLowerCase();
      return label.includes(q) || cmd.id.includes(q);
    });

  commandSelectedIndex = 0;

  resultsContainer.innerHTML = filtered.map((cmd, index) => `
    <button class="command-item ${index === commandSelectedIndex ? 'is-selected' : ''}" data-index="${index}">
      <span class="command-label">${t(state.language, cmd.labelKey)}</span>
      ${cmd.shortcut ? `<span class="command-shortcut">${cmd.shortcut}</span>` : ''}
    </button>
  `).join("");

  resultsContainer.querySelectorAll(".command-item").forEach(item => {
    item.addEventListener("click", () => {
      const index = parseInt(item.dataset.index);
      const cmd = filtered[index];
      if (cmd) {
        closeCommandPalette();
        cmd.action();
      }
    });
  });
}

let commandSelectedIndex = 0;

function openCommandPalette() {
  const dialog = document.getElementById("command-dialog");
  const input = document.getElementById("command-input");
  renderCommandResults();
  dialog.showModal();
  input.value = "";
  input.focus();
  state.commandPaletteOpen = true;
}

function closeCommandPalette() {
  const dialog = document.getElementById("command-dialog");
  dialog.close();
  state.commandPaletteOpen = false;
}

async function performUndo() {
  const result = await state.history.undo();
  if (result) {
    await loadData();
    showDashboardToast(t(state.language, "undoDone"));
  } else {
    showDashboardToast(t(state.language, "noUndoAvailable"), "info", 2000);
  }
}

async function performRedo() {
  const result = await state.history.redo();
  if (result) {
    await loadData();
    showDashboardToast(t(state.language, "redoDone"));
  } else {
    showDashboardToast(t(state.language, "noRedoAvailable"), "info", 2000);
  }
}

function calculateStorageStats() {
  const stats = {
    totalSize: 0,
    byCategory: new Map(),
    byType: { image: 0, video: 0 },
    topFiles: [],
    duplicateCount: 0
  };

  const hashCount = new Map();
  
  for (const item of state.items) {
    stats.totalSize += item.blob.size;
    
    const catCount = stats.byCategory.get(item.category) || 0;
    stats.byCategory.set(item.category, catCount + item.blob.size);
    
    stats.byType[item.type] = (stats.byType[item.type] || 0) + item.blob.size;
    
    const hash = item.contentHash;
    if (hash) {
      hashCount.set(hash, (hashCount.get(hash) || 0) + 1);
    }
    
    stats.topFiles.push({
      id: item.id,
      title: item.title || item.pageTitle || "Untitled",
      size: item.blob.size,
      type: item.type
    });
  }
  
  stats.topFiles.sort((a, b) => b.size - a.size);
  stats.topFiles = stats.topFiles.slice(0, 10);
  
  stats.duplicateCount = [...hashCount.values()].filter(count => count > 1).length;
  
  return stats;
}

function renderStoragePanel() {
  const stats = calculateStorageStats();
  const dialog = document.getElementById("storage-dialog");
  
  const categoryList = [...stats.byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, size]) => `
      <div class="storage-row">
        <span>${t(state.language, cat)}</span>
        <span>${formatBytes(size)}</span>
      </div>
    `).join("");
  
  const topFilesList = stats.topFiles.map(file => `
    <div class="storage-row">
      <span class="storage-filename">${file.title.slice(0, 30)}</span>
      <span>${formatBytes(file.size)}</span>
    </div>
  `).join("");
  
  document.getElementById("storage-content").innerHTML = `
    <div class="storage-section">
      <h3>${t(state.language, "totalSize")}</h3>
      <div class="storage-total">${formatBytes(stats.totalSize)}</div>
    </div>
    <div class="storage-section">
      <h3>${t(state.language, "byType")}</h3>
      <div class="storage-row">
        <span>${t(state.language, "tabImage")}</span>
        <span>${formatBytes(stats.byType.image)}</span>
      </div>
      <div class="storage-row">
        <span>${t(state.language, "tabVideo")}</span>
        <span>${formatBytes(stats.byType.video)}</span>
      </div>
    </div>
    <div class="storage-section">
      <h3>${t(state.language, "byCategory")}</h3>
      ${categoryList}
    </div>
    <div class="storage-section">
      <h3>${t(state.language, "topFiles")}</h3>
      ${topFilesList}
    </div>
    <div class="storage-section">
      <h3>${t(state.language, "duplicateCount")}</h3>
      <div class="storage-total">${stats.duplicateCount}</div>
    </div>
  `;
  
  dialog.showModal();
}

function renderTagsDialog() {
  const tagsList = document.getElementById("tags-list");
  safeSet("tags-dialog-title", t(state.language, "manageTags"));
  
  tagsList.innerHTML = state.tags.map(tag => `
    <div class="tag-item">
      <span class="tag-color" style="background: ${tag.color}"></span>
      <span class="tag-name">${tag.name}</span>
      <button class="btn btn-icon btn-ghost tag-delete" data-tag-id="${tag.id}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `).join("");
  
  tagsList.querySelectorAll(".tag-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tagId = btn.dataset.tagId;
      state.tags = await removeTag(tagId);
      renderTagsDialog();
      renderTagChips();
    });
  });
  
  document.getElementById("tags-dialog").showModal();
}

async function createNewTag() {
  const nameInput = document.getElementById("new-tag-name");
  const colorInput = document.getElementById("new-tag-color");
  const name = nameInput.value.trim();
  const color = colorInput.value;
  
  if (!name) return;
  
  const tag = {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    color
  };
  
  state.tags = await addTag(tag);
  nameInput.value = "";
  renderTagsDialog();
  renderTagChips();
}

async function loadData() {
  const [items, rulesSummary, aiStatus, exportDirectoryHandle, exportDirectoryName, cloudSyncSettings, tags, collections] = await Promise.all([
    getAllMedia(),
    extensionApi.runtime.sendMessage({ type: "GET_RULES_SUMMARY" }),
    extensionApi.runtime.sendMessage({ type: "GET_AI_STATUS" }).catch(() => ({ ok: false })),
    getMeta("exportDirectoryHandle", null),
    getMeta("exportDirectoryName", ""),
    getMeta("cloudSyncSettings", createDefaultSyncSettings()),
    getTags(),
    getCollections()
  ]);
  state.items = items;
  state.rulesSummary = rulesSummary.ok ? rulesSummary : { categories: [], tokenCount: 0 };
  state.aiStatus = aiStatus.ok ? aiStatus : null;
  state.exportDirectoryHandle = exportDirectoryHandle;
  state.exportDirectoryName = exportDirectoryName;
  state.syncSettings = mergeSyncSettings(cloudSyncSettings);
  state.tags = tags;
  state.collections = collections;
  renderFilters();
  renderSyncSettings();
  renderGrid();
  renderDirectorySummary();
  renderTagChips();
  renderCollections();
  safeSet("model-provider", state.aiStatus
    ? t(state.language, "hybridModelReady")
    : t(state.language, "rulesFallbackActive"));
  safeSet("tags-panel-title", t(state.language, "tags"));
  safeSet("advanced-filters-label", t(state.language, "advancedFilters"));
  safeSet("date-range-label", t(state.language, "dateRange"));
  safeSet("source-domain-label", t(state.language, "sourceDomain"));
  safeSet("dimensions-label", t(state.language, "dimensions"));
  safeSet("clear-filters-btn", t(state.language, "clearFilters"));
  safeSet("collections-panel-title", t(state.language, "collections"));
}

function getCollectionItemCount(collection) {
  if (collection.isSmart && collection.rules) {
    return evaluateSmartRulesCount(collection.rules);
  }
  return collection.items.length;
}

function evaluateSmartRulesCount(rules) {
  return state.items.filter(item => {
    if (rules.category && item.category !== rules.category) return false;
    if (rules.type && item.type !== rules.type) return false;
    if (rules.sourceDomain) {
      try {
        const url = new URL(item.sourceUrl);
        if (!url.hostname.includes(rules.sourceDomain)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }).length;
}

function renderCollections() {
  const list = document.getElementById("collection-list");
  
  if (state.collections.length === 0) {
    list.innerHTML = `<p class="empty-text">${t(state.language, "noCollections")}</p>`;
    return;
  }
  
  list.innerHTML = state.collections.map(collection => `
    <button class="collection-item ${state.selectedCollection === collection.id ? "is-active" : ""}" data-collection="${collection.id}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
        ${collection.isSmart 
          ? '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="9" y1="14" x2="15" y2="14"/>'
          : '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
        }
      </svg>
      <span class="collection-name">${collection.name}</span>
      <span class="collection-count">${getCollectionItemCount(collection)}</span>
    </button>
  `).join("");
  
  list.querySelectorAll(".collection-item").forEach(item => {
    item.addEventListener("click", () => {
      if (state.selectedCollection === item.dataset.collection) {
        state.selectedCollection = null;
      } else {
        state.selectedCollection = item.dataset.collection;
      }
      renderCollections();
      renderGrid();
    });
  });
}

async function createNewCollection() {
  const name = prompt(t(state.language, "collectionName"));
  if (!name) return;
  
  const collection = {
    id: `collection-${Date.now()}`,
    name,
    type: "static",
    items: [],
    isSmart: false,
    rules: null
  };
  
  state.collections = await createCollection(collection);
  renderCollections();
}

async function bindEvents() {
  document.getElementById("search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderGrid();
  });

  document.getElementById("category-filter").addEventListener("change", (event) => {
    state.category = event.target.value;
    renderCategoryChips();
    renderGrid();
  });

  document.getElementById("advanced-filters-toggle").addEventListener("click", () => {
    const panel = document.getElementById("advanced-filters");
    panel.hidden = !panel.hidden;
  });

  document.getElementById("date-from").addEventListener("change", (event) => {
    state.advancedFilters.dateFrom = event.target.value || null;
    renderGrid();
  });

  document.getElementById("date-to").addEventListener("change", (event) => {
    state.advancedFilters.dateTo = event.target.value || null;
    renderGrid();
  });

  document.getElementById("source-domain").addEventListener("input", (event) => {
    state.advancedFilters.sourceDomain = event.target.value.trim();
    renderGrid();
  });

  document.getElementById("min-width").addEventListener("input", (event) => {
    state.advancedFilters.minWidth = event.target.value ? parseInt(event.target.value) : null;
    renderGrid();
  });

  document.getElementById("max-width").addEventListener("input", (event) => {
    state.advancedFilters.maxWidth = event.target.value ? parseInt(event.target.value) : null;
    renderGrid();
  });

  document.getElementById("clear-filters-btn").addEventListener("click", () => {
    state.advancedFilters = {
      dateFrom: null,
      dateTo: null,
      sourceDomain: "",
      minWidth: null,
      maxWidth: null
    };
    document.getElementById("date-from").value = "";
    document.getElementById("date-to").value = "";
    document.getElementById("source-domain").value = "";
    document.getElementById("min-width").value = "";
    document.getElementById("max-width").value = "";
    renderGrid();
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.mediaType = tab.dataset.type;
      renderFilters();
      renderGrid();
    });
  });

  document.getElementById("language-select-element").addEventListener("change", async (event) => {
    state.language = event.target.value;
    await setLanguage(state.language);
    renderFilters();
    renderSyncSettings();
    renderGrid();
    renderDirectorySummary();
  });

  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("import-input").click();
  });

  document.getElementById("empty-import-btn")?.addEventListener("click", () => {
    document.getElementById("import-input").click();
  });

  document.getElementById("import-input").addEventListener("change", async (event) => {
    await importFiles([...event.target.files]);
    event.target.value = "";
  });

  document.getElementById("export-btn").addEventListener("click", async () => {
    const items = getVisibleItems();
    if (!items.length) {
      return;
    }
    if (items.length === 1) {
      await exportBlobFromPage(items[0].blob, buildItemFilename(items[0]));
      return;
    }
    const exporter = await import("../generated/export.bundle.js");
    const zipBlob = await exporter.buildZipBlob(items);
    await exportBlobFromPage(
      zipBlob,
      `materialbox-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`
    );
    setFeedback(t(state.language, "zipDone"));
    showDashboardToast(t(state.language, "zipDone"));
  });

  document.getElementById("choose-directory-btn").addEventListener("click", async () => {
    await chooseExportDirectory();
  });

  document.getElementById("clear-directory-btn").addEventListener("click", async () => {
    await clearExportDirectory();
  });

  document.getElementById("sync-open-btn").addEventListener("click", () => {
    document.getElementById("sync-dialog").showModal();
  });

  document.getElementById("sync-close-btn").addEventListener("click", () => {
    document.getElementById("sync-dialog").close();
  });

  document.getElementById("sync-provider-select").addEventListener("change", () => {
    state.syncSettings = readSyncSettingsFromForm();
    renderSyncSettings();
  });

  document.getElementById("sync-save-btn").addEventListener("click", async () => {
    try {
      await saveSyncSettings();
    } catch (error) {
      showDashboardToast(error.message || t(state.language, "saveFailed"), "error", 3200);
    }
  });

  document.getElementById("sync-upload-btn").addEventListener("click", async () => {
    try {
      await runSyncAction("upload");
    } catch (error) {
      showDashboardToast(error.message || t(state.language, "saveFailed"), "error", 3200);
      setFeedback(error.message || t(state.language, "saveFailed"));
    }
  });

  document.getElementById("sync-download-btn").addEventListener("click", async () => {
    try {
      await runSyncAction("download");
    } catch (error) {
      showDashboardToast(error.message || t(state.language, "saveFailed"), "error", 3200);
      setFeedback(error.message || t(state.language, "saveFailed"));
    }
  });

  document.getElementById("sync-test-btn").addEventListener("click", async () => {
    try {
      await runSyncTest();
    } catch (error) {
      showDashboardToast(error.message || t(state.language, "saveFailed"), "error", 3200);
      setFeedback(error.message || t(state.language, "saveFailed"));
    }
  });

  document.getElementById("smart-classify-btn").addEventListener("click", async () => {
    await reclassifyAllItems();
  });

  document.getElementById("create-collection-btn").addEventListener("click", () => {
    createNewCollection();
  });

  document.getElementById("select-visible-btn").addEventListener("click", () => {
    for (const item of getVisibleItems()) {
      state.selectedIds.add(item.id);
    }
    renderGrid();
  });

  document.getElementById("clear-selection-btn").addEventListener("click", () => {
    state.selectedIds.clear();
    renderGrid();
  });

  document.getElementById("delete-selected-btn").addEventListener("click", async () => {
    await deleteSelectedItems();
  });

  document.getElementById("preview-dialog").addEventListener("click", (event) => {
    if (event.target.nodeName === "DIALOG") {
      event.target.close();
    }
  });

  document.getElementById("sync-dialog").addEventListener("click", (event) => {
    if (event.target.nodeName === "DIALOG") {
      event.target.close();
    }
  });

  const shortcutHandler = createShortcutHandler({
    NavigateUp: () => {
      state.focusedIndex = -1;
      navigateGrid("up");
    },
    NavigateDown: () => navigateGrid("down"),
    NavigateLeft: () => navigateGrid("left"),
    NavigateRight: () => navigateGrid("right"),
    Preview: () => {
      if (state.focusedIndex >= 0) {
        previewFocused();
      } else {
        toggleSelectionFocused();
      }
    },
    Export: () => {
      if (state.focusedIndex >= 0) {
        exportFocused();
      } else if (state.selectedIds.size > 0) {
        const selectedItems = getVisibleItems().filter(i => state.selectedIds.has(i.id));
        exportSelectedItemsAsZip(selectedItems);
      }
    },
    Delete: () => {
      if (state.focusedIndex >= 0) {
        deleteFocused();
      } else if (state.selectedIds.size > 0) {
        deleteSelectedItems();
      }
    },
    Category: () => {
      if (state.focusedIndex >= 0) {
        cycleCategoryFocused();
      }
    },
    FocusSearch: () => {
      document.getElementById("search").focus();
    },
    Escape: () => {
      if (state.commandPaletteOpen) {
        closeCommandPalette();
      } else if (state.selectedIds.size > 0) {
        state.selectedIds.clear();
        renderGrid();
      } else if (state.focusedIndex >= 0) {
        state.focusedIndex = -1;
        renderGrid();
      }
    },
    SelectAll: () => selectAllVisible(),
    InvertSelection: () => invertSelection(),
    CommandPalette: () => {
      openCommandPalette();
    },
    Undo: () => performUndo(),
    Redo: () => performRedo()
  });

  let lastKeyCombo = "";
  document.addEventListener("keydown", (event) => {
    const combo = (event.ctrlKey || event.metaKey ? "ctrl+" : "") + 
                  (event.shiftKey ? "shift+" : "") + 
                  (event.altKey ? "alt+" : "") + 
                  event.key.toLowerCase();
    
    if (combo === "ctrl+z" || combo === "cmd+z") {
      event.preventDefault();
      performUndo();
    } else if (combo === "ctrl+shift+z" || combo === "cmd+shift+z" || combo === "ctrl+y" || combo === "cmd+y") {
      event.preventDefault();
      performRedo();
    }
  });

  document.addEventListener("keydown", shortcutHandler);

  document.getElementById("command-dialog").addEventListener("click", (event) => {
    if (event.target.nodeName === "DIALOG") {
      closeCommandPalette();
    }
  });

  document.getElementById("storage-open-btn").addEventListener("click", () => {
    renderStoragePanel();
  });

  document.getElementById("storage-close-btn").addEventListener("click", () => {
    document.getElementById("storage-dialog").close();
  });

  document.getElementById("storage-dialog").addEventListener("click", (event) => {
    if (event.target.nodeName === "DIALOG") {
      event.target.close();
    }
  });

  document.getElementById("manage-tags-btn").addEventListener("click", () => {
    renderTagsDialog();
  });

  document.getElementById("tags-close-btn").addEventListener("click", () => {
    document.getElementById("tags-dialog").close();
  });

  document.getElementById("tags-dialog").addEventListener("click", (event) => {
    if (event.target.nodeName === "DIALOG") {
      event.target.close();
    }
  });

  document.getElementById("add-tag-btn").addEventListener("click", () => {
    createNewTag();
  });

  document.getElementById("new-tag-name").addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      createNewTag();
    }
  });

  const commandInput = document.getElementById("command-input");
  commandInput.addEventListener("input", (event) => {
    renderCommandResults(event.target.value);
  });

  commandInput.addEventListener("keydown", (event) => {
    const resultsContainer = document.getElementById("command-results");
    const items = resultsContainer.querySelectorAll(".command-item");
    
    if (event.key === "ArrowDown") {
      event.preventDefault();
      commandSelectedIndex = Math.min(commandSelectedIndex + 1, items.length - 1);
      updateCommandSelection();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      commandSelectedIndex = Math.max(commandSelectedIndex - 1, 0);
      updateCommandSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selectedItem = items[commandSelectedIndex];
      if (selectedItem) {
        selectedItem.click();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    }
  });
}

function updateCommandSelection() {
  const resultsContainer = document.getElementById("command-results");
  const items = resultsContainer.querySelectorAll(".command-item");
  items.forEach((item, index) => {
    item.classList.toggle("is-selected", index === commandSelectedIndex);
  });
  if (items[commandSelectedIndex]) {
    items[commandSelectedIndex].scrollIntoView({ block: "nearest" });
  }
}

async function main() {
  state.language = await getLanguage();
  document.documentElement.lang = state.language;
  await bindEvents();
  await loadData();
}

void main();
