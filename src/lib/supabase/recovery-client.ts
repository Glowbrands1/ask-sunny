import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  SUPABASE_PUBLISHABLE_KEY_ENV,
  SUPABASE_URL_ENV,
  requireEnv,
} from "@/lib/config/server-env";

/**
 * ============================================================================
 * THE PASSWORD-RECOVERY REQUEST CLIENT. Publishable key, implicit flow, no
 * session.
 * ============================================================================
 *
 * Used by exactly one thing: the public `/api/auth/forgot-password` endpoint,
 * which asks Supabase to email a reset link.
 *
 * WHY IMPLICIT, AND WHY IT IS SPELLED OUT. `resetPasswordForEmail` sends a
 * PKCE code challenge only when the client's `flowType` is "pkce". A PKCE link
 * comes back as `?code=`, which can only be exchanged in the SAME browser that
 * asked for it, because that browser holds the code verifier. Somebody who asks
 * on one device and opens the email on another — or in a mail app's own
 * browser — ends up with a link that cannot be completed. That is the failure
 * production recorded: Supabase accepted the link, and no code exchange ever
 * followed.
 *
 * With no code challenge, Supabase returns the recovery session as a
 * `#access_token=…` fragment on `/reset-password`, which that page already
 * reads and hands to `setSession`, whichever browser opens it. supabase-js
 * defaults to implicit already; it is set explicitly here so that a change of
 * library default cannot silently turn this back into PKCE. (`@supabase/ssr`
 * clients force PKCE, which is why neither the browser client nor the session
 * client is used for this.)
 *
 * WHY THE PUBLISHABLE KEY. This endpoint is unauthenticated. The publishable
 * key is already public — any browser could call Supabase's `/recover` with it
 * — so this client can do nothing a visitor could not already do. It never
 * reads the secret key, which bypasses row level security and has no business
 * behind a public form.
 *
 * NO SESSION. Nothing is persisted, refreshed or read from a URL: this client
 * only makes one request and never holds anybody's credential.
 */
export function getSupabaseRecoveryClient(): SupabaseClient {
  return createClient(
    requireEnv(SUPABASE_URL_ENV),
    requireEnv(SUPABASE_PUBLISHABLE_KEY_ENV),
    {
      auth: {
        flowType: "implicit",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
