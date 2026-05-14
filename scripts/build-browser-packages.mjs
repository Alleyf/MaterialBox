import path from "node:path";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = process.cwd();
const distRoot = path.join(root, "dist");
const browserDirs = {
  chrome: {
    manifestPath: path.join(root, "manifest.chrome.json"),
    useSimd: true
  },
  firefox: {
    manifestPath: path.join(root, "manifest.firefox.json"),
    useSimd: true
  }
};

async function copyInto(targetDir, browser) {
  await mkdir(targetDir, { recursive: true });
  
  await cp(path.join(root, "_locales"), path.join(targetDir, "_locales"), { recursive: true });
  await cp(path.join(root, "src"), path.join(targetDir, "src"), { recursive: true });
  
  const srcWasmDir = path.join(targetDir, "src", "models", "mediapipe", "wasm");
  const srcModelsRoot = path.join(root, "src", "models", "mediapipe");
  
  const keepSimd = browser.useSimd;
  
  const wasmFiles = [
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_module_internal.js",
    "vision_wasm_module_internal.wasm",
    "vision_wasm_nosimd_internal.js",
    "vision_wasm_nosimd_internal.wasm",
    "vision_wasm_module_nosimd_internal.js",
    "vision_wasm_module_nosimd_internal.wasm"
  ];
  
  for (const file of wasmFiles) {
    const isSimd = !file.includes("nosimd");
    if (isSimd !== keepSimd) {
      await rm(path.join(srcWasmDir, file), { force: true });
    }
  }
  
  const mpRoot = path.join(root, "node_modules", "@mediapipe", "tasks-vision");
  const mpTarget = path.join(targetDir, "node_modules", "@mediapipe", "tasks-vision");
  
  await mkdir(path.join(mpTarget), { recursive: true });
  
  const coreFiles = ["package.json", "vision_bundle.cjs", "vision_bundle.mjs", "vision.d.ts"];
  for (const file of coreFiles) {
    await cp(path.join(mpRoot, file), path.join(mpTarget, file));
  }
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

for (const [browser, config] of Object.entries(browserDirs)) {
  const targetDir = path.join(distRoot, browser);
  await copyInto(targetDir, config);
  const manifest = await readFile(config.manifestPath, "utf8");
  await writeFile(path.join(targetDir, "manifest.json"), manifest);
}
