const DB_NAME = "materialbox-db";
const DB_VERSION = 2;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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
      } else {
        const mediaStore = request.transaction.objectStore("media");
        if (!mediaStore.indexNames.contains("sourceUrl")) {
          mediaStore.createIndex("sourceUrl", "sourceUrl");
        }
        if (!mediaStore.indexNames.contains("contentHash")) {
          mediaStore.createIndex("contentHash", "contentHash");
        }
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = callback(store);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function putMedia(item) {
  await withStore("media", "readwrite", (store) => {
    store.put(item);
  });
  return item;
}

export async function getMedia(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("media", "readonly");
    const request = transaction.objectStore("media").get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllMedia() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("media", "readonly");
    const request = transaction.objectStore("media").getAll();
    request.onsuccess = () => {
      const items = request.result ?? [];
      items.sort((left, right) => right.createdAt - left.createdAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getByIndex(storeName, indexName, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).index(indexName).get(value);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function getMediaBySourceUrl(sourceUrl) {
  if (!sourceUrl) {
    return null;
  }
  return getByIndex("media", "sourceUrl", sourceUrl);
}

export async function getMediaByContentHash(contentHash) {
  if (!contentHash) {
    return null;
  }
  return getByIndex("media", "contentHash", contentHash);
}

export async function deleteMedia(id) {
  await withStore("media", "readwrite", (store) => {
    store.delete(id);
  });
}

export async function putMeta(key, value) {
  await withStore("meta", "readwrite", (store) => {
    store.put({ key, value });
  });
}

export async function getMeta(key, fallbackValue = null) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("meta", "readonly");
    const request = transaction.objectStore("meta").get(key);
    request.onsuccess = () => resolve(request.result?.value ?? fallbackValue);
    request.onerror = () => reject(request.error);
  });
}
