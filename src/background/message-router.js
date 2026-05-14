import { runMessage, ok } from "./response.js";
import { handleCaptureActiveTabMedia, handleSaveFromContextMenu } from "./handlers/capture-handler.js";
import { handleDeleteMedia, handleDeleteMediaBatch, handleExportMedia, handleExportMediaZip, handleUpdateCategory } from "./handlers/library-handler.js";
import { handleSyncUpload, handleSyncDownload, handleSyncTest } from "./handlers/sync-handler.js";
import { handleGetStats, handleGetRulesSummary, handleGetAiStatus } from "./handlers/stats-handler.js";

const handlers = {
  GET_STATS: handleGetStats,
  CAPTURE_ACTIVE_TAB_MEDIA: handleCaptureActiveTabMedia,
  EXPORT_MEDIA: handleExportMedia,
  EXPORT_MEDIA_ZIP: handleExportMediaZip,
  DELETE_MEDIA: handleDeleteMedia,
  DELETE_MEDIA_BATCH: handleDeleteMediaBatch,
  UPDATE_CATEGORY: handleUpdateCategory,
  GET_RULES_SUMMARY: handleGetRulesSummary,
  GET_AI_STATUS: handleGetAiStatus,
  SYNC_UPLOAD: handleSyncUpload,
  SYNC_DOWNLOAD: handleSyncDownload,
  SYNC_TEST: handleSyncTest
};

export function createMessageRouter() {
  return function routeMessage(message, sender, sendResponse) {
    const handler = handlers[message.type];
    if (!handler) {
      sendResponse(ok({ error: "Unknown message type" }));
      return;
    }

    runMessage(handler, { message, sender }).then((result) => {
      sendResponse(result);
    });

    return true;
  };
}

export function createContextMenuHandler() {
  return handleSaveFromContextMenu;
}
