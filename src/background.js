import { createMessageRouter, createContextMenuHandler } from "./background/message-router.js";
import { saveFromSource } from "./background/media-service.js";
import { notifySaveResult, notifySaveError, isZh } from "./background/feedback-service.js";
import { extensionApi } from "./lib/utils.js";

const MENU_IDS = {
  saveImage: "materialbox-save-image",
  saveVideo: "materialbox-save-video"
};

async function ensureMenus() {
  const isLanguageZh = isZh();
  const menus = [
    {
      id: MENU_IDS.saveImage,
      title: isLanguageZh ? "保存图片到 MaterialBox" : "Save image to MaterialBox",
      contexts: ["image"]
    },
    {
      id: MENU_IDS.saveVideo,
      title: isLanguageZh ? "保存视频到 MaterialBox" : "Save video to MaterialBox",
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

extensionApi.runtime.onInstalled.addListener(() => {
  void ensureMenus();
});

extensionApi.runtime.onStartup?.addListener(() => {
  void ensureMenus();
});

extensionApi.contextMenus.onClicked.addListener(async (info, tab) => {
  const sourceUrl = info.srcUrl;
  if (!sourceUrl) {
    return;
  }

  const type = info.menuItemId === MENU_IDS.saveVideo ? "video" : "image";
  const tabId = tab?.id ?? null;

  try {
    const result = await saveFromSource({
      sourceUrl,
      type,
      pageUrl: tab?.url ?? "",
      pageTitle: tab?.title ?? "",
      title: info.selectionText ?? "",
      tabId
    });

    if (result.item) {
      await notifySaveResult(result.item, tabId);
    }
  } catch (error) {
    console.error("MaterialBox save failed", error);
    await notifySaveError(tabId, error);
  }
});

extensionApi.runtime.onMessage.addListener(createMessageRouter());
