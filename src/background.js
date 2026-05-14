import { inferCategory, createEmptyRules, trainRules } from "./lib/classifier.js";
import {
  deleteMedia,
  getAllMedia,
  getMedia,
  getMediaByContentHash,
  getMediaBySourceUrl,
  getMeta,
  putMedia,
  putMeta
} from "./lib/db.js";
import { extensionApi, makeDownloadName } from "./lib/utils.js";

const MENU_IDS = {
  saveImage: "materialbox-save-image",
  saveVideo: "materialbox-save-video"
};
const MODEL_PATH = "src/models/mobilenet-v2-050/model.json";

async function classifyWithVision(media) {
  if (media.type !== "image") {
    return null;
  }

  try {
    const aiRuntime = await import("./generated/ai.bundle.js");
    return await aiRuntime.classifyImageBlob(
      media.blob,
      extensionApi.runtime.getURL(MODEL_PATH)
    );
  } catch (error) {
    console.warn("MaterialBox local AI unavailable", error);
    return null;
  }
}

async function notify(message, title = "MaterialBox") {
  try {
    await extensionApi.notifications.create({
      type: "basic",
      iconUrl: extensionApi.runtime.getURL("src/assets/icons/icon-128.png"),
      title,
      message
    });
  } catch {
    return;
  }
}

async function showSaveToast(tabId, payload) {
  if (!tabId) {
    return;
  }
  try {
    await extensionApi.tabs.sendMessage(tabId, {
      type: "SHOW_SAVE_TOAST",
      payload
    });
  } catch {
    return;
  }
}

async function ensureMenus() {
  const isZh = (extensionApi.i18n?.getUILanguage?.() ?? "en").toLowerCase().startsWith("zh");
  const menus = [
    {
      id: MENU_IDS.saveImage,
      title: isZh ? "保存图片到 MaterialBox" : "Save image to MaterialBox",
      contexts: ["image"]
    },
    {
      id: MENU_IDS.saveVideo,
      title: isZh ? "保存视频到 MaterialBox" : "Save video to MaterialBox",
      contexts: ["video"]
    }
  ];

  for (const menu of menus) {
    try {
      extensionApi.contextMenus.create(menu);
    } catch {
      continue;
    }
  }
}

function getUiLanguage() {
  return (extensionApi.i18n?.getUILanguage?.() ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function getText(language, key, params = {}) {
  const dictionary = {
    en: {
      captureUnavailable: "This page cannot be scanned. Try a normal web page instead.",
      captureEmpty: "No supported images or videos were found on this page.",
      captureSuccess: "Saved {count} item(s) to your library",
      captureFailed: "Save failed. Please try again."
    },
    zh: {
      captureUnavailable: "当前页面无法扫描，请切换到普通网页后再试。",
      captureEmpty: "当前页面没有发现可保存的图片或视频。",
      captureSuccess: "已保存 {count} 个素材到资源库",
      captureFailed: "保存失败，请稍后重试。"
    }
  };
  const template = dictionary[language]?.[key] ?? dictionary.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, token) => String(params[token] ?? ""));
}

