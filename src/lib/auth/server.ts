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
 * It is not a configuration option. It is reported by /api/health as a security
 * problem, it is logged on every use, and it must never be set on anything
 * reachable from outside a developer's machine.
 */
export const UNAUTHENTICATED_ESCAPE_HATCH = "ALLOW_UNAUTHENTICATED_LIVE_ACCESS";

export function unauthenticatedAccessAllowed(): boolean {
  return process.env[UNAUTHENTICATED_ESCAPE_HATCH] === "true";
}

let warnedAboutEscapeHatch = false;

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
    if (!unauthenticatedAccessAllowed()) {
      throw new AuthError(
        "no_provider",
        "This action requires authentication, and no identity provider is configured. Ask Sunny refuses protected functionality in live mode until one is connected.",
        provider.missingConfiguration,
      );
    }

    // Escape hatch taken. Say so loudly, once per process, without naming any
    // value — a silent bypass is exactly what this must not be.
    if (!warnedAboutEscapeHatch) {
      warnedAboutEscapeHatch = true;
      console.warn(
        `[ask-sunny] SECURITY: ${UNAUTHENTICATED_ESCAPE_HATCH} is enabled. Protected routes are serving unauthenticated requests. This must never be set on a reachable deployment.`,
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

/** Test seam — lets the one-shot warning be asserted more than once. */
export function __resetEscapeHatchWarning(): void {
  warnedAboutEscapeHatch = false;
}
