import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { readL10Url } from "@/lib/config/l10-link";

/**
 * GET /api/resources/l10 — open the L10 meeting app.
 *
 * ============================================================================
 * THE BOUNDARY, RATHER THAN A HIDDEN TILE
 * ============================================================================
 *
 * "The L10 meeting link needs to be restricted to admin accounts only for now."
 * A tile rendered behind `can("view_l10_meetings")` satisfies the sentence and
 * not the requirement: the address would still be in the bundle every manager
 * downloads, and the tile's own `href` would still work when pasted.
 *
 * So the destination is never sent to a browser. This route reads it
 * server-side, applies the permission to a VERIFIED identity — the same
 * `authorizeRequest` every other protected route calls, resolving the role from
 * `app_users` and never from anything the request asserts — and only then
 * answers with a redirect.
 *
 * A NON-ADMINISTRATOR WHO TYPES THIS PATH GETS 403, and learns nothing else:
 * the refusal is identical whether or not a destination is configured, because
 * distinguishing them would tell an unauthorized caller that there is something
 * there to find.
 *
 * `307`, NOT `302`. A 307 preserves the method and, unlike a 301/308, is not
 * cached indefinitely — this address is configuration and is expected to change
 * when the client confirms the production host.
 *
 * NO-STORE, because the answer depends on who asked. A cached redirect on a
 * shared salon device is the one way this route could hand the address to
 * somebody it just refused.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "view_l10_meetings");

    const url = readL10Url();
    if (!url) {
      /*
       * AUTHORIZED, AND THERE IS NOTHING TO OPEN. Only an administrator ever
       * reaches this sentence, and it names the variable so the gap is
       * actionable rather than mysterious — the same posture the training
       * destinations take when they are unconfigured.
       */
      return NextResponse.json(
        {
          error:
            "The L10 meeting link has not been configured for this deployment. An administrator can set L10_MEETINGS_URL.",
        },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.redirect(url, {
      status: 307,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "GET /api/resources/l10");
  }
}
