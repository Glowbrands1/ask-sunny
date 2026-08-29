import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireEnv, supabaseSecretKey } from "@/lib/config/server-env";

/**
 * SERVER-SIDE SUPABASE CLIENTS.
 *
 * `import "server-only"` makes importing this file from a client component a
 * build error. That is the structural guarantee that the privileged Supabase
 * key cannot end up in a browser bundle — not a convention, a compile failure.
 *
 * The secret-key client bypasses row level security. It is used exclusively
 * inside route handlers, for ingestion writes and for minting short-lived
 * signed download URLs. It is never handed to a component, never serialized
 * into a response, and its key never appears in a log line.
 *
 * The key is resolved by `supabaseSecretKey()`, which prefers the current
 * SUPABASE_SECRET_KEY name and falls back to the legacy
 * SUPABASE_SERVICE_ROLE_KEY. The two are drop-in equivalents for `createClient`.
 */

export const KNOWLEDGE_BUCKET = "knowledge-documents";

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = supabaseSecretKey();

  adminClient = createClient(url, secretKey, {
    auth: {
      // A privileged client is not a user session: no token refresh, no
      // persistence, nothing that could leak into a shared server context.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return adminClient;
}

/** Test/route seam so a fake client can be injected without a network. */
export function __setSupabaseAdmin(client: SupabaseClient | null): void {
  adminClient = client;
}
