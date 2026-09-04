import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isDemoMode } from "@/lib/config/runtime";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { Permission, Role } from "@/types";
import { getAuthProvider } from "./index";
import type { AuthenticatedIdentity } from "./types";

/**
 * ============================================================================
 * PAGE AUTHORIZATION. THE GUARD A SERVER COMPONENT CALLS FIRST.
 * ============================================================================
 *
 * The API routes have had `authorizeRequest()` all along. Pages had nothing —
 * `/`, `/knowledge`, `/resources` and `/forms/create` rendered for anybody who
 * knew the URL, and the sidebar's job was to not mention them. A hidden link is
 * not a boundary: typing the path was enough.
 *
 * These helpers are the page-side equivalent, and they run on the SERVER before
 * any data is read, so a refused page never fetches the rows it would have
 * shown. That ordering is the point — a client-side redirect after the render
 * has already put the data in the response.
 *
 * WHY THERE ARE TWO OF THEM
 *   `requireAuthenticatedPage()`  — must be signed in. Nothing more.
 *   `requirePagePermission(p)`    — signed in AND holds the permission.
 * A screen every authenticated person may open still needs the first, and
 * saying so explicitly is better than a page with no call at all, which reads
 * identically to a page somebody forgot to guard.
 */

/**
 * Whether page guards ENFORCE, or only resolve.
 *
 * They enforce exactly when a production-grade provider is in play. In demo
 * mode they deliberately do not, and this is the same decision the sidebar
 * already made for the same reason: the demo permission matrix is this app's
 * own guess, and enforcing a guess left Form Templates with no way in at all
 * ("I don't see it on the app"). A presenter switching to a narrow role must
 * also be able to switch back, which a redirect out of every screen would
 * prevent.
 *
 * Nothing is being loosened by this. Demo mode has no verified identity to
 * enforce against — `authorizeRequest` refuses every protected API call in live
 * mode without one, and the demo provider reports `verified: false` precisely
 * so it can never stand in for authentication.
 */
export function pageAuthorizationEnforced(): boolean {
  return getAuthProvider().isProductionGrade;
}

/**
 * WHERE A ROLE LANDS WHEN IT SIGNS IN, and where it is sent when it asks for a
 * screen it may not have.
 *
 * An Employee cannot see the Overview, so sending them to `/` after sign-in
 * would bounce them straight back out — and a redirect loop is the classic way
 * this goes wrong. Ask Sunny is the screen their role exists for, so that is
 * where they start.
 *
 * The rule is derived from the permission rather than listed by role, so a role
 * added later lands somewhere it can actually see without anyone remembering to
 * update this.
 */
export function defaultLandingForRole(role: Role): string {
  if (hasPermission(DEFAULT_PERMISSION_MATRIX, role, "view_overview")) return "/";
  if (hasPermission(DEFAULT_PERMISSION_MATRIX, role, "ask_questions")) return "/chat";
  /*
   * A role with neither is not something the matrix currently produces. Landing
   * on the login screen is the honest answer for it: there is no screen this
   * person can open, and pretending otherwise would be a loop.
   */
  return "/login";
}

/** Resolves the caller for a page render, or null. Never throws, never redirects. */
export async function pageIdentity(): Promise<AuthenticatedIdentity | null> {
  /*
   * `headers()` rather than a Request, because a Server Component has no
   * Request object. `AuthProvider.identify()` is defined against a plain
   * `Headers` for exactly this reason — the interface stayed free of the web
   * framework, so pages and route handlers share one provider.
   */
  const store = await headers();
  return getAuthProvider().identify({ headers: new Headers(store) });
}

/**
 * The signed-in caller, or a redirect to the login screen.
 *
 * `redirect()` throws, so this never returns for an unauthenticated caller and
 * the calling page can use the result without a null check.
 */
export async function requireAuthenticatedPage(): Promise<AuthenticatedIdentity | null> {
  if (!pageAuthorizationEnforced()) return pageIdentity();

  const identity = await pageIdentity();
  if (!identity || !identity.verified) redirect("/login");
  return identity;
}

/**
 * The signed-in caller, having checked they hold `permission`.
 *
 * A caller who lacks it is sent to their OWN landing page rather than shown an
 * error, carrying `?denied=` so the shell can say what happened. Bouncing
 * somebody with no explanation is how a permission boundary gets reported as a
 * broken link.
 *
 * The permission is checked against DEFAULT_PERMISSION_MATRIX on the server.
 * The browser's copy lives in IndexedDB and is editable in demo mode; a client
 * that edited it must not thereby open a screen.
 */
export async function requirePagePermission(
  permission: Permission,
): Promise<AuthenticatedIdentity | null> {
  if (!pageAuthorizationEnforced()) return pageIdentity();

  const identity = await requireAuthenticatedPage();
  // Unreachable when enforcing — requireAuthenticatedPage redirects — but the
  // types do not know that, and a null here must never read as "allowed".
  if (!identity) redirect("/login");

  if (!hasPermission(DEFAULT_PERMISSION_MATRIX, identity.role, permission)) {
    const landing = defaultLandingForRole(identity.role);
    redirect(`${landing}${landing.includes("?") ? "&" : "?"}denied=${permission}`);
  }

  return identity;
}

/**
 * True when demo mode is the reason a guard did not enforce.
 *
 * Used by the screens that carry the preview notice, so the sentence they show
 * is tied to the SAME condition the guard used rather than to a second,
 * separately-maintained check of the environment.
 */
export function pageGuardsAreAdvisoryOnly(): boolean {
  return isDemoMode() && !pageAuthorizationEnforced();
}
