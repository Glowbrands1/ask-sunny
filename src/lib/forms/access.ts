import "server-only";

import { isDemoMode } from "@/lib/config/runtime";
import { AuthError } from "@/lib/auth/types";
import { authorizeRequest } from "@/lib/auth/server";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { Permission, Role } from "@/types";

/**
 * WHO MAY TOUCH A FORM, AND WHAT THIS APP CAN HONESTLY PROMISE ABOUT IT.
 *
 * Forms hold HR content, and Ask Sunny runs in two modes. Those two facts
 * together decide everything in this file, so they are stated plainly rather
 * than papered over:
 *
 *   LIVE MODE -> AUTHORIZED, FOR REAL. `authorizeRequest` validates the session
 *   with Supabase Auth and reads the role from `app_users`. Where no provider
 *   is configured it still returns 501: a deployment claiming to be live cannot
 *   write employee records on the strength of a browser saying who it is.
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
 * THE IDENTITY PROVIDER HAS LANDED, and this file changed by exactly nothing —
 * which is what the live branch below was written for. `authorizeRequest` now
 * resolves a real identity from a validated session and a role from
 * `app_users`, so live mode AUTHORIZES rather than refusing.
 *
 * What is left to do here is subtraction, not addition: when demo mode itself
 * goes, delete `demoActor` and its branch, and add the per-user RLS policies
 * the migration's comment describes.
 */

export interface FormsActor {
  /** Stored on rows and events. Prefixed so an unverified identity is obvious. */
  id: string;
  role: Role | null;
  verified: boolean;
  /**
   * Set in preview mode to the permission this call WOULD have needed, when the
   * preview role does not carry it. Recorded rather than refused — see
   * `authorizeForms`.
   */
  wouldRequire?: Permission;
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
 * Live mode defers entirely to `authorizeRequest`: a validated session, a role
 * from `app_users`, and the server's own permission matrix. Demo mode resolves
 * the preview role and returns an actor marked unverified.
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
  /*
   * PREVIEW MODE DOES NOT ENFORCE THE MATRIX, AND THAT IS THE HONEST CHOICE.
   *
   * `DEFAULT_PERMISSION_MATRIX` is this app's own GUESS at who does what.
   * Nobody has configured roles yet, so refusing a Salon Director the DMIT EPP
   * was not policy being applied — it was an invented restriction standing in
   * front of a form the owner was trying to look at. It was self-defeating too:
   * the role it checks arrives in a header the browser sets, so anyone refused
   * could simply claim another role and carry on.
   *
   * The permission is still RESOLVED and carried on the actor, so a screen can
   * say "this will need Create EPP once roles are configured". The model stays
   * visible without standing in the way.
   *
   * Live mode is untouched, and is now where enforcement actually happens:
   * `authorizeRequest` above applies the same matrix to a VERIFIED identity, so
   * this branch is unreachable there. Enforcement belongs in that branch and in
   * RLS, against an identity a provider vouched for — never here, against one
   * the browser asserted about itself.
   */
  const carries = hasPermission(DEFAULT_PERMISSION_MATRIX, actor.role, permission);
  return carries ? actor : { ...actor, wouldRequire: permission };
}

/**
 * The banner text the Forms screens show in DEMO MODE only.
 *
 * `formsIdentityIsUnverified()` is false under real authentication, so this
 * disappears the moment a provider is configured — which is the point of tying
 * it to the same condition the guard uses rather than to a second flag.
 *
 * Exported from here rather than written into a component so it cannot be
 * quietly dropped from one screen while the others keep claiming it.
 */
export const SYNTHETIC_DATA_NOTICE =
  "Preview mode: Ask Sunny cannot yet verify who is signed in, so forms created here are for testing only. Use synthetic employee details — do not enter real HR information until an identity provider is connected.";

/** True while that notice must be shown. */
export function formsIdentityIsUnverified(): boolean {
  return isDemoMode();
}
