const extensionApi = globalThis.browser ?? globalThis.chrome;
let classifierModulePromise = null;
let toastModulePromise = null;

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

async function getToastModule() {
  toastModulePromise ??= import("./lib/toast.js");
  return toastModulePromise;
}

async function showToast(payload) {
  const { showToast: renderToast } = await getToastModule();
  renderToast({
    document,
    ...payload
  });
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
