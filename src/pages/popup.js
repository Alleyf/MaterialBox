import { getLanguage, t } from "../lib/i18n.js";
import { showToast } from "../lib/toast.js";
import { extensionApi } from "../lib/utils.js";

const ICONS = {
  sparkles: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
  </svg>`,
  alertCircle: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>`,
  loader: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
  </svg>`
};

async function openDashboard() {
  const url = extensionApi.runtime.getURL("src/pages/dashboard.html");
  await extensionApi.tabs.create({ url });
}

function updateAiStatusIcon(status) {
  const iconContainer = document.getElementById("ai-status-icon");
  const card = document.getElementById("ai-status-card");
  
  iconContainer.classList.remove("ai-ready", "ai-loading", "ai-error");
  
  if (status === "ready") {
    iconContainer.classList.add("ai-ready");
    iconContainer.innerHTML = ICONS.sparkles;
    card.querySelector(".status-badge").textContent = "Active";
  } else if (status === "error") {
    iconContainer.classList.add("ai-error");
    iconContainer.innerHTML = ICONS.alertCircle;
    card.querySelector(".status-badge").textContent = "Fallback";
  } else {
    iconContainer.classList.add("ai-loading");
    iconContainer.innerHTML = ICONS.loader;
    card.querySelector(".status-badge").textContent = "Loading";
  }
}

async function main() {
  const language = await getLanguage();
  document.documentElement.lang = language;
  
  document.getElementById("popup-title").textContent = t(language, "popupTitle");
  document.getElementById("popup-copy").textContent = t(language, "popupCopy");
  document.getElementById("open-library-text").textContent = t(language, "openLibrary");
  document.getElementById("save-page-text").textContent = t(language, "saveCurrentPage");

  const stats = await extensionApi.runtime.sendMessage({ type: "GET_STATS" }) ?? {};
  const safeStats = {
    images: 0,
    videos: 0,
    categories: 0,
    ...stats
  };
  const statItems = [
    [safeStats.images, t(language, "statsImages")],
    [safeStats.videos, t(language, "statsVideos")],
    [safeStats.categories, t(language, "statsCategories")]
  ];
  
  document.getElementById("stats").innerHTML = statItems
    .map(([value, label]) => `
      <div class="stat-card">
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
      </div>
    `)
    .join("");

  const aiStatus = await extensionApi.runtime.sendMessage({ type: "GET_AI_STATUS" });
  const aiStatusElement = document.getElementById("ai-status");
  
  if (aiStatus.ok) {
    aiStatusElement.textContent = t(language, "hybridModelReady");
    updateAiStatusIcon("ready");
  } else {
    aiStatusElement.textContent = t(language, "rulesFallbackActive");
    updateAiStatusIcon("error");
  }

  document.getElementById("open-library").addEventListener("click", () => {
    void openDashboard();
  });

  document.getElementById("save-page").addEventListener("click", async () => {
    const saveBtn = document.getElementById("save-page");
    const originalContent = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <span>Saving...</span>
    `;
    
    try {
      const [tab] = await extensionApi.tabs.query({ active: true, lastFocusedWindow: true });
      const result = await extensionApi.runtime.sendMessage({
        type: "CAPTURE_ACTIVE_TAB_MEDIA",
        tabId: tab?.id ?? null
      });
      
      if (!result.ok) {
        throw new Error(result.error || t(language, "saveFailed"));
      }
      
      showToast({
        title: "MaterialBox",
        message: result.filtered
          ? t(language, "saveSuccessFiltered", { count: result.count, filtered: result.filtered })
          : t(language, "saveSuccess", { count: result.count }),
        tone: "success",
        duration: 2600
      });
    } catch (error) {
      showToast({
        title: "MaterialBox",
        message: error.message || t(language, "saveFailed"),
        tone: "error",
        duration: 3200
      });
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalContent;
    }
  });
}

const style = document.createElement("style");
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

void main();
