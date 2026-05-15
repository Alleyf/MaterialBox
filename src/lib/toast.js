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
      display: grid;
      gap: 12px;
      pointer-events: none;
      z-index: 2147483647;
    }

    .materialbox-toast {
      min-width: 264px;
      max-width: min(360px, calc(100vw - 32px));
      padding: 14px 16px;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: linear-gradient(180deg, rgba(18, 24, 34, 0.96), rgba(10, 14, 22, 0.96));
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.32);
      backdrop-filter: blur(18px);
      color: #f4f7fb;
      font: 13px/1.45 "Aptos", "Segoe UI", "PingFang SC", sans-serif;
      transform: translateY(-8px) scale(0.98);
      opacity: 0;
      transition: opacity 180ms ease, transform 180ms ease;
      overflow: hidden;
    }

    .materialbox-toast.is-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    .materialbox-toast__row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .materialbox-toast__dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      margin-top: 4px;
      flex: 0 0 auto;
      box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.04);
    }

    .materialbox-toast__dot[data-tone="success"] {
      background: #8df0cf;
      box-shadow: 0 0 0 6px rgba(141, 240, 207, 0.08);
    }

    .materialbox-toast__dot[data-tone="error"] {
      background: #ff9a9a;
      box-shadow: 0 0 0 6px rgba(255, 154, 154, 0.08);
    }

    .materialbox-toast__dot[data-tone="info"] {
      background: #8dbfff;
      box-shadow: 0 0 0 6px rgba(141, 191, 255, 0.08);
    }

    .materialbox-toast__title {
      font-weight: 700;
      margin-bottom: 4px;
    }

    .materialbox-toast__message {
      color: #b9c5d4;
    }

    .materialbox-toast__bar {
      height: 2px;
      margin: 12px -16px -14px;
      background: linear-gradient(90deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0));
      transform-origin: left;
      animation: materialbox-toast-bar linear forwards;
    }

    @keyframes materialbox-toast-bar {
      from { transform: scaleX(1); }
      to { transform: scaleX(0); }
    }

    @media (max-width: 720px) {
      .materialbox-toast-host {
        top: 16px !important;
        right: 16px !important;
        left: 16px !important;
      }

      .materialbox-toast {
        min-width: 0;
        max-width: 100%;
      }
    }
  `;
  doc.head?.append(style) ?? doc.documentElement.append(style);
}

function ensureToastHost(doc) {
  ensureToastStyles(doc);
  let host = doc.querySelector(".materialbox-toast-host");
  if (host) {
    return host;
  }
  // Use dialog element so toast enters top layer (above showModal dialogs)
  const dialog = doc.createElement("dialog");
  dialog.className = "materialbox-toast-host";
  dialog.style.cssText = "position:fixed;top:24px;right:24px;background:transparent;border:none;pointer-events:none;margin:0;padding:0;";
  doc.documentElement.appendChild(dialog);
  return dialog;
}

export function showToast({
  document: doc = document,
  title = "MaterialBox",
  message,
  tone = "success",
  duration = 2800
}) {
  const host = ensureToastHost(doc);
  const toast = doc.createElement("div");
  toast.className = "materialbox-toast";
  toast.innerHTML = `
    <div class="materialbox-toast__row">
      <div class="materialbox-toast__dot" data-tone="${tone}"></div>
      <div>
        <div class="materialbox-toast__title">${title}</div>
        <div class="materialbox-toast__message">${message}</div>
      </div>
    </div>
    <div class="materialbox-toast__bar" style="animation-duration:${duration}ms"></div>
  `;
  host.appendChild(toast);

  // Use show() (not showModal()) to enter top layer without blocking
  if (!host.open) {
    host.show();
  }

  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => {
      toast.remove();
      if (host.children.length === 0 && host.close) {
        host.close();
      }
    }, 220);
  }, duration);

  return toast;
}
