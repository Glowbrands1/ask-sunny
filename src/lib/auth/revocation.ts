import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * ============================================================================
 * REVOKING ACCESS AT THE AUTHENTICATION LAYER
 * ============================================================================
 *
 * `app_users.status = 'disabled'` stops the APPLICATION: every page and API
 * route re-reads the profile and refuses a disabled one on its next request.
 * It does not stop SUPABASE AUTH, which knows nothing about `app_users`. So a
 * revocation is two layers, and this module is the second:
 *
 *   1. BAN the auth user (`ban_duration`). Supabase then refuses a password
 *      sign-in, a token refresh and a recovery or invitation link for them.
 *   2. REVOKE THEIR SESSIONS (`auth_revoke_user_sessions`, a server-only SQL
 *      function): every refresh token and session row is deleted, so nothing
 *      already issued can be refreshed.
 *
 * An access token minted before the ban stays cryptographically valid until it
 * expires (Supabase's JWT expiry, one hour by default). Nothing here can
 * recall it; what makes it useless is everywhere ELSE: the application refuses
 * a disabled profile on every request, and the only tables a browser token can
 * read directly (the knowledge library) now require an ACTIVE profile in RLS.
 *
 * WHAT THIS MODULE NEVER DOES
 *   - delete an auth user (that would CASCADE to the profile and orphan
 *     history),
 *   - set, read or send a password, an email address or metadata — the ONLY
 *     attribute it ever passes to the Auth Admin API is `ban_duration`, which
 *     `revocation.test.ts` asserts against the source,
 *   - run anywhere but the server (`server-only`, secret key).
 *
 * Both steps are idempotent: banning a banned user or revoking sessions that
 * do not exist succeeds. Both are ATTEMPTED even if the other fails, and the
 * result says exactly which one did not complete, so a caller can retry.
 */

/** A ban long enough to be permanent in practice (Supabase takes a Go duration). */
export const PERMANENT_BAN_DURATION = "876000h";
/** Supabase's value for "not banned". */
const NO_BAN = "none";

export type AuthRevocationStep = "ban" | "sessions";

export interface AuthRevocationResult {
  /** True only when BOTH layers completed. */
  ok: boolean;
  banned: boolean;
  /** Sessions removed, or null when the session step failed. */
  sessionsRevoked: number | null;
  failed: AuthRevocationStep[];
}

export interface AuthRestoreResult {
  ok: boolean;
}

/** The subset of the admin client this module uses — so tests can pass a double. */
export interface RevocationClient {
  auth: {
    admin: {
      updateUserById(
        id: string,
        attributes: { ban_duration: string },
      ): Promise<{ error: { message?: string; code?: string } | null }>;
    };
  };
  rpc(fn: "auth_revoke_user_sessions", args: { p_user_id: string }): PromiseLike<{ data: unknown; error: unknown }>;
}

function client(): RevocationClient {
  return getSupabaseAdmin() as unknown as RevocationClient;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bans the auth user and revokes every session. Never throws; a failure is reported, step by step. */
export async function revokeAuthAccess(userId: string, admin?: RevocationClient): Promise<AuthRevocationResult> {
  if (!UUID.test(userId)) return { ok: false, banned: false, sessionsRevoked: null, failed: ["ban", "sessions"] };
  admin ??= client();
  const failed: AuthRevocationStep[] = [];

  let banned = false;
  try {
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: PERMANENT_BAN_DURATION });
    banned = !error;
  } catch {
    banned = false;
  }
  if (!banned) failed.push("ban");

  let sessionsRevoked: number | null = null;
  try {
    const { data, error } = await admin.rpc("auth_revoke_user_sessions", { p_user_id: userId });
    if (!error) sessionsRevoked = typeof data === "number" ? data : 0;
  } catch {
    sessionsRevoked = null;
  }
  if (sessionsRevoked === null) failed.push("sessions");

  return { ok: failed.length === 0, banned, sessionsRevoked, failed };
}

/**
 * Lifts the ban. Sessions are not restored — there is nothing to restore; the
 * person signs in again. Called only after the profile is active again, by an
 * administrator's explicit re-enable or an approved rehire.
 */
export async function restoreAuthAccess(userId: string, admin?: RevocationClient): Promise<AuthRestoreResult> {
  if (!UUID.test(userId)) return { ok: false };
  admin ??= client();
  try {
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: NO_BAN });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
