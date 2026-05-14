import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyRules, inferCategory, trainRules } from "../src/lib/classifier.js";

test("classifies UI screenshots with matching keywords", () => {
  const result = inferCategory({
    title: "mobile ui dashboard mockup",
    alt: "",
    pageTitle: "Landing page inspiration",
    pageUrl: "https://example.com/ui",
    sourceUrl: "https://cdn.example.com/ui-shot.png",
    mimeType: "image/png",
    type: "image",
    width: 1440,
    height: 900
  });

  assert.equal(result.label, "ui");
  assert.ok(result.confidence >= 0.5);
});

test("biases videos into video category", () => {
  const result = inferCategory({
    title: "case study clip",
    alt: "",
    pageTitle: "Product launch",
    pageUrl: "https://example.com/video",
    sourceUrl: "https://example.com/clip.mp4",
    mimeType: "video/mp4",
    type: "video",
    width: 1920,
    height: 1080
  });

  assert.equal(result.label, "video");
});

test("learned rules influence future categorization", () => {
  const media = {
    title: "acme packaging showcase",
    alt: "",
    pageTitle: "Design reference",
    pageUrl: "https://example.com/brand",
    sourceUrl: "https://example.com/mockup.jpg",
    mimeType: "image/jpeg",
    type: "image",
    width: 1200,
    height: 1200
  };

  const rules = trainRules(media, "product", createEmptyRules());
  const result = inferCategory({
    ...media,
    title: "acme packaging detail"
  }, rules);

  assert.equal(result.label, "product");
});
