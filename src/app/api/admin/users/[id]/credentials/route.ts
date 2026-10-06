import { NextResponse } from "next/server";

import { resetCredentials } from "@/lib/admin/credential-reset";
import { implicitRedirectTarget } from "@/lib/admin/redirect-target";
import { DirectoryError } from "@/lib/admin/user-directory";
import { assertLiveMode, assertNoConfigurationProblems, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";

/**
 * POST /api/admin/users/<id>/credentials   { "confirm": true }
 *
 * Clears the account's password, ends every session, then emails the person a
 * link to choose their own (`credential-reset.ts`). For accounts whose
 * password was set by somebody else.
 *
 * `manage_users`, live mode, rate-limited, and an explicit `confirm: true`:
 * this signs the person out everywhere and they cannot sign in again until
 * they follow the email.
 *
 * THE RESPONSE CONTAINS NO LINK, NO TOKEN AND NO PASSWORD — only which email
 * was sent and how many sessions ended.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_users");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<Record<string, unknown>>(request);
    if (body?.confirm !== true) {
      return NextResponse.json(
        { error: "Confirm that this account should be signed out everywhere and reset.", code: "confirmation_required" },
        { status: 400 },
      );
    }

    const { id } = await params;
    const result = await resetCredentials(id, implicitRedirectTarget(request), {
      id: context.identity.subject,
      email: context.identity.email,
      role: context.identity.role,
    });
    return NextResponse.json({ sent: result.sent, email: result.email, sessionsEnded: result.sessionsEnded });
  } catch (error) {
    if (error instanceof DirectoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return errorResponse(error, "POST /api/admin/users/[id]/credentials");
  }
}
