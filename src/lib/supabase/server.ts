import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "@/lib/config/server-env";

/**
 * SERVER-SIDE SUPABASE CLIENTS.
 *
 * `import "server-only"` makes importing this file from a client component a
 * build error. That is the structural guarantee that SUPABASE_SERVICE_ROLE_KEY
 * cannot end up in a browser bundle — not a convention, a compile failure.
 *
 * The service-role client bypasses row level security. It is used exclusively
 * inside route handlers, for ingestion writes and for minting short-lived
 * signed download URLs. It is never handed to a component, never serialized
 * into a response, and its key never appears in a log line.
 */

export const KNOWLEDGE_BUCKET = "knowledge-documents";

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  adminClient = createClient(url, serviceRoleKey, {
    auth: {
      // A service-role client is not a user session: no token refresh, no
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
