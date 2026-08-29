import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { assertPathWithinScope } from "@/lib/ingestion/paths";
import { KNOWLEDGE_BUCKET, getSupabaseAdmin } from "@/lib/supabase/server";
import type { StorageCollection, StorageProvider, StoredBlobMeta } from "./types";

/**
 * SupabaseStorageProvider — the production implementation of StorageProvider.
 *
 * Records go to Postgres tables; file bytes go to the PRIVATE
 * `knowledge-documents` bucket. Server-side only: it uses the privileged
 * secret-key client, which bypasses RLS, so it must never be constructed in
 * the browser.
 * `import "server-only"` makes that a build error rather than a code review
 * question.
 *
 * Blob keys are validated on every read and delete. A key that does not sit
 * inside its own scope prefix is rejected before it reaches Supabase, so a
 * crafted path cannot address another corpus's objects.
 */

/** Collections that have a real table today. The rest are not yet migrated. */
const TABLE_FOR_COLLECTION: Partial<Record<StorageCollection, string>> = {
  knowledge_documents: "knowledge_documents",
};

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "Supabase (Postgres + private Storage)";

  private readonly scopeId: string;
  private readonly client: SupabaseClient;

  constructor(scopeId: string, client: SupabaseClient = getSupabaseAdmin()) {
    this.scopeId = scopeId;
    this.client = client;
  }

  isAvailable(): boolean {
    return Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && supabaseSecretKeyConfigured(),
    );
  }

  private tableFor(collection: StorageCollection): string {
    const table = TABLE_FOR_COLLECTION[collection];
    if (!table) {
      throw new Error(
        `Collection "${collection}" has no Supabase table yet. It is still served by LocalPrototypeStorageProvider.`,
      );
    }
    return table;
  }

  async list<T>(collection: StorageCollection): Promise<T[]> {
    const { data, error } = await this.client
      .from(this.tableFor(collection))
      .select("*")
      .eq("knowledge_scope_id", this.scopeId);
    if (error) throw new Error(`Could not read ${collection}: ${error.message}`);
    return (data ?? []) as T[];
  }

  async replace<T extends { id: string }>(
    collection: StorageCollection,
    records: T[],
  ): Promise<void> {
    const table = this.tableFor(collection);
    const keep = records.map((record) => record.id);

    // Delete-then-upsert inside the scope only. A scope is never allowed to
    // clear another scope's rows.
    let deletion = this.client.from(table).delete().eq("knowledge_scope_id", this.scopeId);
    if (keep.length > 0) deletion = deletion.not("id", "in", `(${keep.join(",")})`);

    const { error: deleteError } = await deletion;
    if (deleteError) {
      throw new Error(`Could not replace ${collection}: ${deleteError.message}`);
    }

    if (records.length === 0) return;
    const { error } = await this.client.from(table).upsert(records);
    if (error) throw new Error(`Could not replace ${collection}: ${error.message}`);
  }

  async put<T extends { id: string }>(
    collection: StorageCollection,
    record: T,
  ): Promise<void> {
    const { error } = await this.client.from(this.tableFor(collection)).upsert(record);
    if (error) throw new Error(`Could not save to ${collection}: ${error.message}`);
  }

  async remove(collection: StorageCollection, id: string): Promise<void> {
    const { error } = await this.client
      .from(this.tableFor(collection))
      .delete()
      .eq("id", id)
      .eq("knowledge_scope_id", this.scopeId);
    if (error) throw new Error(`Could not delete from ${collection}: ${error.message}`);
  }

  async getValue<T>(key: string): Promise<T | null> {
    void key;
    // App-state key/values (UI preferences, the permission matrix) have no
    // Supabase table yet and are deliberately not invented here.
    throw new Error(
      "Key/value state is not stored in Supabase yet. Use LocalPrototypeStorageProvider for app state.",
    );
  }

  async setValue<T>(key: string, value: T): Promise<void> {
    void key;
    void value;
    throw new Error(
      "Key/value state is not stored in Supabase yet. Use LocalPrototypeStorageProvider for app state.",
    );
  }

  /* --------------------------------------------------------------- blobs -- */

  async putBlob(
    key: string,
    file: Blob,
    meta: Omit<StoredBlobMeta, "key">,
  ): Promise<void> {
    const path = assertPathWithinScope(key, this.scopeId);
    const { error } = await this.client.storage
      .from(KNOWLEDGE_BUCKET)
      .upload(path, file, {
        contentType: meta.mimeType,
        // Never silently overwrite: paths carry the version, so a collision
        // means a bug, not a re-upload.
        upsert: false,
      });
    if (error) throw new Error(`Could not store the file: ${error.message}`);
  }

  async getBlob(key: string): Promise<Blob | null> {
    const path = assertPathWithinScope(key, this.scopeId);
    const { data, error } = await this.client.storage.from(KNOWLEDGE_BUCKET).download(path);
    if (error) return null;
    return data ?? null;
  }

  async getBlobMeta(key: string): Promise<StoredBlobMeta | null> {
    const path = assertPathWithinScope(key, this.scopeId);
    const lastSlash = path.lastIndexOf("/");
    const folder = path.slice(0, lastSlash);
    const fileName = path.slice(lastSlash + 1);

    const { data, error } = await this.client.storage
      .from(KNOWLEDGE_BUCKET)
      .list(folder, { search: fileName, limit: 1 });

    const entry = data?.[0];
    if (error || !entry) return null;

    return {
      key: path,
      fileName: entry.name,
      mimeType:
        (entry.metadata?.mimetype as string | undefined) ?? "application/octet-stream",
      sizeBytes: Number(entry.metadata?.size ?? 0),
      createdAt: entry.created_at ?? new Date().toISOString(),
    };
  }

  async removeBlob(key: string): Promise<void> {
    const path = assertPathWithinScope(key, this.scopeId);
    const { error } = await this.client.storage.from(KNOWLEDGE_BUCKET).remove([path]);
    if (error) throw new Error(`Could not delete the file: ${error.message}`);
  }

  /**
   * Short-lived signed URL for a private object. This is the ONLY way a
   * document's bytes reach a browser — the bucket stays private and object
   * paths are never handed out.
   */
  async signedUrl(key: string, expiresInSeconds = 60): Promise<string> {
    const path = assertPathWithinScope(key, this.scopeId);
    const { data, error } = await this.client.storage
      .from(KNOWLEDGE_BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new Error(`Could not create a download link: ${error?.message ?? "unknown error"}`);
    }
    return data.signedUrl;
  }

  async clearAll(): Promise<void> {
    // Deliberately not implemented. "Reset demo data" wipes a browser's
    // IndexedDB; it must never be able to truncate the company knowledge base.
    throw new Error(
      "clearAll() is not available on the Supabase provider. Company knowledge is not resettable from the app.",
    );
  }
}
