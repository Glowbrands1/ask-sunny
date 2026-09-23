import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { DirectoryError } from "@/lib/admin/user-directory";
import { generateResetLink } from "@/lib/admin/reset-link";
import { recoveryStartUrlFor } from "@/lib/admin/redirect-target";

/**
 * POST /api/admin/users/<id>/reset-link
 *
 * Generates a scanner-safe password reset link for one existing, active,
 * non-administrator account and returns it to the administrator who asked, to
 * send privately. NO EMAIL IS SENT. See `lib/admin/reset-link.ts`.
 *
 * `manage_users` is required, checked on the server from the caller's own
 * session. The target is the `<id>` in the path, looked up in the directory:
 * the body is not read at all, so no email address can be supplied.
 *
 * THE RESPONSE IS A CREDENTIAL. It is marked `no-store` so no browser or
 * intermediary cache keeps it, and nothing in this route logs it. A failure
 * never carries it: every error below is thrown before the link exists or
 * carries only our own sentence.
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
    const result = await generateResetLink(
      id,
      (tokenHash) => recoveryStartUrlFor(request, tokenHash),
      {
        id: context.identity.subject,
        email: context.identity.email,
        role: context.identity.role,
      },
    );

    return NextResponse.json(
      { url: result.url, email: result.email },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DirectoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return errorResponse(error, "POST /api/admin/users/[id]/reset-link");
  }
}
