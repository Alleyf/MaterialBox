import test from "node:test";
import assert from "node:assert/strict";
import { mapVisionPredictionsToCategory } from "../src/lib/ai-taxonomy.js";

test("maps website-like predictions to ui", () => {
  const result = mapVisionPredictionsToCategory([
    { className: "website, internet site", probability: 0.72 },
    { className: "monitor", probability: 0.18 }
  ]);

  assert.deepEqual(result, {
    label: "ui",
    confidence: 0.99
  });
});

test("returns null when predictions do not match the taxonomy", () => {
  const result = mapVisionPredictionsToCategory([
    { className: "goldfish", probability: 0.92 }
  ]);

  assert.equal(result, null);
});
