import { uniqueValues } from "./utils.js";

const DEFAULT_RULES = {
  inspiration: ["inspiration", "collect", "moodboard", "reference", "灵感", "参考"],
  ui: ["ui", "ux", "app", "dashboard", "landing", "mobile", "界面", "组件", "设计稿", "web"],
  illustration: ["illustration", "artwork", "drawing", "anime", "vector", "插画", "绘画"],
  photography: ["photo", "photography", "portrait", "travel", "nature", "摄影", "风景", "人像"],
  product: ["product", "mockup", "branding", "packaging", "商品", "电商", "品牌"],
  meme: ["meme", "reaction", "funny", "gif", "梗图", "表情", "搞笑"],
  texture: ["texture", "pattern", "material", "background", "surface", "纹理", "背景"],
  tutorial: ["tutorial", "howto", "course", "guide", "教程", "步骤", "指南"],
  video: ["video", "reel", "shorts", "movie", "clip", "录像", "视频"]
};

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:/._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTokens(media) {
  const joined = normalizeText([
    media.title,
    media.alt,
    media.pageTitle,
    media.pageUrl,
    media.sourceUrl,
    media.mimeType,
    media.type
  ].join(" "));

  const tokens = joined
    .split(/[\s/_.:?=&-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  return uniqueValues(tokens);
}

export function createEmptyRules() {
  return {
    version: 1,
    learned: {}
  };
}

export function inferCategory(media, rules = createEmptyRules()) {
  const tokens = extractTokens(media);
  const scores = new Map([["uncategorized", 0.2], ["misc", 0.1]]);

  for (const [category, keywords] of Object.entries(DEFAULT_RULES)) {
    for (const token of tokens) {
      if (keywords.some((keyword) => token.includes(keyword))) {
        scores.set(category, (scores.get(category) ?? 0) + 1.5);
      }
    }
  }

  for (const [category, learnedTokens] of Object.entries(rules.learned ?? {})) {
    for (const token of tokens) {
      const learnedWeight = learnedTokens[token] ?? 0;
      if (learnedWeight) {
        scores.set(category, (scores.get(category) ?? 0) + learnedWeight);
      }
    }
  }

  if (media.type === "video") {
    scores.set("video", (scores.get("video") ?? 0) + 2);
  }
  if ((media.width ?? 0) > 1200 && (media.height ?? 0) > 1200) {
    scores.set("photography", (scores.get("photography") ?? 0) + 0.5);
  }
  if ((media.width ?? 0) >= 1000 && (media.height ?? 0) <= 800) {
    scores.set("ui", (scores.get("ui") ?? 0) + 0.6);
  }

  const sorted = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  const [label, topScore] = sorted[0] ?? ["uncategorized", 0];
  const secondScore = sorted[1]?.[1] ?? 0;
  const confidence = Math.max(0.2, Math.min(0.98, 0.5 + (topScore - secondScore) / 4));

  return {
    label,
    confidence: Number(confidence.toFixed(2)),
    tokens,
    scores: Object.fromEntries(sorted)
  };
}

export function trainRules(media, targetCategory, existingRules = createEmptyRules()) {
  const rules = structuredClone(existingRules);
  rules.learned[targetCategory] ??= {};
  const tokens = extractTokens(media);

  for (const token of tokens) {
    if (token.length < 3) {
      continue;
    }
    rules.learned[targetCategory][token] = Math.min(
      (rules.learned[targetCategory][token] ?? 0) + 0.35,
      3
    );
  }

  return rules;
}
