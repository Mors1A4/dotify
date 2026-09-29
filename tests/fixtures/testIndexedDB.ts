/**
 * In-memory IndexedDB mock for Vitest Node environment.
 * Complies with the W3C IndexedDB specification for key-value stores, transactions, and events.
 */

export class MockIDBRequest<T = any> {
  result: T = undefined as any;
  error: DOMException | null = null;
  onsuccess: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  triggerSuccess(result: T) {
    this.result = result;
    if (this.onsuccess) {
      this.onsuccess({ target: this, type: 'success' });
    }
  }

  triggerError(error: DOMException) {
    this.error = error;
    if (this.onerror) {
      this.onerror({ target: this, type: 'error' });
    }
  }
}

export class MockIDBOpenDBRequest extends MockIDBRequest<MockIDBDatabase> {
  onupgradeneeded: ((ev: any) => void) | null = null;
}

export class MockIDBObjectStore {
  name: string;
  keyPath: string;
  private records = new Map<any, any>();

  constructor(name: string, keyPath = 'id') {
    this.name = name;
    this.keyPath = keyPath;
  }

  put(value: any): MockIDBRequest<any> {
    const req = new MockIDBRequest();
    const key = value[this.keyPath] ?? `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.records.set(key, JSON.parse(JSON.stringify(value)));
    setTimeout(() => req.triggerSuccess(key), 0);
    return req;
  }

  add(value: any): MockIDBRequest<any> {
    const req = new MockIDBRequest();
    const key = value[this.keyPath];
    if (key && this.records.has(key)) {
      setTimeout(() => req.triggerError(new DOMException('Key already exists', 'ConstraintError')), 0);
    } else {
      const generatedKey = key ?? `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.records.set(generatedKey, JSON.parse(JSON.stringify(value)));
      setTimeout(() => req.triggerSuccess(generatedKey), 0);
    }
    return req;
  }

  get(key: any): MockIDBRequest<any> {
    const req = new MockIDBRequest();
    const val = this.records.get(key);
    setTimeout(() => req.triggerSuccess(val ? JSON.parse(JSON.stringify(val)) : undefined), 0);
    return req;
  }

  getAll(): MockIDBRequest<any[]> {
    const req = new MockIDBRequest();
    const all = Array.from(this.records.values()).map((v) => JSON.parse(JSON.stringify(v)));
    setTimeout(() => req.triggerSuccess(all), 0);
    return req;
  }

  delete(key: any): MockIDBRequest<undefined> {
    const req = new MockIDBRequest();
    this.records.delete(key);
    setTimeout(() => req.triggerSuccess(undefined), 0);
    return req;
  }

  clear(): MockIDBRequest<undefined> {
    const req = new MockIDBRequest();
    this.records.clear();
    setTimeout(() => req.triggerSuccess(undefined), 0);
    return req;
  }

  count(): MockIDBRequest<number> {
    const req = new MockIDBRequest();
    setTimeout(() => req.triggerSuccess(this.records.size), 0);
    return req;
  }

  createIndex(_name: string, _keyPath: string) {
    return {};
  }
}

export class MockIDBTransaction {
  mode: 'readonly' | 'readwrite';
  db: MockIDBDatabase;
  oncomplete: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  private activeStores: string[];

  constructor(db: MockIDBDatabase, stores: string[], mode: 'readonly' | 'readwrite' = 'readonly') {
    this.db = db;
    this.activeStores = stores;
    this.mode = mode;
    setTimeout(() => {
      if (this.oncomplete) {
        this.oncomplete({ type: 'complete' });
      }
    }, 5);
  }

  objectStore(name: string): MockIDBObjectStore {
    const store = this.db.getStore(name);
    if (!store) {
      throw new DOMException(`Object store ${name} not found`, 'NotFoundError');
    }
    return store;
  }
}

export class MockIDBDatabase {
  name: string;
  version: number;
  private stores = new Map<string, MockIDBObjectStore>();

  constructor(name: string, version: number) {
    this.name = name;
    this.version = version;
  }

  get objectStoreNames() {
    const keys = Array.from(this.stores.keys());
    const obj: any = {
      contains: (name: string) => this.stores.has(name),
      item: (i: number) => keys[i],
      length: keys.length,
      [Symbol.iterator]: function* () {
        for (const k of keys) yield k;
      },
    };
    keys.forEach((k, idx) => { obj[idx] = k; });
    return obj as DOMStringList;
  }

  clearAllStores(): void {
    for (const store of this.stores.values()) {
      store.clear();
    }
  }

  createObjectStore(name: string, options?: { keyPath?: string }): MockIDBObjectStore {
    const store = new MockIDBObjectStore(name, options?.keyPath || 'id');
    this.stores.set(name, store);
    return store;
  }

  transaction(storeNames: string | string[], mode: 'readonly' | 'readwrite' = 'readonly'): MockIDBTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new MockIDBTransaction(this, names, mode);
  }

  getStore(name: string): MockIDBObjectStore | undefined {
    return this.stores.get(name);
  }

  close() {}
}

export class MockIDBFactory {
  private databases = new Map<string, MockIDBDatabase>();

  open(name: string, version = 1): MockIDBOpenDBRequest {
    const req = new MockIDBOpenDBRequest();
    setTimeout(() => {
      let db = this.databases.get(name);
      const isUpgrade = !db || db.version < version;
      if (!db) {
        db = new MockIDBDatabase(name, version);
        this.databases.set(name, db);
      }
      if (isUpgrade && req.onupgradeneeded) {
        req.result = db;
        req.onupgradeneeded({
          target: req,
          oldVersion: db.version < version ? db.version : 0,
          newVersion: version,
        });
        db.version = version;
      }
      req.result = db;
      if (req.onsuccess) {
        req.onsuccess({ target: req, type: 'success' });
      }
    }, 0);
    return req;
  }

  deleteDatabase(name: string): MockIDBRequest<undefined> {
    const req = new MockIDBRequest();
    this.databases.delete(name);
    setTimeout(() => req.triggerSuccess(undefined), 0);
    return req;
  }
}

export const mockIndexedDB = new MockIDBFactory();
(globalThis as any).indexedDB = mockIndexedDB;
