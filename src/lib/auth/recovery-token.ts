import "server-only";

import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { getSupabaseSessionClientFor } from "@/lib/supabase/auth-clients";

/**
 * ============================================================================
 * THE SCANNER-SAFE RECOVERY TOKEN. Held, not spent, until a person asks.
 * ============================================================================
 *
 * Enterprise mail security (Microsoft Defender Safe Links and similar) fetches
 * every link in an incoming message before the recipient sees it. Supabase's
 * stock `{{ .ConfirmationURL }}` points at `/auth/v1/verify`, which verifies
 * on GET — so the scanner spends the single-use recovery token, and the person
 * who clicks a minute later is told the brand-new link has expired.
 *
 * The fix is to never let a GET spend it. The Reset Password email links to
 * `/auth/recovery-start?token_hash=…&type=recovery` instead. That GET only
 * moves the token out of the URL into a short-lived HttpOnly cookie and shows
 * a Continue button. `verifyOtp` runs only on the POST that button sends —
 * which a scanner fetching links does not produce.
 *
 * ============================================================================
 * THE COOKIE
 * ============================================================================
 *
 *   HttpOnly     No script on any page can read it.
 *   SameSite=Lax Sent on the top-level navigation from the email, and on the
 *                same-site Continue POST. NOT sent on a cross-site POST, so
 *                another site cannot submit the form on somebody's behalf.
 *                (Strict would break the first step: the redirect after the
 *                email click is still part of a cross-site navigation, and a
 *                Strict cookie would be withheld from it.)
 *   Secure       Whenever the request itself is HTTPS — everywhere but a
 *                local `http://localhost` dev server.
 *   Path=/auth   Covers `/auth/recovery-start` and `/auth/recovery-continue`
 *                and nothing in the application proper.
 *   Max-Age      Fifteen minutes. It only has to span the gap between opening
 *                the link and pressing Continue; Supabase's own expiry still
 *                applies to the token inside it.
 *
 * The token is never logged, rendered, or returned. The only thing anything
 * outside this file learns is whether one is being held.
 */

export const RECOVERY_TOKEN_COOKIE = "sunny_recovery_token";

/** Seconds. See the table above. */
export const RECOVERY_TOKEN_MAX_AGE = 15 * 60;

const COOKIE_PATH = "/auth";

/**
 * Supabase's token hash is hex, optionally prefixed `pkce_` when the reset was
 * requested by a PKCE client. The bound is generous; the charset is not, so
 * nothing but a token-shaped value is ever written into a cookie.
 */
const TOKEN_HASH_SHAPE = /^[A-Za-z0-9_-]{16,512}$/;

/**
 * The token hash from a `/auth/recovery-start` URL, or null.
 *
 * `type` must be exactly `recovery`. This route verifies recovery tokens and
 * nothing else — the type sent to Supabase is fixed in code, never read from
 * the URL — so a link labelled as anything else is not held.
 */
export function readRecoveryStart(url: URL): string | null {
  if (url.searchParams.get("type") !== "recovery") return null;
  const tokenHash = url.searchParams.get("token_hash");
  if (!tokenHash || !TOKEN_HASH_SHAPE.test(tokenHash)) return null;
  return tokenHash;
}

/** The token hash held in the cookie, or null if none or not token-shaped. */
export function heldRecoveryToken(
  value: string | undefined | null,
): string | null {
  if (!value || !TOKEN_HASH_SHAPE.test(value)) return null;
  return value;
}

function cookieBase(requestUrl: URL) {
  return {
    name: RECOVERY_TOKEN_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: requestUrl.protocol === "https:",
    path: COOKIE_PATH,
  };
}

/** Parks the token on the response. The URL it came from is then discarded. */
export function holdRecoveryToken(
  response: NextResponse,
  tokenHash: string,
  requestUrl: URL,
): void {
  response.cookies.set({
    ...cookieBase(requestUrl),
    value: tokenHash,
    maxAge: RECOVERY_TOKEN_MAX_AGE,
  });
}

/** Deletes the held token. Done on every definitive outcome of a Continue. */
export function releaseRecoveryToken(
  response: NextResponse,
  requestUrl: URL,
): void {
  response.cookies.set({ ...cookieBase(requestUrl), value: "", maxAge: 0 });
}

/**
 * What a verification attempt came to.
 *
 *   verified     A recovery session now exists; its cookies are on `response`.
 *   refused      Supabase answered and said no — spent, expired, or unknown.
 *                The ONLY outcome that should be reported as an expired link.
 *   unavailable  Supabase could not be asked (network, configuration). The
 *                token may well still be good, so it is not called expired.
 */
export type RecoveryVerification = "verified" | "refused" | "unavailable";

/**
 * Spends the recovery token, writing the resulting session cookies onto the
 * RESPONSE about to be returned — same reason as `exchangeCodeOntoResponse`:
 * cookies written to the `cookies()` store do not follow a redirect object.
 *
 * Only the Continue POST in `/auth/recovery-start` calls this.
 *
 * `type: "recovery"` is compiled in. The provider's error text is discarded:
 * it says nothing a person can act on beyond "the link did not work".
 */
export async function verifyRecoveryTokenOntoResponse(
  tokenHash: string,
  response: NextResponse,
): Promise<RecoveryVerification> {
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
      type: "recovery",
    });

    /*
     * A retryable fetch error means Supabase never answered — the token was
     * not looked at, so telling somebody their link expired would be a lie.
     */
    if (error && isAuthRetryableFetchError(error)) return "unavailable";
    if (error || !data?.session) return "refused";
    return "verified";
  } catch {
    return "unavailable";
  }
}
