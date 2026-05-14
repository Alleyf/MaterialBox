import path from "node:path";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = process.cwd();
const distRoot = path.join(root, "dist");
const browserDirs = {
  chrome: {
    manifestPath: path.join(root, "manifest.json")
  },
  firefox: {
    manifestPath: path.join(root, "manifest.firefox.json")
  }
};

async function copyInto(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await Promise.all([
    cp(path.join(root, "_locales"), path.join(targetDir, "_locales"), { recursive: true }),
    cp(path.join(root, "src"), path.join(targetDir, "src"), { recursive: true }),
    cp(
      path.join(root, "node_modules", "@mediapipe", "tasks-vision"),
      path.join(targetDir, "node_modules", "@mediapipe", "tasks-vision"),
      { recursive: true }
    )
  ]);
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

for (const [browser, config] of Object.entries(browserDirs)) {
  const targetDir = path.join(distRoot, browser);
  await copyInto(targetDir);
  const manifest = await readFile(config.manifestPath, "utf8");
  await writeFile(path.join(targetDir, "manifest.json"), manifest);
}
