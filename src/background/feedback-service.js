import { extensionApi } from "../lib/utils.js";
import { getLanguage, t } from "../lib/i18n.js";

export async function showSaveToast(tabId, payload) {
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

export async function showCaptureResult(tabId, savedCount, filteredCount) {
  const language = await getLanguage();
  const successMessage = filteredCount
    ? t(language, "captureSuccessFiltered", { count: savedCount, filtered: filteredCount })
    : t(language, "captureSuccess", { count: savedCount });

  await showSaveToast(tabId, {
    title: "MaterialBox",
    message: successMessage,
    tone: "success"
  });

  await notify(successMessage);
}

export async function showCaptureError(tabId, errorKey) {
  const language = await getLanguage();
  await showSaveToast(tabId, {
    title: "MaterialBox",
    message: t(language, errorKey),
    tone: "error"
  });
}

export async function showCaptureEmpty(tabId) {
  const language = await getLanguage();
  await showSaveToast(tabId, {
    title: "MaterialBox",
    message: t(language, "captureEmpty"),
    tone: "info"
  });
}

export async function notify(message, title = "MaterialBox") {
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

export function isZh() {
  return (extensionApi.i18n?.getUILanguage?.() ?? "en").toLowerCase().startsWith("zh");
}

export async function notifySaveResult(saved, tabId) {
  const zh = isZh();
  const category = saved.category;

  await showSaveToast(tabId, {
    title: "MaterialBox",
    message: saved.deduped
      ? (zh ? `素材已存在于资源库 · ${category}` : `Already in library · ${category}`)
      : (zh ? `已保存到资源库 · ${category}` : `Saved to library · ${category}`),
    tone: "success"
  });

  await notify(
    saved.deduped
      ? (zh ? "检测到重复素材，已跳过保存" : "Duplicate detected, skipped saving")
      : (zh ? `素材已保存，分类到 ${category}` : `Saved successfully to ${category}`)
  );
}

export async function notifySaveError(tabId, error) {
  const zh = isZh();
  await showSaveToast(tabId, {
    title: "MaterialBox",
    message: zh ? "保存失败，请稍后重试" : "Save failed. Please try again.",
    tone: "error"
  });
  await notify(zh ? "素材保存失败" : "Save failed");
}
