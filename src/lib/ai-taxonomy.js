const IMAGE_AI_RULES = {
  ui: ["web site", "website", "monitor", "screen", "laptop", "desktop computer", "menu", "comic book"],
  illustration: ["comic book", "book jacket", "mask", "abaya", "gown", "velvet", "theater curtain"],
  photography: ["valley", "seashore", "lakeside", "volcano", "alp", "promontory", "cliff", "coral reef"],
  product: ["packet", "envelope", "wallet", "handbag", "perfume", "espresso maker", "camera", "cellular telephone", "mouse", "keyboard", "lotion", "shoe shop", "vase"],
  meme: ["comic book", "mask", "balloon", "television", "website"],
  texture: ["velvet", "wool", "sandbar", "coral fungus", "bubble", "tile roof", "chain mail"],
  tutorial: ["book jacket", "website", "menu", "monitor"],
  inspiration: ["website", "comic book", "book jacket", "stage", "theater curtain"]
};

export function mapVisionPredictionsToCategory(predictions = []) {
  const scores = new Map();

  for (const prediction of predictions) {
    const label = String(prediction.className ?? "").toLowerCase();
    for (const [category, keywords] of Object.entries(IMAGE_AI_RULES)) {
      if (keywords.some((keyword) => label.includes(keyword))) {
        scores.set(category, (scores.get(category) ?? 0) + prediction.probability);
      }
    }
  }

  const best = [...scores.entries()].sort((left, right) => right[1] - left[1])[0];
  if (!best) {
    return null;
  }

  return {
    label: best[0],
    confidence: Number(Math.min(0.99, 0.45 + best[1]).toFixed(2))
  };
}
