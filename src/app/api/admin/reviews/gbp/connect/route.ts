import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { GBP_CALLBACK_PATH, isProductionRuntime, missingCredentialNames, readOAuthSettings } from "@/lib/reviews/gbp/config";
import { SealError, readEncryptionKey } from "@/lib/reviews/gbp/crypto";
import { OAUTH_COOKIE, createAuthorization } from "@/lib/reviews/gbp/oauth";

/**
 * GET /api/admin/reviews/gbp/connect — start the Google sign-in.
 *
 * `manage_integrations` only, and only from the PRODUCTION deployment (a
 * connection is a write to the shared database). Redirects to Google's consent
 * screen for the single Business Profile scope, with PKCE and a `state`. The
 * attempt is kept ONLY in a sealed, HttpOnly cookie sent to the callback path
 * and nowhere else, and expires in 10 minutes. Nothing is stored until the
 * callback verifies it. Pattern from Ask Bubbles' working flow.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    if (!isProductionRuntime()) {
      return NextResponse.json(
        { status: "refused", reason: "Google can only be connected from the production deployment." },
        { status: 409, headers: NO_STORE },
      );
    }

    const settings = readOAuthSettings(process.env, new URL(request.url).origin);
    readEncryptionKey(); // throws SealError (naming the variable only) if unusable
    if (!settings) {
      return NextResponse.json(
        { status: "not_configured", missing: missingCredentialNames(), reason: "Google OAuth is not configured." },
        { status: 503, headers: NO_STORE },
      );
    }

    const start = createAuthorization(settings);
    const response = NextResponse.redirect(start.url, { status: 302, headers: NO_STORE });
    response.cookies.set(OAUTH_COOKIE, start.cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: GBP_CALLBACK_PATH,
      maxAge: start.maxAgeSeconds,
    });
    return response;
  } catch (error) {
    if (error instanceof SealError) {
      return NextResponse.json({ status: "not_configured", reason: error.message }, { status: 503, headers: NO_STORE });
    }
    return errorResponse(error, "admin/reviews/gbp/connect");
  }
}
