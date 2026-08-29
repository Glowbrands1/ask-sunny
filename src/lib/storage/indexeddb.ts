/**
 * Minimal promise wrapper around IndexedDB.
 *
 * Deliberately dependency-free: the prototype must run with `npm install` and
 * nothing else, and this is the only browser API we need. Roughly 100 lines is
 * cheaper than a dependency here.
 */

const DB_NAME = "ask-sunny-prototype";
const DB_VERSION = 1;

export const RECORD_STORE = "records";
export const VALUE_STORE = "values";
export const BLOB_STORE = "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

export function indexedDbAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!indexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        // Composite key: `${collection}::${id}` with a `collection` index so a
        // whole collection can be read in one cursor pass.
        const store = db.createObjectStore(RECORD_STORE, { keyPath: "key" });
        store.createIndex("collection", "collection", { unique: false });
      }
      if (!db.objectStoreNames.contains(VALUE_STORE)) {
        db.createObjectStore(VALUE_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });

  return dbPromise;
}

function runTransaction<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));

        Promise.resolve(work(tx))
          .then((value) => {
            result = value;
          })
          .catch((error) => {
            reject(error);
            tx.abort();
          });
      }),
  );
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export interface RecordEnvelope<T = unknown> {
  key: string;
  collection: string;
  id: string;
  value: T;
}

export async function idbListCollection<T>(collection: string): Promise<T[]> {
  return runTransaction(RECORD_STORE, "readonly", async (tx) => {
    const index = tx.objectStore(RECORD_STORE).index("collection");
    const rows = await request(
      index.getAll(IDBKeyRange.only(collection)) as IDBRequest<RecordEnvelope<T>[]>,
    );
    return rows.map((row) => row.value);
  });
}

export async function idbPutRecord<T>(
  collection: string,
  id: string,
  value: T,
): Promise<void> {
  await runTransaction(RECORD_STORE, "readwrite", (tx) => {
    tx.objectStore(RECORD_STORE).put({
      key: `${collection}::${id}`,
      collection,
      id,
      value,
    } satisfies RecordEnvelope<T>);
  });
}

export async function idbReplaceCollection<T extends { id: string }>(
  collection: string,
  records: T[],
): Promise<void> {
  await runTransaction(RECORD_STORE, "readwrite", async (tx) => {
    const store = tx.objectStore(RECORD_STORE);
    const existing = await request(
      store.index("collection").getAllKeys(IDBKeyRange.only(collection)),
    );
    existing.forEach((key) => store.delete(key));
    records.forEach((record) => {
      store.put({
        key: `${collection}::${record.id}`,
        collection,
        id: record.id,
        value: record,
      } satisfies RecordEnvelope<T>);
    });
  });
}

export async function idbRemoveRecord(collection: string, id: string): Promise<void> {
  await runTransaction(RECORD_STORE, "readwrite", (tx) => {
    tx.objectStore(RECORD_STORE).delete(`${collection}::${id}`);
  });
}

export async function idbGetValue<T>(key: string): Promise<T | null> {
  return runTransaction(VALUE_STORE, "readonly", async (tx) => {
    const row = await request(
      tx.objectStore(VALUE_STORE).get(key) as IDBRequest<{ key: string; value: T }>,
    );
    return row ? row.value : null;
  });
}

export async function idbSetValue<T>(key: string, value: T): Promise<void> {
  await runTransaction(VALUE_STORE, "readwrite", (tx) => {
    tx.objectStore(VALUE_STORE).put({ key, value });
  });
}

export interface BlobEnvelope {
  key: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export async function idbPutBlob(envelope: BlobEnvelope): Promise<void> {
  await runTransaction(BLOB_STORE, "readwrite", (tx) => {
    tx.objectStore(BLOB_STORE).put(envelope);
  });
}

export async function idbGetBlob(key: string): Promise<BlobEnvelope | null> {
  return runTransaction(BLOB_STORE, "readonly", async (tx) => {
    const row = await request(
      tx.objectStore(BLOB_STORE).get(key) as IDBRequest<BlobEnvelope | undefined>,
    );
    return row ?? null;
  });
}

export async function idbRemoveBlob(key: string): Promise<void> {
  await runTransaction(BLOB_STORE, "readwrite", (tx) => {
    tx.objectStore(BLOB_STORE).delete(key);
  });
}

export async function idbClearAll(): Promise<void> {
  await runTransaction([RECORD_STORE, VALUE_STORE, BLOB_STORE], "readwrite", (tx) => {
    tx.objectStore(RECORD_STORE).clear();
    tx.objectStore(VALUE_STORE).clear();
    tx.objectStore(BLOB_STORE).clear();
  });
}
