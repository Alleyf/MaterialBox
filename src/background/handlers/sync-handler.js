import { uploadSyncArchive, downloadSyncArchive, testSyncConnection } from "../../lib/sync.js";
import { getAllMedia, getMeta, putMeta } from "../../lib/db.js";
import { createEmptyRules } from "../../lib/classifier.js";

async function runSyncUpload(settings) {
  const items = await getAllMedia();
  const rules = await getMeta("classificationRules", createEmptyRules());
  return uploadSyncArchive(settings, { items, rules });
}

async function runSyncDownload(settings) {
  const payload = await downloadSyncArchive(settings);
  const { getMediaByContentHash, getMediaBySourceUrl, putMedia } = await import("../../lib/db.js");
  let importedCount = 0;

  for (const item of payload.items) {
    const duplicate = await getMediaByContentHash(item.contentHash) ?? await getMediaBySourceUrl(item.sourceUrl);
    if (duplicate) {
      continue;
    }
    await putMedia({
      id: crypto.randomUUID(),
      blob: item.blob,
      type: item.type,
      mimeType: item.mimeType,
      sourceUrl: item.sourceUrl,
      pageUrl: item.pageUrl,
      pageTitle: item.pageTitle,
      title: item.title,
      alt: item.alt,
      width: item.width,
      height: item.height,
      category: item.category,
      ai: item.ai,
      tags: item.tags ?? [],
      contentHash: item.contentHash,
      createdAt: item.createdAt ?? Date.now(),
      updatedAt: item.updatedAt ?? Date.now()
    });
    importedCount += 1;
  }

  if (payload.rules) {
    await putMeta("classificationRules", payload.rules);
  }

  return importedCount;
}

export async function handleSyncUpload({ message }) {
  const count = await runSyncUpload(message.settings);
  return { ok: true, count };
}

export async function handleSyncDownload({ message }) {
  const count = await runSyncDownload(message.settings);
  return { ok: true, count };
}

export async function handleSyncTest({ message }) {
  await testSyncConnection(message.settings);
  return { ok: true };
}
