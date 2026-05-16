import { getAllMedia, getRulesSummary, getAiStatus, getFilterConfig, updateFilterConfig } from "../media-service.js";

export async function handleGetStats() {
  const items = await getAllMedia();
  const categories = new Set(items.map((item) => item.category));
  return {
    ok: true,
    total: items.length,
    categories: categories.size,
    videos: items.filter((item) => item.type === "video").length,
    images: items.filter((item) => item.type === "image").length
  };
}

export async function handleGetRulesSummary() {
  const summary = await getRulesSummary();
  return { ok: true, ...summary };
}

export async function handleGetAiStatus() {
  try {
    const status = await getAiStatus();
    return { ok: true, ...status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function handleGetFilterConfig() {
  const config = await getFilterConfig();
  return { ok: true, config };
}

export async function handleUpdateFilterConfig({ message }) {
  const { updates } = message;
  const config = await updateFilterConfig(updates);
  return { ok: true, config };
}
