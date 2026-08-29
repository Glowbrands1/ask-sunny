import { LocalPrototypeStorageProvider } from "./local-provider";
import type { StorageProvider } from "./types";

export * from "./types";
export { LocalPrototypeStorageProvider } from "./local-provider";

/**
 * The single place the app resolves its storage backend.
 *
 * FUTURE — production migration:
 *   if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
 *     return new SupabaseStorageProvider(...)   // records in Postgres, files in Storage
 *   }
 *   if (sharePointConfigured) {
 *     return new SharePointStorageProvider(...) // documents synced via Microsoft Graph
 *   }
 *
 * Neither exists yet, and neither is faked. Swapping one in is a change to this
 * function only — no component in `features/` touches a storage client directly.
 */
let cached: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  cached ??= new LocalPrototypeStorageProvider();
  return cached;
}
