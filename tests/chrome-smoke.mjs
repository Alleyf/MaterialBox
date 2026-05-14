import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const projectRoot = process.cwd();
const extensionRoot = path.join(projectRoot, "dist", "chrome");
const extensionId = "johopokopbeiiggpnhohkkehbpaibhin";
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "materialbox-chrome-"));

function createServer() {
  const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnVNo8AAAAASUVORK5CYII=";
  const html = `<!doctype html>
  <html lang="en">
    <body style="background:#10141a;color:#fff;font-family:Segoe UI,sans-serif">
      <h1>MaterialBox Smoke Fixture</h1>
      <img src="${imageDataUrl}" alt="fixture image" />
      <img src="${imageDataUrl}" alt="fixture image duplicate" />
    </body>
  </html>`;

  return http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
}

function waitForWrite(page, minCount) {
  return page.waitForFunction(
    (count) => (window.__materialboxWrites?.length ?? 0) >= count,
    minCount,
    { timeout: 30_000 }
  );
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const fixtureUrl = `http://127.0.0.1:${address.port}/`;

let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`
    ]
  });

  await context.addInitScript(() => {
    window.__materialboxWrites = [];
    window.showSaveFilePicker = async ({ suggestedName } = {}) => ({
      async createWritable() {
        return {
          async write(blob) {
            const size = blob?.size ?? 0;
            const type = blob?.type ?? "";
            window.__materialboxWrites.push({
              suggestedName: suggestedName ?? "unnamed",
              size,
              type
            });
          },
          async close() {}
        };
      }
    });
  });

  const fixturePage = await context.newPage();
  await fixturePage.goto(fixtureUrl, { waitUntil: "networkidle" });

  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${extensionId}/src/pages/dashboard.html`, { waitUntil: "domcontentloaded" });

  await dashboard.evaluate(async () => {
    async function createImageBlob() {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 220;
      const context2d = canvas.getContext("2d");
      context2d.fillStyle = "#0f1724";
      context2d.fillRect(0, 0, 320, 220);
      context2d.fillStyle = "#6ea8fe";
      context2d.fillRect(18, 18, 284, 184);
      context2d.fillStyle = "#8df0cf";
      context2d.fillRect(42, 42, 118, 136);
      context2d.fillStyle = "#f4f7fb";
      context2d.fillRect(182, 58, 96, 18);
      context2d.fillRect(182, 92, 72, 12);
      context2d.fillRect(182, 118, 84, 12);
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Canvas image export failed"));
          }
        }, "image/png");
      });
    }

    const imageBlob = await createImageBlob();

    async function createVideoBlob() {
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 96;
      const context2d = canvas.getContext("2d");
      context2d.fillStyle = "#6ea8fe";
      context2d.fillRect(0, 0, 96, 96);
      context2d.fillStyle = "#8df0cf";
      context2d.fillRect(12, 12, 72, 72);
      const stream = canvas.captureStream(12);
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          chunks.push(event.data);
        }
      };
      const done = new Promise((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 800));
      recorder.stop();
      return done;
    }

    const videoBlob = await createVideoBlob();

    const openDatabase = () => new Promise((resolve, reject) => {
      const request = indexedDB.open("materialbox-db", 2);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("media")) {
          const mediaStore = db.createObjectStore("media", { keyPath: "id" });
          mediaStore.createIndex("createdAt", "createdAt");
          mediaStore.createIndex("category", "category");
          mediaStore.createIndex("type", "type");
          mediaStore.createIndex("sourceUrl", "sourceUrl");
          mediaStore.createIndex("contentHash", "contentHash");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });

    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["media", "meta"], "readwrite");
      const mediaStore = transaction.objectStore("media");
      mediaStore.clear();
      mediaStore.put({
        id: "smoke-image-1",
        blob: imageBlob,
        type: "image",
        mimeType: "image/png",
        sourceUrl: "https://example.test/image-1.png",
        pageUrl: "https://example.test",
        pageTitle: "Smoke image one",
        title: "Smoke image one",
        alt: "",
        width: 1,
        height: 1,
        category: "ui",
        ai: {
          label: "ui",
          confidence: 0.94,
          provider: "smoke"
        },
        tags: ["smoke"],
        contentHash: "hash-image-1",
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      mediaStore.put({
        id: "smoke-image-2",
        blob: imageBlob,
        type: "image",
        mimeType: "image/png",
        sourceUrl: "https://example.test/image-2.png",
        pageUrl: "https://example.test",
        pageTitle: "Smoke image two",
        title: "Smoke image two",
        alt: "",
        width: 1,
        height: 1,
        category: "illustration",
        ai: {
          label: "illustration",
          confidence: 0.9,
          provider: "smoke"
        },
        tags: ["smoke"],
        contentHash: "hash-image-2",
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000
      });
      mediaStore.put({
        id: "smoke-video-1",
        blob: videoBlob,
        type: "video",
        mimeType: "video/webm",
        sourceUrl: "https://example.test/video-1.webm",
        pageUrl: "https://example.test",
        pageTitle: "Smoke video one",
        title: "Smoke video one",
        alt: "",
        width: 96,
        height: 96,
        category: "video",
        ai: {
          label: "video",
          confidence: 0.88,
          provider: "smoke"
        },
        tags: ["smoke"],
        contentHash: "hash-video-1",
        createdAt: Date.now() - 20_000,
        updatedAt: Date.now() - 20_000
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  });

  await dashboard.reload({ waitUntil: "domcontentloaded" });
  await dashboard.waitForSelector(".card");
  assert.equal(await dashboard.locator(".card").count(), 3);

  await dashboard.locator(".card").first().locator(".thumb").click();
  await dashboard.waitForSelector("#preview-dialog[open]");
  await dashboard.locator("#image-export-btn").click();
  await waitForWrite(dashboard, 1);
  const firstWrite = await dashboard.evaluate(() => window.__materialboxWrites[0]);
  assert.match(firstWrite.suggestedName, /smoke image one/i);
  assert.ok(firstWrite.size > 0);
  await dashboard.locator("#studio-close-btn").click();

  await dashboard.locator("#select-visible-btn").click();
  await dashboard.locator("#export-btn").click();
  await waitForWrite(dashboard, 2);
  const writes = await dashboard.evaluate(() => window.__materialboxWrites);
  assert.ok(writes.some((entry) => entry.suggestedName.endsWith(".zip")));

  await dashboard.locator('[data-type="video"]').click();
  await dashboard.locator(".card").first().locator(".thumb").click();
  await dashboard.waitForSelector("#video-export-btn");
  await dashboard.locator("#video-export-btn").click();
  await waitForWrite(dashboard, 3);
  const finalWrites = await dashboard.evaluate(() => window.__materialboxWrites);
  assert.ok(finalWrites.some((entry) => entry.suggestedName.includes("clip")));

  const contentScriptProbe = await dashboard.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    const media = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_PAGE_MEDIA" });
    await chrome.tabs.sendMessage(tab.id, {
      type: "SHOW_SAVE_TOAST",
      payload: {
        title: "MaterialBox",
        message: "Smoke toast",
        tone: "success"
      }
    });
    return media.length;
  }, fixtureUrl);
  assert.ok(contentScriptProbe >= 2);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/pages/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForSelector("#open-library");
  assert.ok((await popup.locator("#ai-status").textContent())?.trim().length > 0);
  await fixturePage.bringToFront();
  await popup.locator("#save-page").click();
  await popup.waitForSelector(".materialbox-toast.is-visible");

  console.log("Chrome smoke passed");
} finally {
  server.close();
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}
