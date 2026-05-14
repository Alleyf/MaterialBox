const extensionApi = globalThis.browser ?? globalThis.chrome;
let classifierModulePromise = null;
let toastModulePromise = null;

function collectMedia() {
  const images = [...document.images].map((image) => ({
    type: "image",
    sourceUrl: image.currentSrc || image.src,
    pageUrl: location.href,
    pageTitle: document.title,
    title: image.title || image.alt || "",
    alt: image.alt || "",
    width: image.naturalWidth || image.width || 0,
    height: image.naturalHeight || image.height || 0
  }));

  const videos = [...document.querySelectorAll("video")].map((video) => ({
    type: "video",
    sourceUrl: video.currentSrc || video.src,
    pageUrl: location.href,
    pageTitle: document.title,
    title: video.title || document.title,
    alt: "",
    width: video.videoWidth || video.clientWidth || 0,
    height: video.videoHeight || video.clientHeight || 0
  }));

  return [...images, ...videos].filter((item) => item.sourceUrl);
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