async function fetchAsBlob(sourceUrl) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status}`);
  }
  return response.blob();
}

async function computeContentHash(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hashBuffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
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

async function getRules() {
  return (await getMeta("classificationRules", createEmptyRules())) ?? createEmptyRules();
}

async function saveMediaFromSource(payload) {
  const blob = payload.blob ?? await fetchAsBlob(payload.sourceUrl);
  const contentHash = await computeContentHash(blob);
  const duplicate = await getMediaBySourceUrl(payload.sourceUrl) ?? await getMediaByContentHash(contentHash);
  if (duplicate) {
    return {
      ...duplicate,
      deduped: true
    };
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
  return media;
}

async function saveManyMedia(items) {
  const savedItems = [];
  for (const item of items) {
    try {
      const saved = await saveMediaFromSource(item);
      savedItems.push(saved);
    } catch (error) {
      console.warn("MaterialBox save failed", item.sourceUrl, error);
    }
  }
  return savedItems;
}

async function reclassifyStoredMedia() {
  const items = await getAllMedia();
  const rules = await getRules();
  let count = 0;

  for (const item of items) {
    const ruleAi = inferCategory(item, rules);
    const visionAi = await classifyWithVision(item);
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

  return count;
}

async function exportMedia(ids) {
  for (const id of ids) {
    const item = await getMedia(id);
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

async function exportMediaAsZip(ids) {
  const items = [];
  for (const id of ids) {
    const item = await getMedia(id);
    if (item) {
      items.push(item);
    }
  }
  if (!items.length) {
    return;
  }

  const exporter = await import("./generated/export.bundle.js");
  const zipBlob = await exporter.buildZipBlob(items);
  const dataUrl = await blobToDataUrl(zipBlob);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  await extensionApi.downloads.download({
    url: dataUrl,
    filename: `materialbox-export-${timestamp}.zip`,
    saveAs: true
  });
}

extensionApi.runtime.onInstalled.addListener(() => {
  void ensureMenus();
});

extensionApi.runtime.onStartup?.addListener(() => {
  void ensureMenus();
});

extensionApi.contextMenus.onClicked.addListener((info, tab) => {
  const sourceUrl = info.srcUrl;
  if (!sourceUrl) {
    return;
  }
  const type = info.menuItemId === MENU_IDS.saveVideo ? "video" : "image";
  void saveMediaFromSource({
    sourceUrl,
    type,
    pageUrl: tab?.url ?? "",
    pageTitle: tab?.title ?? "",
    title: info.selectionText ?? "",
    tabId: tab?.id ?? null
  }).then((saved) => {
    const isZh = (extensionApi.i18n?.getUILanguage?.() ?? "en").toLowerCase().startsWith("zh");
    const category = saved.category;
    void showSaveToast(tab?.id, {
      title: "MaterialBox",
      message: saved.deduped
        ? (isZh ? `素材已存在于资源库 · ${category}` : `Already in library · ${category}`)
        : (isZh ? `已保存到资源库 · ${category}` : `Saved to library · ${category}`),
      tone: "success"
    });
    void notify(
      saved.deduped
        ? (isZh ? `检测到重复素材，已跳过保存` : "Duplicate detected, skipped saving")
        : (isZh ? `素材已保存，分类到 ${category}` : `Saved successfully to ${category}`)
    );
  }).catch((error) => {
    console.error("MaterialBox save failed", error);
    const isZh = (extensionApi.i18n?.getUILanguage?.() ?? "en").toLowerCase().startsWith("zh");
    void showSaveToast(tab?.id, {
      title: "MaterialBox",
      message: isZh ? "保存失败，请稍后重试" : "Save failed. Please try again.",
      tone: "error"
    });
    void notify(isZh ? "素材保存失败" : "Save failed");
  });
});

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "GET_STATS") {
      const items = await getAllMedia();
      const categories = new Set(items.map((item) => item.category));
      sendResponse({
        total: items.length,
        categories: categories.size,
        videos: items.filter((item) => item.type === "video").length
      });
      return;
    }

    if (message.type === "CAPTURE_ACTIVE_TAB_MEDIA") {
      const language = getUiLanguage();
      const tabId = message.tabId ?? (await extensionApi.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }
      let collected;
      try {
        collected = await extensionApi.tabs.sendMessage(tabId, { type: "COLLECT_PAGE_MEDIA" });
      } catch (error) {
        sendResponse({ ok: false, error: getText(language, "captureUnavailable") });
        return;
      }
      const deduped = [...new Map(
        (collected ?? []).map((item) => [item.sourceUrl, item])
      ).values()].slice(0, 30);
      if (!deduped.length) {
        await showSaveToast(tabId, {
          title: "MaterialBox",
          message: getText(language, "captureEmpty"),
          tone: "info"
        });
        sendResponse({ ok: false, error: getText(language, "captureEmpty") });
        return;
      }
      const saved = await saveManyMedia(deduped);
      await showSaveToast(tabId, {
        title: "MaterialBox",
        message: getText(language, "captureSuccess", { count: saved.length }),
        tone: "success"
      });
      await notify(getText(language, "captureSuccess", { count: saved.length }));
      sendResponse({ ok: true, count: saved.length });
      return;
    }

    if (message.type === "EXPORT_MEDIA") {
      await exportMedia(message.ids ?? []);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "EXPORT_MEDIA_ZIP") {
      await exportMediaAsZip(message.ids ?? []);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "DELETE_MEDIA") {
      await deleteMedia(message.id);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "DELETE_MEDIA_BATCH") {
      for (const id of message.ids ?? []) {
        await deleteMedia(id);
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "UPDATE_CATEGORY") {
      const item = await getMedia(message.id);
      if (!item) {
        sendResponse({ ok: false });
        return;
      }
      const rules = await getRules();
      const updatedRules = trainRules(item, message.category, rules);
      const ai = inferCategory(item, updatedRules);
      item.category = message.category;
      item.ai = {
        ...ai,
        manualOverride: true
      };
      item.updatedAt = Date.now();
      await putMeta("classificationRules", updatedRules);
      await putMedia(item);
      sendResponse({ ok: true, item });
      return;
    }

    if (message.type === "GET_RULES_SUMMARY") {
      const rules = await getRules();
      const categories = Object.keys(rules.learned ?? {});
      sendResponse({
        ok: true,
        categories,
        tokenCount: categories.reduce(
          (sum, category) => sum + Object.keys(rules.learned[category] ?? {}).length,
          0
        )
      });
      return;
    }

    if (message.type === "GET_AI_STATUS") {
      try {
        const aiRuntime = await import("./generated/ai.bundle.js");
        const status = await aiRuntime.getModelMeta(extensionApi.runtime.getURL(MODEL_PATH));
        sendResponse({ ok: true, ...status });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message.type === "RECLASSIFY_ALL_MEDIA") {
      const count = await reclassifyStoredMedia();
      sendResponse({ ok: true, count });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })().catch((error) => {
    console.error("MaterialBox background error", error);
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
