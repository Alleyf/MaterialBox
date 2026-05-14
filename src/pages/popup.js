import { getLanguage, t } from "../lib/i18n.js";
import { showToast } from "../lib/toast.js";
import { extensionApi } from "../lib/utils.js";

async function openDashboard() {
  const url = extensionApi.runtime.getURL("src/pages/dashboard.html");
  await extensionApi.tabs.create({ url });
}

async function main() {
  const language = await getLanguage();
  document.documentElement.lang = language;
  document.getElementById("popup-title").textContent = t(language, "popupTitle");
  document.getElementById("popup-copy").textContent = t(language, "popupCopy");
  document.getElementById("open-library").textContent = t(language, "openLibrary");
  document.getElementById("save-page").textContent = t(language, "saveCurrentPage");

  const stats = await extensionApi.runtime.sendMessage({ type: "GET_STATS" });
  const statItems = [
    [stats.total, t(language, "statsSaved")],
    [stats.categories, t(language, "statsCategories")],
    [stats.videos, t(language, "statsVideos")]
  ];
  document.getElementById("stats").innerHTML = statItems
    .map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");

  const aiStatus = await extensionApi.runtime.sendMessage({ type: "GET_AI_STATUS" });
  document.getElementById("ai-status").textContent = aiStatus.ok
    ? t(language, "hybridModelReady")
    : t(language, "rulesFallbackActive");

  document.getElementById("open-library").addEventListener("click", () => {
    void openDashboard();
  });

  document.getElementById("save-page").addEventListener("click", async () => {
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
    }
  });
}

void main();
