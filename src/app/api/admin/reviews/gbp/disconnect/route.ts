import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { isProductionRuntime } from "@/lib/reviews/gbp/config";
import { isSameOriginRequest } from "@/lib/reviews/gbp/csrf";
import { REFRESH_TOKEN_LABEL, open } from "@/lib/reviews/gbp/crypto";
import { revokeRefreshToken } from "@/lib/reviews/gbp/oauth";
import { createSupabaseStore } from "@/lib/reviews/gbp/store";

/**
 * POST /api/admin/reviews/gbp/disconnect — end the Google connection.
 *
 * Asks Google to revoke the grant (best effort; a failure never blocks this) and
 * marks the local connection revoked, so no further sync runs until someone
 * connects again. Stored reviews are kept. Returns whether Google confirmed the
 * revocation, never a token. Production deployment only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ status: "refused", reason: "Cross-site request refused." }, { status: 403, headers: NO_STORE });
    }
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");
    if (!isProductionRuntime()) {
      return NextResponse.json({ status: "refused", reason: "Production deployment only." }, { status: 409, headers: NO_STORE });
    }

    const store = createSupabaseStore();
    const connection = await store.getActiveConnection();
    if (!connection) {
      return NextResponse.json({ status: "ok", disconnected: false, reason: "No Google account is connected." }, { headers: NO_STORE });
    }
    let revokedAtGoogle = false;
    try {
      revokedAtGoogle = await revokeRefreshToken(open(connection.refreshTokenSealed, REFRESH_TOKEN_LABEL));
    } catch {
      /* The token could not even be opened (key problem): still end the local connection. */
    }
    await store.endConnection("revoked", null, context.identity.email || context.identity.subject);
    return NextResponse.json({ status: "ok", disconnected: true, revokedAtGoogle }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "admin/reviews/gbp/disconnect");
  }
}
