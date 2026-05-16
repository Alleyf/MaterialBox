// IndexedDB mock for testing
// Simplified implementation that properly handles async transactions

class MockIDBObjectStore {
  constructor(name) {
    this.name = name;
    this.data = new Map();
    this.indexes = new Map();
    this.indexNames = {
      _names: [],
      contains: (name) => this.indexNames._names.includes(name),
      get length() {
        return this._names.length;
      }
    };
  }

  get(key) {
    const result = this.data.get(key) ?? null;
    return this._createRequest(result);
  }

  put(item) {
    this.data.set(item.key || item.id, item);
    return this._createRequest(item);
  }

  delete(key) {
    this.data.delete(key);
    return this._createRequest(undefined);
  }

  getAll() {
    return this._createRequest(Array.from(this.data.values()));
  }

  index(indexName) {
    const store = this;
    return {
      get(value) {
        let found = null;
        for (const item of store.data.values()) {
          if (item[indexName] === value) {
            found = item;
            break;
          }
        }
        return store._createRequest(found);
      }
    };
  }

  createIndex(name, keyPath) {
    this.indexes.set(name, keyPath);
    if (!this.indexNames._names.includes(name)) {
      this.indexNames._names.push(name);
    }
  }

  _createRequest(result) {
    const request = {
      result,
      error: null,
      onsuccess: null,
      onerror: null
    };

    // Trigger onsuccess asynchronously to give caller time to set handler
    Promise.resolve().then(() => {
      if (typeof request.onsuccess === 'function') {
        request.onsuccess();
      }
    });

    return request;
  }
}

class MockIDBTransaction {
  constructor(storeNames, mode, db) {
    this.mode = mode;
    this.db = db;
    this._storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this.aborted = false;
    this._completed = false;
  }

  objectStore(name) {
    if (!this._storeNames.includes(name)) {
      throw new Error(`Object store "${name}" not found in transaction`);
    }
    return this.db._getStore(name);
  }

  get oncomplete() {
    return this._oncomplete;
  }

  set oncomplete(handler) {
    this._oncomplete = handler;
    // Auto-trigger oncomplete after current operation
    setTimeout(() => {
      if (!this.aborted && !this._completed && this._oncomplete) {
        this._completed = true;
        this._oncomplete();
      }
    }, 0);
  }

  get onerror() {
    return this._onerror;
  }

  set onerror(handler) {
    this._onerror = handler;
  }

  get onabort() {
    return this._onabort;
  }

  set onabort(handler) {
    this._onabort = handler;
  }

  abort() {
    this.aborted = true;
    if (this._onabort) {
      this._onabort();
    }
  }
}

class MockIDBDatabase {
  constructor() {
    this.objectStoreNames = {
      _names: [],
      contains: (name) => this.objectStoreNames._names.includes(name),
      get length() {
        return this._names.length;
      }
    };
    this._stores = {};
  }

  createObjectStore(name, options) {
    const store = new MockIDBObjectStore(name);
    this._stores[name] = store;
    if (!this.objectStoreNames._names.includes(name)) {
      this.objectStoreNames._names.push(name);
    }
    return store;
  }

  transaction(storeNames, mode) {
    return new MockIDBTransaction(storeNames, mode, this);
  }

  _getStore(name) {
    return this._stores[name];
  }
}

class MockIndexedDB {
  constructor() {
    // Store database instances by name
    this.databases = {};
  }

  open(name, version) {
    // Reuse existing database instance if available
    if (!this.databases[name]) {
      this.databases[name] = new MockIDBDatabase();
    }

    const db = this.databases[name];
    const transaction = new MockIDBTransaction(['media', 'meta', 'prompts'], 'versionchange', db);

    const request = {
      result: db,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      transaction: transaction
    };

    // Simulate async database open
    setTimeout(() => {
      if (request.onupgradeneeded) {
        request.onupgradeneeded({
          oldVersion: version - 1,
          newVersion: version
        });
      }
      if (request.onsuccess) {
        request.onsuccess();
      }
    }, 0);

    return request;
  }

  // Method to reset the database (for testing)
  reset(name) {
    // Delete the database to force re-creation
    delete this.databases[name];
  }
}

// Singleton instance
const mockIDB = new MockIndexedDB();
global.indexedDB = mockIDB;
global.IDBTransaction = {
  READ_ONLY: 'readonly',
  READ_WRITE: 'readwrite',
  VERSION_CHANGE: 'versionchange'
};

export { mockIDB };
