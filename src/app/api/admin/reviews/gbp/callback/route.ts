import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { GBP_CALLBACK_PATH, isProductionRuntime, readOAuthSettings } from "@/lib/reviews/gbp/config";
import { REFRESH_TOKEN_LABEL, SealError, seal } from "@/lib/reviews/gbp/crypto";
import { OAUTH_COOKIE, OAuthError, exchangeAuthorizationCode, verifyAttempt } from "@/lib/reviews/gbp/oauth";
import { createSupabaseStore } from "@/lib/reviews/gbp/store";

/**
 * GET /api/admin/reviews/gbp/callback — Google sends the browser back here.
 *
 * `manage_integrations` is required AGAIN: the administrator who starts a
 * connection completes it. Then: (1) the sealed attempt cookie is opened and its
 * `state` compared in constant time; (2) the code is exchanged with the PKCE
 * verifier; (3) only a grant that INCLUDES the business scope and a refresh token
 * is accepted; (4) the refresh token is SEALED and saved as the single active
 * connection. The browser is redirected with a result CODE from a closed list —
 * nothing from Google's query string is reflected — and the cookie is cleared
 * whatever happened.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS = [
  "connected",
  "not_configured",
  "denied",
  "state_mismatch",
  "attempt_expired",
  "attempt_invalid",
  "invalid_grant",
  "invalid_client",
  "no_refresh_token",
  "missing_scope",
  "bad_response",
  "network_error",
  "store_error",
] as const;
type Result = (typeof RESULTS)[number];

function done(request: Request, result: Result): NextResponse {
  const target = new URL("/admin/integrations/google-reviews", request.url);
  target.searchParams.set("gbp", result);
  const response = NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: GBP_CALLBACK_PATH,
    maxAge: 0,
  });
  return response;
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    const url = new URL(request.url);
    if (!isProductionRuntime()) return done(request, "not_configured");

    const settings = readOAuthSettings(process.env, url.origin);
    if (!settings) return done(request, "not_configured");
    if (url.searchParams.get("error")) return done(request, "denied"); // no detail is reflected
    const code = url.searchParams.get("code");
    if (!code) return done(request, "attempt_invalid");

    const { verifier } = verifyAttempt(readCookie(request.headers.get("cookie"), OAUTH_COOKIE), url.searchParams.get("state"));
    const grant = await exchangeAuthorizationCode(settings, code, verifier);
    try {
      await createSupabaseStore().saveConnection(
        seal(grant.refreshToken, REFRESH_TOKEN_LABEL),
        grant.scopes,
        context.identity.email || context.identity.subject,
      );
    } catch {
      return done(request, "store_error");
    }
    return done(request, "connected");
  } catch (error) {
    if (error instanceof OAuthError) {
      return done(request, (RESULTS as readonly string[]).includes(error.code) ? (error.code as Result) : "bad_response");
    }
    if (error instanceof SealError) return done(request, "not_configured");
    return errorResponse(error, "admin/reviews/gbp/callback");
  }
}
