const DB_NAME = "materialbox-db";
const DB_VERSION = 3;

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
      if (!db.objectStoreNames.contains("prompts")) {
        const promptsStore = db.createObjectStore("prompts", { keyPath: "id" });
        promptsStore.createIndex("createdAt", "createdAt");
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

const DEFAULT_TAGS_EN = [
  { id: "favorite", name: "Favorite", color: "#f59e0b" },
  { id: "to-review", name: "To Review", color: "#8b5cf6" },
  { id: "approved", name: "Approved", color: "#10b981" },
  { id: "rejected", name: "Rejected", color: "#f43f5e" }
];

const DEFAULT_TAGS_ZH = [
  { id: "favorite", name: "收藏", color: "#f59e0b" },
  { id: "to-review", name: "待审核", color: "#8b5cf6" },
  { id: "approved", name: "已批准", color: "#10b981" },
  { id: "rejected", name: "已拒绝", color: "#f43f5e" }
];

export async function getTags(language = "en") {
  const defaultTags = language === "zh" ? DEFAULT_TAGS_ZH : DEFAULT_TAGS_EN;
  const tags = await getMeta("tags", defaultTags);
  return tags;
}

export async function saveTags(tags) {
  await putMeta("tags", tags);
  return tags;
}

export async function addTag(tag) {
  const tags = await getTags();
  const existingTag = tags.find(t => t.id === tag.id || t.name.toLowerCase() === tag.name.toLowerCase());
  if (existingTag) {
    return tags;
  }
  tags.push(tag);
  await saveTags(tags);
  return tags;
}

export async function removeTag(tagId) {
  const tags = await getTags();
  const filtered = tags.filter(t => t.id !== tagId);
  await saveTags(filtered);
  return filtered;
}

export async function updateTag(tagId, updates) {
  const tags = await getTags();
  const index = tags.findIndex(t => t.id === tagId);
  if (index !== -1) {
    tags[index] = { ...tags[index], ...updates };
    await saveTags(tags);
  }
  return tags;
}

export async function addTagToMedia(mediaId, tagId) {
  const item = await getMedia(mediaId);
  if (!item) return null;
  if (!item.tags) {
    item.tags = [];
  }
  if (!item.tags.includes(tagId)) {
    item.tags.push(tagId);
    await putMedia(item);
  }
  return item;
}

export async function removeTagFromMedia(mediaId, tagId) {
  const item = await getMedia(mediaId);
  if (!item) return null;
  if (item.tags) {
    item.tags = item.tags.filter(t => t !== tagId);
    await putMedia(item);
  }
  return item;
}

export async function getMediaByTag(tagId) {
  const allMedia = await getAllMedia();
  return allMedia.filter(item => item.tags && item.tags.includes(tagId));
}

const DEFAULT_COLLECTIONS = [
  { id: "favorites", name: "Favorites", type: "static", items: [], isSmart: false, rules: null }
];

export async function getCollections() {
  const collections = await getMeta("collections", DEFAULT_COLLECTIONS);
  return collections;
}

export async function saveCollections(collections) {
  await putMeta("collections", collections);
  return collections;
}

export async function createCollection(collection) {
  const collections = await getCollections();
  collections.push(collection);
  await saveCollections(collections);
  return collections;
}

export async function updateCollection(collectionId, updates) {
  const collections = await getCollections();
  const index = collections.findIndex(c => c.id === collectionId);
  if (index !== -1) {
    collections[index] = { ...collections[index], ...updates };
    await saveCollections(collections);
  }
  return collections;
}

export async function deleteCollection(collectionId) {
  const collections = await getCollections();
  const filtered = collections.filter(c => c.id !== collectionId);
  await saveCollections(filtered);
  return filtered;
}

export async function addToCollection(collectionId, mediaId) {
  const collections = await getCollections();
  const collection = collections.find(c => c.id === collectionId);
  if (collection && !collection.items.includes(mediaId)) {
    collection.items.push(mediaId);
    await saveCollections(collections);
  }
  return collections;
}

export async function removeFromCollection(collectionId, mediaId) {
  const collections = await getCollections();
  const collection = collections.find(c => c.id === collectionId);
  if (collection) {
    collection.items = collection.items.filter(id => id !== mediaId);
    await saveCollections(collections);
  }
  return collections;
}

export async function getCollectionItems(collectionId, allMedia) {
  const collections = await getCollections();
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return [];
  
  if (collection.isSmart && collection.rules) {
    return evaluateSmartRules(collection.rules, allMedia);
  }
  
  return allMedia.filter(item => collection.items.includes(item.id));
}

function evaluateSmartRules(rules, allMedia) {
  return allMedia.filter(item => {
    if (rules.category && item.category !== rules.category) return false;
    if (rules.type && item.type !== rules.type) return false;
    if (rules.sourceDomain) {
      try {
        const url = new URL(item.sourceUrl);
        if (!url.hostname.includes(rules.sourceDomain)) return false;
      } catch {
        return false;
      }
    }
    if (rules.minWidth && item.width < rules.minWidth) return false;
    if (rules.maxWidth && item.width > rules.maxWidth) return false;
    return true;
  });
}

// Prompt functions
export async function putPrompt(prompt) {
  await withStore("prompts", "readwrite", (store) => {
    store.put(prompt);
  });
  return prompt;
}

export async function getPrompt(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("prompts", "readonly");
    const request = transaction.objectStore("prompts").get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllPrompts() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("prompts", "readonly");
    const request = transaction.objectStore("prompts").getAll();
    request.onsuccess = () => {
      const items = request.result ?? [];
      items.sort((left, right) => right.createdAt - left.createdAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deletePrompt(id) {
  await withStore("prompts", "readwrite", (store) => {
    store.delete(id);
  });
}

export async function updatePrompt(id, updates) {
  const prompt = await getPrompt(id);
  if (!prompt) return null;
  const updated = { ...prompt, ...updates, updatedAt: Date.now() };
  await putPrompt(updated);
  return updated;
}
