import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { DirectoryError, patchUser } from "@/lib/admin/user-directory";

/**
 * PATCH /api/admin/users/<id> — change a profile. Never a credential.
 *
 * The body may carry a display name, a role, a status and a scope. It may not
 * carry a password, and there is no branch here that would read one: passwords
 * belong to Supabase Auth, and an endpoint that accepted one would be Ask Sunny
 * handling a credential it has no business seeing.
 *
 * The two refusals that matter — no changing your own role or status, and the
 * last administrator keeps their access — are enforced in `patchUser` AND by
 * database triggers. The duplication is the design: this layer produces a
 * sentence an administrator can read, and the trigger holds for any caller that
 * never came through here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_users");

    const { id } = await params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Send the fields to change.", code: "invalid_input" },
        { status: 400 },
      );
    }
    const input = body as Record<string, unknown>;

    const user = await patchUser(
      id,
      {
        /*
         * Read FIELD BY FIELD rather than spread. A spread would forward
         * anything the caller sent — including `email`, which must not be
         * editable here (it is the credential's identity and changing it in the
         * profile alone would silently break sign-in), and `status: "invited"`,
         * which `patchUser` refuses for its own reasons.
         */
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
      },
      {
        id: context.identity.subject,
        email: context.identity.email,
        role: context.identity.role,
      },
    );

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof DirectoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return errorResponse(error, "PATCH /api/admin/users/[id]");
  }
}
