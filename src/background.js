import { createMessageRouter, createContextMenuHandler } from "./background/message-router.js";
import { saveFromSource } from "./background/media-service.js";
import { notifySaveResult, notifySaveError, notifySaveFiltered, notifySaveDuplicate, showSaveToast, isZh } from "./background/feedback-service.js";
import { extensionApi } from "./lib/utils.js";

const MENU_IDS = {
  saveImage: "materialbox-save-image",
  saveVideo: "materialbox-save-video",
  savePrompt: "materialbox-save-prompt",
  saveClipboard: "materialbox-save-clipboard"
};

async function ensureMenus() {
  // First, try to remove any existing menus to avoid conflicts
  try {
    for (const id of Object.values(MENU_IDS)) {
      try {
        extensionApi.contextMenus.remove(id);
      } catch {
        // Ignore if doesn't exist
      }
    }
  } catch {
    // contextMenus.remove might not be available
  }

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
    },
    {
      id: MENU_IDS.saveClipboard,
      title: isLanguageZh ? "保存剪切板到提示词" : "Save clipboard to Prompts",
      contexts: ["page"]
    }
  ];

  for (const menu of menus) {
    try {
      extensionApi.contextMenus.create(menu);
      console.log("MaterialBox: Created menu:", menu.id);
    } catch (error) {
      console.error("MaterialBox: Failed to create menu:", menu.id, error);
    }
  }
}

// Call ensureMenus immediately on script load
void ensureMenus();

extensionApi.runtime.onInstalled.addListener(() => {
  console.log("MaterialBox: Extension installed, ensuring menus");
  void ensureMenus();
});

extensionApi.runtime.onStartup?.addListener(() => {
  console.log("MaterialBox: Extension startup, ensuring menus");
  void ensureMenus();
});

extensionApi.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log("MaterialBox: Context menu clicked", info.menuItemId, info.srcUrl);
  const sourceUrl = info.srcUrl;
  const tabId = tab?.id ?? null;

  if (info.menuItemId === MENU_IDS.savePrompt) {
    const content = info.selectionText || "";
    const pageUrl = tab?.url ?? "";
    const pageTitle = tab?.title ?? "";

    console.log("MaterialBox: Save prompt clicked", { content, pageUrl, hasTab: !!tab });

    if (!content) {
      console.log("MaterialBox: No content selected, skipping");
      const zh = isZh();
      await notify(zh ? "请先选中文本再保存提示词" : "Please select text first");
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
      console.log("MaterialBox: Sending SAVE_PROMPT message");
      const result = await extensionApi.runtime.sendMessage({
        type: "SAVE_PROMPT",
        prompt
      });
      console.log("MaterialBox: SAVE_PROMPT result", result);
      if (result?.ok) {
        const title = isZh() ? "提示词已保存" : "Prompt saved";
        await extensionApi.tabs.sendMessage(tabId, { type: "SHOW_SAVE_TOAST", payload: { title, message: prompt.title, tone: "success" } });
        console.log("MaterialBox: Toast sent for prompt");
      } else {
        console.log("MaterialBox: SAVE_PROMPT returned not ok", result);
        await notify(isZh() ? "提示词保存失败" : "Prompt save failed");
      }
    } catch (error) {
      console.error("MaterialBox save prompt failed", error);
      await notify(isZh() ? "提示词保存失败" : "Prompt save failed");
    }
    return;
  }

  if (info.menuItemId === MENU_IDS.saveClipboard) {
    console.log("MaterialBox: Save clipboard to prompts clicked", { tabId });

    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "SAVE_PROMPT_FROM_CLIPBOARD",
        tabId
      });
      console.log("MaterialBox: SAVE_PROMPT_FROM_CLIPBOARD result", result);

      if (result?.ok && result?.prompt) {
        const title = isZh() ? "提示词已保存" : "Prompt saved";
        await extensionApi.tabs.sendMessage(tabId, { type: "SHOW_SAVE_TOAST", payload: { title, message: result.prompt.title, tone: "success" } });
        console.log("MaterialBox: Clipboard toast sent");
      } else {
        const errorMsg = result?.error || (isZh() ? "保存失败" : "Save failed");
        await notify(errorMsg);
      }
    } catch (error) {
      console.error("MaterialBox save clipboard failed", error);
      await notify(isZh() ? "剪切板保存失败" : "Clipboard save failed");
    }
    return;
  }

  if (!sourceUrl) {
    console.log("MaterialBox: No sourceUrl, skipping");
    return;
  }

  const type = info.menuItemId === MENU_IDS.saveVideo ? "video" : "image";
  console.log("MaterialBox: Saving media", { type, sourceUrl });

  try {
    const result = await saveFromSource({
      sourceUrl,
      type,
      pageUrl: tab?.url ?? "",
      pageTitle: tab?.title ?? "",
      title: info.selectionText ?? "",
      tabId
    });

    console.log("MaterialBox: saveFromSource result", result);

    if (result.item) {
      await notifySaveResult(result.item, tabId);
    } else if (result.deduped) {
      await notifySaveDuplicate(tabId);
    } else if (result.filtered) {
      await notifySaveFiltered(tabId);
    }
  } catch (error) {
    console.error("MaterialBox save failed", error);
    await notifySaveError(tabId, error);
  }
});

extensionApi.runtime.onMessage.addListener(createMessageRouter());

console.log("MaterialBox: Background script loaded");
