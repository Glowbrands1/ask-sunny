import "server-only";

import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { getSupabaseSessionClientFor } from "@/lib/supabase/auth-clients";

/**
 * ============================================================================
 * THE SCANNER-SAFE INVITATION TOKEN (INVITE_LINK_HOLD_ENABLED, default off)
 * ============================================================================
 *
 * `recovery-token.ts`, for the Invite user email. A mail scanner that fetches
 * Supabase's stock invite link spends the single-use token on GET: the email
 * is confirmed, the person's own click finds the link spent, and the account
 * stays `invited` because the page that accepts it is never reached.
 *
 * The invite email links to `/auth/invite-start?token_hash=…&type=invite`
 * instead. That GET only moves the token into a short-lived HttpOnly cookie
 * and shows a Continue button; `verifyOtp` runs only on the POST that button
 * sends. Same cookie rules as the recovery token (HttpOnly, SameSite=Lax,
 * Secure over HTTPS, Path=/auth, fifteen minutes), under its own name so an
 * invitation and a reset never overwrite each other.
 *
 * The token is never logged, rendered, or returned.
 */

export const INVITE_TOKEN_COOKIE = "sunny_invite_token";

/** Seconds. Only has to span opening the link and pressing Continue. */
export const INVITE_TOKEN_MAX_AGE = 15 * 60;

const COOKIE_PATH = "/auth";

/** Supabase's token hash: hex, optionally `pkce_`-prefixed. Nothing else is held. */
const TOKEN_HASH_SHAPE = /^[A-Za-z0-9_-]{16,512}$/;

/**
 * The token hash from an `/auth/invite-start` URL, or null. `type` must be
 * exactly `invite`; the type sent to Supabase is fixed in code, never read
 * from the URL.
 */
export function readInviteStart(url: URL): string | null {
  if (url.searchParams.get("type") !== "invite") return null;
  const tokenHash = url.searchParams.get("token_hash");
  if (!tokenHash || !TOKEN_HASH_SHAPE.test(tokenHash)) return null;
  return tokenHash;
}

/** The token hash held in the cookie, or null if none or not token-shaped. */
export function heldInviteToken(value: string | undefined | null): string | null {
  if (!value || !TOKEN_HASH_SHAPE.test(value)) return null;
  return value;
}

function cookieBase(requestUrl: URL) {
  return {
    name: INVITE_TOKEN_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: requestUrl.protocol === "https:",
    path: COOKIE_PATH,
  };
}

/** Parks the token on the response. The URL it came from is then discarded. */
export function holdInviteToken(response: NextResponse, tokenHash: string, requestUrl: URL): void {
  response.cookies.set({ ...cookieBase(requestUrl), value: tokenHash, maxAge: INVITE_TOKEN_MAX_AGE });
}

/** Deletes the held token. Done on every definitive outcome of a Continue. */
export function releaseInviteToken(response: NextResponse, requestUrl: URL): void {
  response.cookies.set({ ...cookieBase(requestUrl), value: "", maxAge: 0 });
}

/** verified: a session exists, its cookies are on the response. refused: Supabase said no. unavailable: it could not be asked. */
export type InviteVerification = "verified" | "refused" | "unavailable";

/**
 * Spends the invitation token, writing the session cookies onto the RESPONSE
 * about to be returned. Only the Continue POST in `/auth/invite-start` calls
 * this. `type: "invite"` is compiled in; the provider's error text is
 * discarded.
 */
export async function verifyInviteTokenOntoResponse(
  tokenHash: string,
  response: NextResponse,
): Promise<InviteVerification> {
  try {
    const store = await cookies();

    const client = getSupabaseSessionClientFor({
      getAll: () => store.getAll(),
      setAll: (entries) => {
        for (const entry of entries) {
          response.cookies.set({
            name: entry.name,
            value: entry.value,
            ...(entry.options as Record<string, unknown>),
          });
        }
      },
    });

    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: "invite",
    });

    if (error && isAuthRetryableFetchError(error)) return "unavailable";
    if (error || !data?.session) return "refused";
    return "verified";
  } catch {
    return "unavailable";
  }
}
