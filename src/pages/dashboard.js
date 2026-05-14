import { getAllMedia, getMeta, putMedia, putMeta } from "../lib/db.js";
import { inferCategory } from "../lib/classifier.js";
import { getCategoryOptions, getLanguage, setLanguage, t } from "../lib/i18n.js";
import { classifyImageBlobInPage } from "../lib/page-classifier.js";
import { showToast } from "../lib/toast.js";
import { extensionApi, formatBytes, formatDate } from "../lib/utils.js";

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
  exportDirectoryName: ""
};

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
  return true;
}

function getVisibleItems() {
  return state.items.filter(matchesFilters);
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
  document.getElementById("feedback").textContent = message;
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

  if (aspectRatio) {
    const currentRatio = bitmap.width / bitmap.height;
    if (currentRatio > aspectRatio) {
      sourceWidth = bitmap.height * aspectRatio;
      sourceX = (bitmap.width - sourceWidth) / 2;
    } else {
      sourceHeight = bitmap.width / aspectRatio;
      sourceY = (bitmap.height - sourceHeight) / 2;
    }
  }

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

function renderFilters() {
  const categoryFilter = document.getElementById("category-filter");
  const languageSelect = document.getElementById("language-select");
  const searchInput = document.getElementById("search");
  const tabs = [...document.querySelectorAll(".tab")];
  const selectionCount = state.selectedIds.size;

  languageSelect.value = state.language;
  searchInput.placeholder = t(state.language, "searchPlaceholder");
  document.getElementById("import-btn").textContent = t(state.language, "importMedia");
  document.getElementById("export-btn").textContent = t(state.language, "exportFiltered");
  document.getElementById("smart-classify-btn").textContent = t(state.language, "smartClassify");
  document.getElementById("select-visible-btn").textContent = t(state.language, "selectVisible");
  document.getElementById("choose-directory-btn").textContent = t(state.language, "chooseFolder");
  document.getElementById("clear-directory-btn").textContent = t(state.language, "clearFolder");
  document.getElementById("export-directory-title").textContent = t(state.language, "exportDirectory");
  document.getElementById("workspace-tools-title").textContent = t(state.language, "workspaceTools");
  document.getElementById("workspace-tools-copy").textContent = t(state.language, "workspaceToolsCopy");
  document.getElementById("studio-panel-title").textContent = t(state.language, "studioPanel");
  document.getElementById("studio-panel-copy").textContent = t(state.language, "studioPanelCopy");
  document.getElementById("studio-panel-hint").textContent = t(state.language, "studioPanelHint");
  document.getElementById("command-search-label").textContent = t(state.language, "commandSearch");
  document.getElementById("view-pill").textContent = t(state.language, "localStudioPill");
  document.getElementById("smart-categories-title").textContent = t(state.language, "smartCategories");
  document.getElementById("clear-selection-btn").textContent = selectionCount
    ? `${t(state.language, "clearSelection")} (${selectionCount})`
    : t(state.language, "clearSelection");
  document.getElementById("delete-selected-btn").textContent = selectionCount
    ? `${t(state.language, "deleteSelected")} (${selectionCount})`
    : t(state.language, "deleteSelected");

  tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.type === state.mediaType);
  });
  document.querySelector('[data-type="all"]').textContent = t(state.language, "tabAll");
  document.querySelector('[data-type="image"]').textContent = t(state.language, "tabImage");
  document.querySelector('[data-type="video"]').textContent = t(state.language, "tabVideo");

  categoryFilter.innerHTML = [
    `<option value="all">${t(state.language, "allCategories")}</option>`,
    ...getCategoryOptions(state.language).map(
      (option) => `<option value="${option.value}">${option.label}</option>`
    )
  ].join("");
  categoryFilter.value = state.category;
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
  document.querySelector('.hero-card:nth-child(1) .hero-card-label').textContent = t(state.language, "visibleNow");
  document.querySelector('.hero-card:nth-child(2) .hero-card-label').textContent = t(state.language, "imageCountTitle");
  document.querySelector('.hero-card:nth-child(3) .hero-card-label').textContent = t(state.language, "videoCountTitle");
  document.querySelector('.hero-card:nth-child(4) .hero-card-label').textContent = t(state.language, "selectionTitle");
  setText("hero-visible-copy", t(state.language, "visibleNowCopy", {
    type: activeType,
    category: activeCategory
  }));
  document.querySelector('.hero-card:nth-child(2) .hero-card-copy').textContent = t(state.language, "imageCountCopy");
  document.querySelector('.hero-card:nth-child(3) .hero-card-copy').textContent = t(state.language, "videoCountCopy");
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
            <span class="studio-chip">${t(state.language, "category")}: ${t(state.language, item.category)}</span>
            <span class="studio-chip">${item.type === "video" ? t(state.language, "tabVideo") : t(state.language, "tabImage")}</span>
            <span class="studio-chip">${formatBytes(item.blob.size)}</span>
          </div>
          <span>${t(state.language, "category")}: ${t(state.language, item.category)}</span>
          <span>${t(state.language, "aiCategory")}: ${t(state.language, item.ai?.label ?? "uncategorized")} (${Math.round((item.ai?.confidence ?? 0) * 100)}%)</span>
          ${predictionText ? `<span>Vision: ${predictionText}</span>` : ""}
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
    const imageInputs = [
      document.getElementById("image-aspect"),
      document.getElementById("image-format"),
      document.getElementById("image-max-width"),
      document.getElementById("image-quality")
    ];

    const getImageOptions = () => ({
      aspectRatio: document.getElementById("image-aspect").value,
      format: document.getElementById("image-format").value,
      maxWidth: document.getElementById("image-max-width").value,
      quality: Number(document.getElementById("image-quality").value)
    });

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

    for (const input of imageInputs) {
      input.addEventListener("input", () => {
        void refreshImagePreview();
      });
      input.addEventListener("change", () => {
        void refreshImagePreview();
      });
    }

    void refreshImagePreview();

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
  state.selectedIds.delete(id);
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
  await extensionApi.runtime.sendMessage({ type: "DELETE_MEDIA_BATCH", ids });
  state.selectedIds.clear();
  await loadData();
}

