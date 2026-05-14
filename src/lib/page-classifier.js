import { FilesetResolver, ImageClassifier } from "../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs";
import { mapVisionPredictionsToCategory } from "./ai-taxonomy.js";
import { extensionApi } from "./utils.js";

let classifierPromise = null;

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function blobToImageSource(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function getClassifier() {
  classifierPromise ??= (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      extensionApi.runtime.getURL("src/models/mediapipe/wasm")
    );
    return ImageClassifier.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: extensionApi.runtime.getURL("src/models/mediapipe/efficientnet_lite0.tflite")
      },
      maxResults: 5
    });
  })();
  return classifierPromise;
}

export async function classifyImageBlobInPage(blob) {
  const classifier = await getClassifier();
  const imageSource = await blobToImageSource(blob);
  const result = classifier.classify(imageSource);
  const categories = result.classifications?.[0]?.categories ?? [];
  const predictions = categories.map((item) => ({
    label: item.categoryName,
    probability: Number(item.score.toFixed(4))
  }));
  const mapped = mapVisionPredictionsToCategory(predictions.map((item) => ({
    className: item.label,
    probability: item.probability
  })));

  return {
    provider: "mediapipe-efficientnet-lite0",
    predictions,
    label: mapped?.label ?? null,
    confidence: mapped?.confidence ?? Number((predictions[0]?.probability ?? 0).toFixed(2))
  };
}
