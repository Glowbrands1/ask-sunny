import {
  idbClearAll,
  idbGetBlob,
  idbGetValue,
  idbListCollection,
  idbPutBlob,
  idbPutRecord,
  idbRemoveBlob,
  idbRemoveRecord,
  idbReplaceCollection,
  idbSetValue,
  indexedDbAvailable,
} from "./indexeddb";
import type { StorageCollection, StorageProvider, StoredBlobMeta } from "./types";

/**
 * The prototype's storage implementation: everything lives in the browser's
 * IndexedDB, so uploads and edits survive a page refresh on the demo machine
 * without any server, database or paid service.
 *
 * Every method degrades gracefully when IndexedDB is unavailable (SSR, private
 * modes, older browsers) — the UI still renders from seeded demo data, it just
 * does not persist.
 */
export class LocalPrototypeStorageProvider implements StorageProvider {
  readonly name = "Local prototype storage (IndexedDB)";

  isAvailable(): boolean {
    return indexedDbAvailable();
  }

  async list<T>(collection: StorageCollection): Promise<T[]> {
    if (!this.isAvailable()) return [];
    try {
      return await idbListCollection<T>(collection);
    } catch {
      return [];
    }
  }

  async replace<T extends { id: string }>(
    collection: StorageCollection,
    records: T[],
  ): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await idbReplaceCollection(collection, records);
    } catch {
      /* Persistence is a convenience in the prototype, never a blocker. */
    }
  }

  async put<T extends { id: string }>(
    collection: StorageCollection,
    record: T,
  ): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await idbPutRecord(collection, record.id, record);
    } catch {
      /* no-op */
    }
  }

  async remove(collection: StorageCollection, id: string): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await idbRemoveRecord(collection, id);
    } catch {
      /* no-op */
    }
  }

  async getValue<T>(key: string): Promise<T | null> {
    if (!this.isAvailable()) return null;
    try {
      return await idbGetValue<T>(key);
    } catch {
      return null;
    }
  }

  async setValue<T>(key: string, value: T): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await idbSetValue(key, value);
    } catch {
      /* no-op */
    }
  }

  async putBlob(
    key: string,
    file: Blob,
    meta: Omit<StoredBlobMeta, "key">,
  ): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await idbPutBlob({ key, blob: file, ...meta });
    } catch {
      /* Large files may exceed the browser quota — the record still lands. */
    }
  }

  async getBlob(key: string): Promise<Blob | null> {
    if (!this.isAvailable()) return null;
    try {
      const envelope = await idbGetBlob(key);
      return envelope?.blob ?? null;
    } catch {
      return null;
    }
  }

  async getBlobMeta(key: string): Promise<StoredBlobMeta | null> {
    if (!this.isAvailable()) return null;
    try {
      const envelope = await idbGetBlob(key);
      if (!envelope) return null;
      const { blob: _blob, ...meta } = envelope;
      void _blob;
      return meta;
    } catch {
      return null;
    }
  }

  async removeBlob(key: string): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await idbRemoveBlob(key);
    } catch {
      /* no-op */
    }
  }

  async clearAll(): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await idbClearAll();
    } catch {
      /* no-op */
    }
  }
}