async function exportViaBackground(ids) {
  if (ids.length <= 1) {
    await extensionApi.runtime.sendMessage({ type: "EXPORT_MEDIA", ids });
  } else {
    await extensionApi.runtime.sendMessage({ type: "EXPORT_MEDIA_ZIP", ids });
  }
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

async function reclassifyAllItems() {
  setFeedback(t(state.language, "studioSaving"));
  let count = 0;
  for (const item of state.items) {
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

  for (const item of visibleItems) {
    const previewUrl = createPreviewUrl(item);
    const card = document.createElement("article");
    card.className = "card";
    const media = item.type === "video"
      ? `<video src="${previewUrl}" muted playsinline></video>`
      : `<img src="${previewUrl}" alt="">`;
    card.innerHTML = `
      <div class="thumb">
        ${media}
        <span class="badge">${t(state.language, item.category)}</span>
        <input class="card-select" type="checkbox" ${state.selectedIds.has(item.id) ? "checked" : ""} />
        <div class="thumb-actions">
          <button class="thumb-action" data-action="preview">${t(state.language, "preview")}</button>
          <button class="thumb-action" data-action="export">${t(state.language, "exportItem")}</button>
          <button class="thumb-action" data-action="delete">${t(state.language, "deleteItem")}</button>
        </div>
      </div>
      <div class="body">
        <div class="card-topline">
          <span class="tiny-pill">${item.type === "video" ? t(state.language, "tabVideo") : t(state.language, "tabImage")}</span>
          <span class="tiny-pill">${Math.round((item.ai?.confidence ?? 0) * 100)}% AI</span>
        </div>
        <div class="title-row">
          <h2 class="title">${item.title || item.pageTitle || item.sourceUrl}</h2>
        </div>
        <div class="meta">
          <span>${t(state.language, "size")}: ${formatBytes(item.blob.size)}</span>
          <span>${t(state.language, "savedAt")}: ${formatDate(item.createdAt, state.language)}</span>
          <a class="source-link" href="${item.pageUrl || item.sourceUrl}" target="_blank" rel="noreferrer">${item.pageTitle || item.sourceUrl}</a>
        </div>
        <div class="card-footer">
          <button data-action="preview">${t(state.language, "preview")}</button>
          <div class="footer-actions">
            <button data-action="export">${t(state.language, "exportItem")}</button>
            <button data-action="delete">${t(state.language, "deleteItem")}</button>
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
      if (item.type === "image" || item.type === "video") {
        await exportBlobFromPage(item.blob, buildItemFilename(item));
      } else {
        await exportViaBackground([item.id]);
      }
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => deleteItem(item.id));
    card.querySelector(".badge").addEventListener("click", async (event) => {
      event.stopPropagation();
      const options = getCategoryOptions(state.language);
      const nextIndex = (options.findIndex((option) => option.value === item.category) + 1) % options.length;
      await updateCategory(item.id, options[nextIndex].value);
    });
    card.addEventListener("remove", () => URL.revokeObjectURL(previewUrl));
    grid.append(card);
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

async function loadData() {
  const [items, rulesSummary, aiStatus, exportDirectoryHandle, exportDirectoryName] = await Promise.all([
    getAllMedia(),
    extensionApi.runtime.sendMessage({ type: "GET_RULES_SUMMARY" }),
    extensionApi.runtime.sendMessage({ type: "GET_AI_STATUS" }).catch(() => ({ ok: false })),
    getMeta("exportDirectoryHandle", null),
    getMeta("exportDirectoryName", "")
  ]);
  state.items = items;
  state.rulesSummary = rulesSummary.ok ? rulesSummary : { categories: [], tokenCount: 0 };
  state.aiStatus = aiStatus.ok ? aiStatus : null;
  state.exportDirectoryHandle = exportDirectoryHandle;
  state.exportDirectoryName = exportDirectoryName;
  renderFilters();
  renderGrid();
  renderDirectorySummary();
  document.getElementById("model-provider").textContent = state.aiStatus
    ? t(state.language, "hybridModelReady")
    : t(state.language, "rulesFallbackActive");
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

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.mediaType = tab.dataset.type;
      renderFilters();
      renderGrid();
    });
  });

  document.getElementById("language-select").addEventListener("change", async (event) => {
    state.language = event.target.value;
    await setLanguage(state.language);
    renderFilters();
    renderGrid();
    renderDirectorySummary();
  });

  document.getElementById("import-btn").addEventListener("click", () => {
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

  document.getElementById("smart-classify-btn").addEventListener("click", async () => {
    await reclassifyAllItems();
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
}

async function main() {
  state.language = await getLanguage();
  document.documentElement.lang = state.language;
  await bindEvents();
  await loadData();
}

void main();
