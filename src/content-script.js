const extensionApi = globalThis.browser ?? globalThis.chrome;
let classifierModulePromise = null;

const TOAST_STYLE_ID = "materialbox-toast-style";

function ensureToastStyles(doc) {
  if (doc.getElementById(TOAST_STYLE_ID)) {
    return;
  }
  const style = doc.createElement("style");
  style.id = TOAST_STYLE_ID;
  style.textContent = `
    .materialbox-toast-host {
      position: fixed !important;
      top: 24px !important;
      right: 24px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 8px !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
      background: transparent !important;
      border: none !important;
      margin: 0 !important;
      padding: 0 !important;
      max-width: 320px !important;
    }
    .materialbox-toast {
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: linear-gradient(180deg, rgba(18, 24, 34, 0.96), rgba(10, 14, 22, 0.96));
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
      color: #f4f7fb;
      font: 13px/1.4 "Segoe UI", "PingFang SC", sans-serif;
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity 200ms ease, transform 200ms ease;
      overflow: hidden;
      pointer-events: auto;
      word-break: break-word;
    }
    .materialbox-toast.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
    .materialbox-toast__row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .materialbox-toast__dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 5px;
      flex-shrink: 0;
    }
    .materialbox-toast__dot[data-tone="success"] { background: #4ade80; }
    .materialbox-toast__dot[data-tone="error"] { background: #f87171; }
    .materialbox-toast__dot[data-tone="info"] { background: #60a5fa; }
    .materialbox-toast__content { flex: 1; min-width: 0; }
    .materialbox-toast__title { font-weight: 600; margin-bottom: 2px; }
    .materialbox-toast__message { color: #cbd5e1; font-size: 12px; }
    @media (max-width: 480px) {
      .materialbox-toast-host { top: 12px !important; right: 12px !important; left: 12px !important; max-width: none !important; }
    }
  `;
  doc.head?.append(style) ?? doc.documentElement.append(style);
}

function showToast({ document: doc = document, title = "MaterialBox", message, tone = "success", duration = 2800 }) {
  ensureToastStyles(doc);
  const existingToast = doc.querySelector(".materialbox-toast-host");
  if (existingToast) {
    existingToast.remove();
  }
  const host = doc.createElement("dialog");
  host.className = "materialbox-toast-host";
  host.style.cssText = "position:fixed;top:24px;right:24px;margin:0;padding:0;border:none;background:transparent;pointer-events:none;z-index:2147483647;max-width:320px;";
  host.noClose = true;
  const toast = doc.createElement("div");
  toast.className = "materialbox-toast";
  toast.innerHTML = `
    <div class="materialbox-toast__row">
      <div class="materialbox-toast__dot" data-tone="${tone}"></div>
      <div class="materialbox-toast__content">
        <div class="materialbox-toast__title">${title}</div>
        <div class="materialbox-toast__message">${message}</div>
      </div>
    </div>
  `;
  host.appendChild(toast);
  doc.body?.appendChild(host);
  host.show();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("is-visible");
    });
  });
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => {
      host.close();
      host.remove();
    }, 220);
  }, duration);
  return toast;
}

function collectMedia() {
  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || 1) > 0.05;
  }

  function looksLikeGarbage(sourceUrl = "", title = "", alt = "") {
    return /(sprite|spacer|blank|pixel|tracker|beacon|emoji|avatar|favicon|badge|placeholder|thumbnail)/i.test(
      `${sourceUrl} ${title} ${alt}`
    );
  }

  const images = [...document.images]
    .filter((image) => isVisibleElement(image))
    .map((image) => ({
      type: "image",
      sourceUrl: image.currentSrc || image.src,
      pageUrl: location.href,
      pageTitle: document.title,
      title: image.title || image.alt || "",
      alt: image.alt || "",
      width: image.naturalWidth || image.width || 0,
      height: image.naturalHeight || image.height || 0
    }))
    .filter((item) => {
      const ratio = item.width / Math.max(item.height, 1);
      return item.sourceUrl
        && item.width >= 120
        && item.height >= 90
        && item.width * item.height >= 18000
        && ratio <= 4.8
        && ratio >= 0.22
        && !looksLikeGarbage(item.sourceUrl, item.title, item.alt);
    });

  const videos = [...document.querySelectorAll("video")]
    .filter((video) => isVisibleElement(video))
    .map((video) => ({
      type: "video",
      sourceUrl: video.currentSrc || video.src,
      pageUrl: location.href,
      pageTitle: document.title,
      title: video.title || document.title,
      alt: "",
      width: video.videoWidth || video.clientWidth || 0,
      height: video.videoHeight || video.clientHeight || 0
    }))
    .filter((item) => item.sourceUrl && item.width >= 240 && item.height >= 135);

  return [...images, ...videos];
}

async function getClassifierModule() {
  classifierModulePromise ??= import("./lib/page-classifier.js");
  return classifierModulePromise;
}

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "COLLECT_PAGE_MEDIA") {
    sendResponse(collectMedia());
    return;
  }

  if (message.type === "SHOW_SAVE_TOAST") {
    showToast(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "READ_CLIPBOARD_TEXT") {
    navigator.clipboard.readText()
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CLASSIFY_BLOB_IN_PAGE") {
    (async () => {
      const response = await fetch(message.dataUrl);
      const blob = await response.blob();
      const classifier = await getClassifierModule();
      const result = await classifier.classifyImageBlobInPage(blob);
      sendResponse({ ok: true, result });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
});
