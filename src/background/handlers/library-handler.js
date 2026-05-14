import {
  deleteMedia,
  deleteMediaBatch,
  exportMedia,
  exportMediaAsZip,
  getMedia,
  updateCategory
} from "../media-service.js";

export async function handleDeleteMedia({ message }) {
  await deleteMedia(message.id);
  return { ok: true };
}

export async function handleDeleteMediaBatch({ message }) {
  await deleteMediaBatch(message.ids ?? []);
  return { ok: true };
}

export async function handleExportMedia({ message }) {
  await exportMedia(message.ids ?? []);
  return { ok: true };
}

export async function handleExportMediaZip({ message }) {
  await exportMediaAsZip(message.ids ?? []);
  return { ok: true };
}

export async function handleUpdateCategory({ message }) {
  const item = await updateCategory(message.id, message.category);
  if (!item) {
    return { ok: false };
  }
  return { ok: true, item };
}
