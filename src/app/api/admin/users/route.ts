import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import {
  DirectoryError,
  inviteUser,
  listUsers,
  type DirectoryActor,
} from "@/lib/admin/user-directory";
import { implicitRedirectTarget } from "@/lib/admin/redirect-target";

/**
 * ============================================================================
 * GET  /api/admin/users   — the directory
 * POST /api/admin/users   — invite somebody
 * ============================================================================
 *
 * `authorizeRequest(request, "manage_users")` runs FIRST in both, before the
 * privileged client is touched. That ordering is the whole security model of
 * this endpoint: the directory functions hold a client that bypasses row level
 * security, so nothing may reach them that has not already been authorized
 * against a verified identity and the server's own permission matrix.
 *
 * The ACTOR is taken from the authorization result, never from the request
 * body. A body-supplied actor would let the caller attribute a role change to
 * somebody else — and would defeat the self-change refusal, which works by
 * comparing the target to the actor.
 *
 * NO PASSWORD AND NO TOKEN IS EVER IN A RESPONSE FROM HERE. Inviting sends a
 * Supabase Auth link to the person's inbox; this route learns only that it was
 * sent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The authorized caller, in the shape the directory expects. */
function actorFrom(context: Awaited<ReturnType<typeof authorizeRequest>>): DirectoryActor {
  return {
    id: context.identity.subject,
    email: context.identity.email,
    role: context.identity.role,
  };
}

export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_users");

    return NextResponse.json({ users: await listUsers() });
  } catch (error) {
    return respond(error, "GET /api/admin/users");
  }
}

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_users");

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Send the new person's email, name, role and scope.", code: "invalid_input" },
        { status: 400 },
      );
    }
    const input = body as Record<string, unknown>;

    const user = await inviteUser(
      {
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        scope: input.scope,
        // Derived from the request, never accepted from the body — a
        // body-supplied redirect would make this an open redirect delivered by
        // email, which is worse than one delivered by link.
        redirectTo: implicitRedirectTarget(request),
      },
      actorFrom(context),
    );

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return respond(error, "POST /api/admin/users");
  }
}

/**
 * Directory failures carry a message written for an administrator and a status
 * chosen per case, so they are returned as they are rather than flattened into
 * the generic 500 that `errorResponse` gives an unrecognised error.
 */
function respond(error: unknown, route: string) {
  if (error instanceof DirectoryError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return errorResponse(error, route);
}
