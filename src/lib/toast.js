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

    .materialbox-toast__dot[data-tone="success"] {
      background: #4ade80;
    }

    .materialbox-toast__dot[data-tone="error"] {
      background: #f87171;
    }

    .materialbox-toast__dot[data-tone="info"] {
      background: #60a5fa;
    }

    .materialbox-toast__content {
      flex: 1;
      min-width: 0;
    }

    .materialbox-toast__title {
      font-weight: 600;
      margin-bottom: 2px;
    }

    .materialbox-toast__message {
      color: #cbd5e1;
      font-size: 12px;
    }

    @media (max-width: 480px) {
      .materialbox-toast-host {
        top: 12px !important;
        right: 12px !important;
        left: 12px !important;
        max-width: none !important;
      }
    }
  `;
  doc.head?.append(style) ?? doc.documentElement.append(style);
}

export function showToast({
  document: doc = document,
  title = "MaterialBox",
  message,
  tone = "success",
  duration = 2800
}) {
  ensureToastStyles(doc);

  // Remove any existing toast elements
  const existingToast = doc.querySelector(".materialbox-toast-host");
  if (existingToast) {
    existingToast.remove();
  }

  // Use dialog element with show() to leverage top layer while staying non-blocking
  const host = doc.createElement("dialog");
  host.className = "materialbox-toast-host";
  host.style.cssText = "position:fixed;top:24px;right:24px;margin:0;padding:0;border:none;background:transparent;pointer-events:none;z-index:2147483647;max-width:320px;";
  host.noClose = true;

  // Create individual toast
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

  // Show the dialog (non-modal, no backdrop)
  host.show();

  // Trigger visibility animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("is-visible");
    });
  });

  // Remove toast after duration
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => {
      host.close();
      host.remove();
    }, 220);
  }, duration);

  return toast;
}
