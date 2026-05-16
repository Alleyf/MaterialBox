import { describe, it, expect, beforeEach } from 'vitest';
import {
  putMedia,
  getMedia,
  getAllMedia,
  deleteMedia,
  putMeta,
  getMeta,
  getTags,
  addTag,
  removeTag,
  updateTag,
  putPrompt,
  getAllPrompts,
  deletePrompt,
  getCollections,
  createCollection,
  deleteCollection
} from './db.js';

const DB_NAME = 'materialbox-db';
const DB_VERSION = 3;

async function resetDatabase() {
  // Use mock's reset method to clear database
  global.indexedDB.reset(DB_NAME);
  // Open database and wait for onupgradeneeded and onsuccess to complete
  return new Promise((resolve) => {
    const request = global.indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve();
    // Fallback timeout
    setTimeout(resolve, 500);
  });
}

describe('db.js - Media operations', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('putMedia and getMedia', () => {
    it('should store and retrieve a media item', async () => {
      const item = {
        id: 'test-1',
        title: 'Test Image',
        category: 'image',
        type: 'image',
        sourceUrl: 'https://example.com/image.jpg',
        createdAt: Date.now()
      };

      await putMedia(item);
      const retrieved = await getMedia('test-1');

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe('test-1');
      expect(retrieved.title).toBe('Test Image');
      expect(retrieved.category).toBe('image');
    });

    it('should return null for non-existent media', async () => {
      const result = await getMedia('non-existent');
      expect(result).toBeNull();
    });

    it('should update existing media item', async () => {
      const item = {
        id: 'test-2',
        title: 'Original Title',
        category: 'image',
        type: 'image',
        createdAt: Date.now()
      };

      await putMedia(item);

      const updated = { ...item, title: 'Updated Title' };
      await putMedia(updated);

      const retrieved = await getMedia('test-2');
      expect(retrieved.title).toBe('Updated Title');
    });
  });

  describe('getAllMedia', () => {
    it('should return all media items sorted by createdAt descending', async () => {
      const item1 = { id: 'a', title: 'First', createdAt: 1000 };
      const item2 = { id: 'b', title: 'Second', createdAt: 2000 };
      const item3 = { id: 'c', title: 'Third', createdAt: 1500 };

      await putMedia(item1);
      await putMedia(item2);
      await putMedia(item3);

      const all = await getAllMedia();

      expect(all).toHaveLength(3);
      expect(all[0].id).toBe('b'); // newest first
      expect(all[1].id).toBe('c');
      expect(all[2].id).toBe('a');
    });

    it('should return empty array when no media exists', async () => {
      const all = await getAllMedia();
      expect(all).toEqual([]);
    });
  });

  describe('deleteMedia', () => {
    it('should delete a media item', async () => {
      const item = { id: 'delete-me', title: 'To Delete', createdAt: Date.now() };
      await putMedia(item);

      let retrieved = await getMedia('delete-me');
      expect(retrieved).toBeDefined();

      await deleteMedia('delete-me');

      retrieved = await getMedia('delete-me');
      expect(retrieved).toBeNull();
    });
  });
});

describe('db.js - Meta operations', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('putMeta and getMeta', () => {
    it('should store and retrieve meta values', async () => {
      await putMeta('setting1', 'value1');
      const result = await getMeta('setting1');
      expect(result).toBe('value1');
    });

    it('should return fallback value for non-existent key', async () => {
      const result = await getMeta('non-existent', 'default');
      expect(result).toBe('default');
    });

    it('should return null by default for non-existent key', async () => {
      const result = await getMeta('non-existent');
      expect(result).toBeNull();
    });
  });
});

