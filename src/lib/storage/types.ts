/**
 * STORAGE ABSTRACTION
 * ---------------------------------------------------------------------------
 * Knowledge Base, Videos, Forms and the permissions matrix all read and write
 * through this interface. Nothing in `features/` knows whether the bytes end up
 * in IndexedDB, Supabase Storage or a SharePoint document library.
 *
 * Implementations:
 *   - LocalPrototypeStorageProvider (this phase)  -> IndexedDB in the browser
 *   - SupabaseStorageProvider       (later)       -> Postgres + Supabase Storage
 *   - SharePointStorageProvider     (later)       -> Microsoft Graph
 *
 * Deliberately NOT implemented here: any fake Supabase client, any hardwired
 * SharePoint call. Seams only.
 */

/** Named record collections the prototype persists. */
export type StorageCollection =
  | "knowledge_documents"
  | "videos"
  | "generated_forms"
  | "form_templates"
  | "chat_conversations"
  | "permission_matrix"
  | "app_state";

export interface StoredBlobMeta {
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface StorageProvider {
  /** Human label surfaced on the Integrations page. */
  readonly name: string;
  /** True once the underlying store is usable in this environment. */
  isAvailable(): boolean;

  /** Read every record in a collection. Returns [] when nothing is stored. */
  list<T>(collection: StorageCollection): Promise<T[]>;
  /** Replace an entire collection. */
  replace<T extends { id: string }>(
    collection: StorageCollection,
    records: T[],
  ): Promise<void>;
  /** Insert or update a single record by id. */
  put<T extends { id: string }>(
    collection: StorageCollection,
    record: T,
  ): Promise<void>;
  /** Remove a single record by id. */
  remove(collection: StorageCollection, id: string): Promise<void>;

  /** Read a single keyed value (used for the permission matrix, UI state). */
  getValue<T>(key: string): Promise<T | null>;
  setValue<T>(key: string, value: T): Promise<void>;

  /** File bytes for uploaded documents and videos. */
  putBlob(key: string, file: Blob, meta: Omit<StoredBlobMeta, "key">): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  getBlobMeta(key: string): Promise<StoredBlobMeta | null>;
  removeBlob(key: string): Promise<void>;

  /** Wipe everything — powers the "Reset demo data" control. */
  clearAll(): Promise<void>;
}
