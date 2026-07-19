export type CachedApiDocument = {
  id: string;
  data: Record<string, any>;
  version: number;
  createdAt?: string;
  updatedAt?: string;
};

const DB_NAME = 'gmh-suite-hostinger-cache';
const DB_VERSION = 1;
const COLLECTION_STORE = 'collections';
const META_STORE = 'meta';

function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(COLLECTION_STORE)) database.createObjectStore(COLLECTION_STORE);
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  if (!database) return undefined;
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

function scopedKey(userId: string, collectionName: string) {
  return `${userId || 'signed-out'}:${collectionName}`;
}

export async function readCachedCollection(userId: string, collectionName: string): Promise<CachedApiDocument[]> {
  try {
    return (await run<CachedApiDocument[]>(COLLECTION_STORE, 'readonly', store => store.get(scopedKey(userId, collectionName)))) || [];
  } catch {
    return [];
  }
}

export async function writeCachedCollection(userId: string, collectionName: string, documents: CachedApiDocument[]) {
  try {
    await run<IDBValidKey>(COLLECTION_STORE, 'readwrite', store => store.put(documents, scopedKey(userId, collectionName)));
  } catch {
    // Cache writes are best effort and must never block a committed API change.
  }
}

export async function clearDocumentCache() {
  try {
    await run<undefined>(COLLECTION_STORE, 'readwrite', store => store.clear());
    await run<undefined>(META_STORE, 'readwrite', store => store.clear());
  } catch {
    // Ignore browsers that disable IndexedDB.
  }
}
