import "server-only";

import { pageIdentity } from "@/lib/auth/page";
import { reportingScopeOf, type ReportingScope } from "./authorized-salons";

/**
 * THE CALLER'S REPORTING REACH, RESOLVED ON THE SERVER.
 *
 * Every reporting page calls this after its permission guard and before its
 * first query, and passes the result into the read layer. That ordering is the
 * whole point: a refused salon is never fetched, so there is no window in which
 * its figures exist in the response and a filter is trusted to hide them.
 *
 * THE IDENTITY COMES FROM THE SESSION, NEVER FROM THE REQUEST. `pageIdentity`
 * resolves the caller through the auth provider, which reads `app_users` under
 * the session's own row level security. Nothing here reads a query parameter, a
 * header the browser controls, or a prop.
 *
 * AN UNVERIFIED IDENTITY IS UNRESTRICTED, and that is not a hole. In live mode
 * `requirePagePermission` has already redirected an unauthenticated caller
 * before this runs; an unverified identity therefore only occurs in demo mode,
 * where there is no real assignment to enforce and the standing preview notice
 * already says the screens are not a security boundary. See
 * `forms/location-scope.ts`, which made the same call for the same reason.
 */
export async function resolveReportingScope(): Promise<ReportingScope> {
  const identity = await pageIdentity();
  if (!identity || !identity.verified) return reportingScopeOf(null);
  return reportingScopeOf(identity.scope);
}

export type { ReportingScope };
