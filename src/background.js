import { createMessageRouter, createContextMenuHandler } from "./background/message-router.js";
import { saveFromSource } from "./background/media-service.js";
import { notifySaveResult, notifySaveError, isZh } from "./background/feedback-service.js";
import { extensionApi } from "./lib/utils.js";

const MENU_IDS = {
  saveImage: "materialbox-save-image",
  saveVideo: "materialbox-save-video",
  savePrompt: "materialbox-save-prompt"
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
    },
    {
      id: MENU_IDS.savePrompt,
      title: isLanguageZh ? "保存到提示词收藏" : "Save to Prompts",
      contexts: ["selection", "page"]
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
  const tabId = tab?.id ?? null;

  if (info.menuItemId === MENU_IDS.savePrompt) {
    const content = info.selectionText || "";
    const pageUrl = tab?.url ?? "";
    const pageTitle = tab?.title ?? "";

    if (!content && !pageUrl) {
      return;
    }

    const prompt = {
      id: crypto.randomUUID(),
      title: content.slice(0, 30) || (isZh() ? "无标题" : "Untitled"),
      content: content,
      sourceUrl: pageUrl,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "SAVE_PROMPT",
        prompt
      });
      if (result?.ok) {
        const title = isZh() ? "提示词已保存" : "Prompt saved";
        extensionApi.tabs.sendMessage(tabId, { type: "SHOW_TOAST", title, message: prompt.title });
      }
    } catch (error) {
      console.error("MaterialBox save prompt failed", error);
    }
    return;
  }

  if (!sourceUrl) {
    return;
  }

  const type = info.menuItemId === MENU_IDS.saveVideo ? "video" : "image";

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
