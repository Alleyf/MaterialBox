import * as tf from "@tensorflow/tfjs";
import * as mobilenet from "@tensorflow-models/mobilenet";
import { mapVisionPredictionsToCategory } from "./ai-taxonomy.js";

let modelPromise = null;

async function ensureBackend() {
  if (tf.getBackend() !== "cpu") {
    await tf.setBackend("cpu");
  }
  await tf.ready();
}

async function loadModel(modelUrl) {
  await ensureBackend();
  return mobilenet.load({
    version: 2,
    alpha: 0.5,
    modelUrl,
    inputRange: [0, 1]
  });
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function blobToImageInput(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = createCanvas(224, 224);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 224, 224);
  bitmap.close();
  return canvas;
}

export async function classifyImageBlob(blob, modelUrl) {
  const model = modelPromise ??= loadModel(modelUrl);
  const resolvedModel = await model;
  const imageInput = await blobToImageInput(blob);
  const predictions = await resolvedModel.classify(imageInput, 5);
  const mapped = mapVisionPredictionsToCategory(predictions);

  return {
    provider: "tensorflowjs-mobilenet",
    predictions: predictions.map((item) => ({
      label: item.className,
      probability: Number(item.probability.toFixed(4))
    })),
    label: mapped?.label ?? null,
    confidence: mapped?.confidence ?? Number((predictions[0]?.probability ?? 0).toFixed(2))
  };
}

export async function getModelMeta(modelUrl) {
  const model = modelPromise ??= loadModel(modelUrl);
  await model;
  return {
    ready: true,
    provider: "tensorflowjs-mobilenet",
    modelUrl
  };
}
