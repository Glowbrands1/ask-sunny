import "server-only";

import { isDemoMode } from "@/lib/config/runtime";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { Permission } from "@/types";
import { getAuthProvider } from "./index";
import { AuthError, type AuthorizedContext } from "./types";

/**
 * SERVER-SIDE AUTHORIZATION GUARD.
 *
 * One function every protected route calls before doing anything. The order of
 * the checks is the design:
 *
 *   1. Is there a production-grade provider?  -> 501 if not (live mode)
 *   2. Did the request carry an identity?     -> 401 if not
 *   3. Was that identity actually verified?   -> 401 if not
 *   4. Does the role hold the permission?     -> 403 if not
 *
 * Step 1 is what makes "live mode refuses protected functionality until real
 * authentication exists" true rather than aspirational, and step 3 is what
 * stops a demo identity from satisfying step 2. Neither can be satisfied by
 * anything the browser sends.
 *
 * PERMISSION SOURCE OF TRUTH: the server uses DEFAULT_PERMISSION_MATRIX, not
 * the browser's copy. The matrix in IndexedDB is an editable demo convenience;
 * a client that edited it must not thereby grant itself server-side access.
 */

/**
 * Deliberate, explicitly-named escape hatch for the pre-authentication
 * acceptance test — the one run that proves upload -> retrieval -> answer works
 * end to end against real credentials, before an identity provider exists.
 *
 * IT CANNOT OPERATE IN PRODUCTION. The flag is gated on the runtime
 * environment, not on a warning: in a production build it is inert whatever it
 * is set to, so a deployment cannot be talked into unauthenticated access by an
 * environment variable. See `unauthenticatedBypassAvailable()` below.
 */
export const UNAUTHENTICATED_ESCAPE_HATCH = "ALLOW_UNAUTHENTICATED_LIVE_ACCESS";

/**
 * True when this process is a production build.
 *
 * `next build` and `next start` both set NODE_ENV=production; `next dev` sets
 * development and the test runner sets test. Every real deployment of this app
 * is therefore a production runtime, which is what makes this a structural
 * boundary rather than a convention someone has to remember.
 */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Whether the bypass is capable of operating in this environment AT ALL,
 * regardless of whether the flag is set.
 *
 * Separate from `unauthenticatedAccessAllowed()` so /api/health can report the
 * two facts an administrator actually needs apart from each other: whether the
 * door exists here, and whether it is currently open.
 */
export function unauthenticatedBypassAvailable(): boolean {
  return !isProductionRuntime();
}

/**
 * Whether unauthenticated live access is active right now.
 *
 * The production check comes FIRST and returns unconditionally. The flag is
 * never even read in a production runtime, so there is no value it could hold
 * that would change the answer.
 */
export function unauthenticatedAccessAllowed(): boolean {
  if (!unauthenticatedBypassAvailable()) return false;
  return process.env[UNAUTHENTICATED_ESCAPE_HATCH] === "true";
}

/**
 * True when an operator set the flag on a production deployment and it is being
 * ignored.
 *
 * Worth surfacing loudly rather than silently doing the right thing: someone
 * who set this believed it would take effect, which means they intended to run
 * without authentication and should be told plainly that they are not — and
 * that the variable should be removed.
 */
export function unauthenticatedBypassIgnoredInProduction(): boolean {
  return (
    isProductionRuntime() &&
    process.env[UNAUTHENTICATED_ESCAPE_HATCH] === "true"
  );
}

let warnedAboutEscapeHatch = false;
let warnedAboutIgnoredFlag = false;

/**
 * Authorizes a request, or throws AuthError.
 *
 * In demo mode this resolves against the demo provider and the demo role, so
 * every existing prototype behaviour keeps working. In live mode it refuses
 * until a real provider is configured.
 */
export async function authorizeRequest(
  request: Request,
  permission: Permission,
): Promise<AuthorizedContext> {
  const provider = getAuthProvider();
  const demo = isDemoMode();

  /* 1. No production provider. */
  if (!provider.isProductionGrade && !demo) {
    // Tell an operator who set the flag on a production build that it did
    // nothing, rather than letting them assume it worked.
    if (unauthenticatedBypassIgnoredInProduction() && !warnedAboutIgnoredFlag) {
      warnedAboutIgnoredFlag = true;
      console.error(
        `[ask-sunny] SECURITY: ${UNAUTHENTICATED_ESCAPE_HATCH} is set, but this is a production build and the bypass is disabled. Protected requests are being refused. Remove the variable — it can never take effect here.`,
      );
    }

    if (!unauthenticatedAccessAllowed()) {
      throw new AuthError(
        "no_provider",
        "This action requires authentication, and no identity provider is configured. Ask Sunny refuses protected functionality in live mode until one is connected.",
        provider.missingConfiguration,
      );
    }

    /*
     * Defence in depth. `unauthenticatedAccessAllowed()` already returns false
     * in production, so this is unreachable today — which is the point. It
     * means the branch that fabricates an unauthenticated identity carries its
     * own production check, and a future edit to the helper above cannot
     * silently open this door.
     */
    if (isProductionRuntime()) {
      throw new AuthError(
        "no_provider",
        "This action requires authentication. The development bypass cannot operate in a production build.",
      );
    }

    // Escape hatch taken. Say so loudly, once per process, without naming any
    // value — a silent bypass is exactly what this must not be.
    if (!warnedAboutEscapeHatch) {
      warnedAboutEscapeHatch = true;
      console.warn(
        `[ask-sunny] SECURITY: ${UNAUTHENTICATED_ESCAPE_HATCH} is enabled in a ${process.env.NODE_ENV ?? "non-production"} runtime. Protected routes are serving unauthenticated requests. This is for local acceptance testing only.`,
      );
    }

    return {
      identity: {
        subject: "unauthenticated:escape-hatch",
        email: "",
        displayName: "Unauthenticated",
        role: "developer",
        scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
        verified: false,
      },
      permission,
      provider: provider.kind,
    };
  }

  /* 2. Identity present? */
  const identity = await provider.identify({ headers: request.headers });
  if (!identity) {
    throw new AuthError(
      "unauthenticated",
      "You are not signed in.",
      provider.missingConfiguration,
    );
  }

  /* 3. Verified? Demo identities are not, and must not pass in live mode. */
  if (!demo && !identity.verified) {
    throw new AuthError(
      "unauthenticated",
      "The request carried an identity that was not verified by an identity provider.",
    );
  }

  /* 4. Permission. */
  if (!hasPermission(DEFAULT_PERMISSION_MATRIX, identity.role, permission)) {
    throw new AuthError(
      "forbidden",
      "Your role does not have permission to do that.",
    );
  }

  return { identity, permission, provider: provider.kind };
}

/** Test seam — lets the one-shot warnings be asserted more than once. */
export function __resetEscapeHatchWarning(): void {
  warnedAboutEscapeHatch = false;
  warnedAboutIgnoredFlag = false;
}
