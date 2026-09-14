import "server-only";

import type { AccessScope } from "@/types";
import { pageIdentity } from "@/lib/auth/page";
import {
  reportingScopeOf,
  scopeAreaLabel,
  type ReportingScope,
} from "./authorized-salons";
import { areaSalonNumbersFromReporting } from "./reporting-areas";

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
  return resolveScopeFor(identity.scope);
}

/**
 * ============================================================================
 * A DISTRICT OR REGION SCOPE IS ANSWERED BY REPORTING, NOT BY A FILE
 * ============================================================================
 *
 * The checked-in roster is presentation metadata: it names areas for a picker
 * and a caption. It does not decide who may read what.
 *
 * IT USED TO, AND THAT HAD ONE FAILURE MODE THAT FAILS OPEN. District and
 * region scopes resolved by iterating the roster. A salon-level scope never
 * did — `salonNumberOf` parses the number out of the id and reads no file — so
 * the roster only decided anything for the two AREA levels. If reporting moves
 * a salon to a different manager and the file has not been updated, the
 * district it LEFT keeps matching it and keeps receiving its protected rows.
 * Every other kind of staleness hides data; that one discloses it, and no test
 * over the file could find it, because the file stays internally consistent and
 * simply disagrees with the world.
 *
 * So area membership is asked of `salon_period_attributes` — the same rows the
 * reports are drawn from — and a move takes effect with the next delivery, with
 * no deploy and nothing to remember. `reporting-areas.ts` records why it fails
 * closed on every error rather than falling back to the file.
 *
 * A SALON SCOPE STILL RESOLVES WITHOUT A ROUND TRIP, deliberately. Its id
 * cannot drift, and adding a query would let a database outage lock out the one
 * account type that never needed the database to be right.
 *
 * ============================================================================
 * WHY THIS IS SEPARATE FROM `resolveReportingScope`
 * ============================================================================
 *
 * The chat and the Sales Totals analyser route both authorize their own request
 * and then need the reach that identity has, without going back through
 * `pageIdentity`. Before this existed they each called `reportingScopeOf`
 * directly — so a district-scoped account got the STATIC answer through Ask
 * Sunny and the data-backed one through a report page. The same person, two
 * different allowlists, and the weaker one on the surface that composes free
 * text. One function, so that cannot happen again.
 */
export async function resolveScopeFor(
  scope: AccessScope | null | undefined,
): Promise<ReportingScope> {
  const level = scope?.level;

  if (level !== "district" && level !== "region") {
    return reportingScopeOf(scope ?? null);
  }

  const alsoCovers = Array.isArray(scope?.alsoCoversAreaIds) ? scope.alsoCoversAreaIds : [];
  const areaIds = [scope?.primaryAreaId, ...alsoCovers].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  return {
    level,
    /* Never unrestricted here: that belongs to a global scope alone. */
    unrestricted: false,
    salonNumbers: await areaSalonNumbersFromReporting(level, areaIds),
    areaLabel: scopeAreaLabel(scope ?? null),
  };
}

export type { ReportingScope };
