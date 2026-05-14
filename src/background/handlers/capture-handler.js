import { extensionApi } from "../../lib/utils.js";
import { getLanguage, t } from "../../lib/i18n.js";
import { saveMany, saveFromSource } from "../media-service.js";
import { showCaptureResult, showCaptureError, showCaptureEmpty, notifySaveResult, notifySaveError } from "../feedback-service.js";

export async function handleCaptureActiveTabMedia({ message }) {
  const language = await getLanguage();
  const tabId = message.tabId ?? (await extensionApi.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;

  if (!tabId) {
    return { ok: false, error: "No active tab" };
  }

  let collected;
  try {
    collected = await extensionApi.tabs.sendMessage(tabId, { type: "COLLECT_PAGE_MEDIA" });
  } catch (error) {
    return { ok: false, error: t(language, "captureUnavailable") };
  }

  const deduped = [...new Map(
    (collected ?? []).map((item) => [item.sourceUrl, item])
  ).values()].slice(0, 30);

  if (!deduped.length) {
    await showCaptureEmpty(tabId);
    return { ok: false, error: t(language, "captureEmpty") };
  }

  const { savedItems, filteredCount } = await saveMany(deduped);
  await showCaptureResult(tabId, savedItems.length, filteredCount);

  return { ok: true, count: savedItems.length, filtered: filteredCount };
}

export async function handleSaveFromContextMenu({ message }) {
  const { sourceUrl, type, pageUrl, pageTitle, title, tabId } = message;
  const tab = tabId ? await extensionApi.tabs.get(tabId).catch(() => null) : null;
  const effectivePageUrl = pageUrl || (tab?.url ?? "");
  const effectivePageTitle = pageTitle || (tab?.title ?? "");

  try {
    const result = await saveFromSource({
      sourceUrl,
      type,
      pageUrl: effectivePageUrl,
      pageTitle: effectivePageTitle,
      title,
      tabId
    });

    if (result.item) {
      await notifySaveResult(result.item, tabId);
    }

    return { ok: true, deduped: result.deduped };
  } catch (error) {
    console.error("MaterialBox save failed", error);
    await notifySaveError(tabId, error);
    return { ok: false, error: error.message };
  }
}