describe('db.js - Tags operations', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('getTags', () => {
    it('should return default tags when none saved', async () => {
      const tags = await getTags('en');
      expect(tags).toHaveLength(4);
      expect(tags[0].id).toBe('favorite');
    });

    it('should return Chinese tags when language is zh', async () => {
      const tags = await getTags('zh');
      expect(tags).toHaveLength(4);
      expect(tags[0].name).toBe('收藏');
    });
  });

  describe('addTag', () => {
    it('should add a new tag', async () => {
      const newTag = { id: 'custom', name: 'Custom Tag', color: '#ff0000' };
      const tags = await addTag(newTag);
      expect(tags).toHaveLength(5);
      expect(tags.find(t => t.id === 'custom')).toBeDefined();
    });

    it('should not add duplicate tag by id', async () => {
      const existingTag = { id: 'favorite', name: 'Duplicate', color: '#000000' };
      const tags = await addTag(existingTag);
      expect(tags).toHaveLength(4); // still 4, not 5
    });
  });

  describe('removeTag', () => {
    it('should remove a tag by id', async () => {
      const tags = await removeTag('favorite');
      expect(tags).toHaveLength(3);
      expect(tags.find(t => t.id === 'favorite')).toBeUndefined();
    });
  });

  describe('updateTag', () => {
    it('should update tag properties', async () => {
      const tags = await updateTag('favorite', { name: 'Favourited', color: '#123456' });
      const updated = tags.find(t => t.id === 'favorite');
      expect(updated.name).toBe('Favourited');
      expect(updated.color).toBe('#123456');
    });
  });
});

describe('db.js - Prompts operations', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('putPrompt and getAllPrompts', () => {
    it('should store and retrieve prompts', async () => {
      const prompt = {
        id: 'prompt-1',
        title: 'Test Prompt',
        content: 'Hello world',
        createdAt: Date.now()
      };

      await putPrompt(prompt);
      const prompts = await getAllPrompts();

      expect(prompts).toHaveLength(1);
      expect(prompts[0].id).toBe('prompt-1');
      expect(prompts[0].content).toBe('Hello world');
    });

    it('should sort prompts by createdAt descending', async () => {
      const prompt1 = { id: 'p1', title: 'First', content: 'a', createdAt: 1000 };
      const prompt2 = { id: 'p2', title: 'Second', content: 'b', createdAt: 2000 };

      await putPrompt(prompt1);
      await putPrompt(prompt2);

      const prompts = await getAllPrompts();
      expect(prompts[0].id).toBe('p2'); // newest first
    });
  });

  describe('deletePrompt', () => {
    it('should delete a prompt', async () => {
      const prompt = { id: 'to-delete', title: 'Delete Me', content: 'test', createdAt: Date.now() };
      await putPrompt(prompt);

      let prompts = await getAllPrompts();
      expect(prompts).toHaveLength(1);

      await deletePrompt('to-delete');

      prompts = await getAllPrompts();
      expect(prompts).toHaveLength(0);
    });
  });
});

describe('db.js - Collections operations', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('getCollections', () => {
    it('should return default collections when none saved', async () => {
      const collections = await getCollections();
      expect(collections).toHaveLength(1);
      expect(collections[0].id).toBe('favorites');
    });
  });

  describe('createCollection', () => {
    it('should create a new collection', async () => {
      const newCollection = {
        id: 'my-collection',
        name: 'My Collection',
        type: 'static',
        items: [],
        isSmart: false
      };

      const collections = await createCollection(newCollection);
      expect(collections).toHaveLength(2);
      expect(collections.find(c => c.id === 'my-collection')).toBeDefined();
    });
  });

  describe('deleteCollection', () => {
    it('should delete a collection', async () => {
      const newCollection = {
        id: 'to-delete',
        name: 'Delete Me',
        type: 'static',
        items: [],
        isSmart: false
      };

      await createCollection(newCollection);
      let collections = await getCollections();
      expect(collections).toHaveLength(2);

      await deleteCollection('to-delete');

      collections = await getCollections();
      expect(collections).toHaveLength(1);
      expect(collections.find(c => c.id === 'to-delete')).toBeUndefined();
    });
  });
});
