export const extensionApi = globalThis.browser ?? globalThis.chrome;

export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function guessExtension(mimeType, fallbackUrl = "") {
  const mimeMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv",
    "video/quicktime": "mov"
  };
  if (mimeMap[mimeType]) {
    return mimeMap[mimeType];
  }
  try {
    const pathname = new URL(fallbackUrl).pathname;
    const ext = pathname.split(".").pop();
    if (ext && ext.length <= 5) {
      return ext.toLowerCase();
    }
  } catch {
    return "bin";
  }
  return "bin";
}

export function formatBytes(bytes) {
  const value = Number(bytes ?? 0);
  if (!value) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount.toFixed(amount >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDate(timestamp, locale = "en") {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

export function makeDownloadName(item) {
  const stem = slugify(item.title || item.pageTitle || item.category || item.id) || "material";
  const ext = guessExtension(item.mimeType, item.sourceUrl);
  return `materialbox/${item.category || "uncategorized"}/${stem}-${item.id}.${ext}`;
}

export function uniqueValues(list) {
  return [...new Set(list.filter(Boolean))];
}
