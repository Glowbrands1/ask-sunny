import "server-only";

import { isDemoMode } from "@/lib/config/runtime";
import { AuthError } from "@/lib/auth/types";
import { authorizeRequest } from "@/lib/auth/server";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { Permission, Role } from "@/types";

/**
 * WHO MAY TOUCH A FORM, AND WHAT THIS APP CAN HONESTLY PROMISE ABOUT IT.
 *
 * Forms hold HR content, and Ask Sunny has no identity provider. Those two
 * facts together decide everything in this file, so they are stated plainly
 * rather than papered over:
 *
 *   LIVE MODE, NO PROVIDER -> REFUSED. `authorizeRequest` already returns 501
 *   when no production-grade provider is configured, and Forms goes through it.
 *   A deployment claiming to be live cannot write employee records on the
 *   strength of a browser saying who it is.
 *
 *   DEMO MODE -> ALLOWED, AND LABELLED. The role comes from the browser's
 *   preview session, which is not verification and is not treated as such: the
 *   actor is stamped `demo:<role>` on every row and event, the screens carry a
 *   standing notice that only synthetic data belongs here, and the database is
 *   reachable by nothing but the secret key.
 *
 * The permission matrix is still applied — a Salon Director cannot open
 * Template Management even in demo — because the matrix is the app's own model
 * of who does what, and QA against a wrong model teaches the wrong thing. What
 * it is NOT is a security boundary, and this file does not pretend otherwise.
 *
 * WHEN AN IDENTITY PROVIDER LANDS: delete `demoActor` and its caller, let
 * `authorizeRequest` answer in both modes, and add the per-user RLS policies
 * the migration's comment describes. Nothing else here should need to change.
 */

export interface FormsActor {
  /** Stored on rows and events. Prefixed so an unverified identity is obvious. */
  id: string;
  role: Role | null;
  verified: boolean;
}

const DEMO_ROLE_HEADER = "x-ask-sunny-demo-role";
const DEMO_NAME_HEADER = "x-ask-sunny-demo-name";

function readDemoRole(request: Request): Role | null {
  const raw = request.headers.get(DEMO_ROLE_HEADER);
  if (!raw) return null;
  const roles = Object.keys(DEFAULT_PERMISSION_MATRIX) as Role[];
  return roles.includes(raw as Role) ? (raw as Role) : null;
}

/**
 * The demo identity, taken from the preview session and never trusted.
 *
 * It is used for two things only: applying the permission matrix so the screens
 * behave the way they will once identity is real, and labelling the row so
 * every record created this way says so.
 */
function demoActor(request: Request): FormsActor {
  const role = readDemoRole(request);
  const name = request.headers.get(DEMO_NAME_HEADER)?.slice(0, 60) ?? "preview";
  return {
    id: `demo:${role ?? "unknown"}:${name}`,
    role,
    verified: false,
  };
}

/**
 * The one guard every Forms route calls.
 *
 * Live mode defers entirely to `authorizeRequest`, which refuses until a real
 * provider exists. Demo mode applies the matrix to the preview role and returns
 * an actor marked unverified.
 */
export async function authorizeForms(
  request: Request,
  permission: Permission,
): Promise<FormsActor> {
  if (!isDemoMode()) {
    const context = await authorizeRequest(request, permission);
    return {
      id: context.identity.subject,
      role: context.identity.role,
      // `authorizeRequest` refuses anything a production-grade provider did not
      // vouch for, so reaching here means the identity really was verified —
      // but the flag is carried from the identity rather than asserted, so the
      // two can never disagree.
      verified: context.identity.verified,
    };
  }

  const actor = demoActor(request);
  if (!actor.role) {
    throw new AuthError(
      "unauthenticated",
      "Sign in to Ask Sunny before working with forms.",
    );
  }
  if (!hasPermission(DEFAULT_PERMISSION_MATRIX, actor.role, permission)) {
    throw new AuthError(
      "forbidden",
      "Your role does not include this. Ask an administrator.",
    );
  }
  return actor;
}

/**
 * The banner text the Forms screens must show while identity is unverified.
 *
 * Exported from here rather than written into a component so there is one
 * sentence to delete when authentication lands — and so it cannot be quietly
 * dropped from one screen while the others keep claiming it.
 */
export const SYNTHETIC_DATA_NOTICE =
  "Preview mode: Ask Sunny cannot yet verify who is signed in, so forms created here are for testing only. Use synthetic employee details — do not enter real HR information until an identity provider is connected.";

/** True while that notice must be shown. */
export function formsIdentityIsUnverified(): boolean {
  return isDemoMode();
}
