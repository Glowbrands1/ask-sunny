import { isDemoMode } from "@/lib/config/runtime";
import { LocalPrototypeStorageProvider } from "./local-provider";
import type { StorageProvider } from "./types";

export * from "./types";
export { LocalPrototypeStorageProvider } from "./local-provider";

/**
 * STORAGE PROVIDER SELECTION — centralized.
 *
 * This resolver is for BROWSER-side state. It returns the IndexedDB provider in
 * both modes today, and that is a deliberate, honest choice rather than an
 * oversight: `SupabaseStorageProvider` holds a service-role client and is
 * marked `server-only`, so it cannot be constructed here. Until authentication
 * ships there is no browser-held credential that could safely talk to Postgres
 * under RLS.
 *
 * In live mode the knowledge library is therefore served by /api/knowledge/*
 * (see RemoteKnowledgeProvider), and IndexedDB holds only local UI state —
 * conversation history, the permission matrix, view preferences.
 *
 * Server-side code that needs real persistence constructs
 * `SupabaseStorageProvider` directly inside a route handler.
 */
let cached: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  cached ??= new LocalPrototypeStorageProvider();
  return cached;
}

/** Honest label for the Integrations screen. */
export function storageProviderStatus() {
  const demo = isDemoMode();
  return {
    name: demo
      ? "Local prototype storage (IndexedDB)"
      : "Supabase private Storage (documents) + IndexedDB (local UI state)",
    live: !demo,
    detail: demo
      ? "Uploads and edits are stored in this browser only."
      : "Uploaded documents are stored server-side in a private bucket. This browser holds UI state only.",
  };
}
