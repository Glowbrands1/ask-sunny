import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { DirectoryError, sendRecovery } from "@/lib/admin/user-directory";
import { implicitRedirectTarget } from "@/lib/admin/redirect-target";

/**
 * POST /api/admin/users/<id>/recovery
 *
 * Sends the person a link that lets THEM set a password: a fresh invitation if
 * they have never signed in, a reset otherwise. Which of the two is decided
 * from the account's status inside `sendRecovery`, not from a parameter —
 * telling somebody who never had a password to "reset" it is confusing, and
 * deciding from the row means the caller cannot get it wrong.
 *
 * ============================================================================
 * THE RESPONSE CONTAINS NO LINK, NO TOKEN AND NO PASSWORD.
 * ============================================================================
 *
 * This is the endpoint most likely to be asked to return one — "just show me
 * the link so I can send it to them" — and it must not. The link is a
 * single-use credential: in a response it lands in a browser's network log, in
 * whatever the administrator pastes it into, and in any error reporting the app
 * has. Supabase mails it directly to the person, and all this route learns is
 * which kind of email was sent.
 *
 * Ask Sunny also never generates a password to hand over. There is no such
 * value anywhere in this path.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_users");

    const { id } = await params;
    const result = await sendRecovery(id, implicitRedirectTarget(request), {
      id: context.identity.subject,
      email: context.identity.email,
      role: context.identity.role,
    });

    return NextResponse.json({
      // Which email went out, and to whom. Nothing else.
      sent: result.kind,
      email: result.email,
    });
  } catch (error) {
    if (error instanceof DirectoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return errorResponse(error, "POST /api/admin/users/[id]/recovery");
  }
}
