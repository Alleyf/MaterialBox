import JSZip from "jszip";

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

export async function buildZipBlob(items) {
  const zip = new JSZip();

  for (const item of items) {
    const category = safeName(item.category || "uncategorized");
    const title = safeName(item.title || item.pageTitle || item.id);
    const filename = `${category}/${title}-${item.id}.${guessExtension(item)}`;
    zip.file(filename, item.blob);
  }

  zip.file("materialbox-export.json", JSON.stringify(items.map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    type: item.type,
    mimeType: item.mimeType,
    pageUrl: item.pageUrl,
    sourceUrl: item.sourceUrl,
    createdAt: item.createdAt
  })), null, 2));

  return zip.generateAsync({ type: "blob" });
}
