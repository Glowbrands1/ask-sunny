import type { ResolvedEmployee } from "./diff";
import type { LocationCatalogEntry, NormalizedEmployee } from "./types";

/**
 * ============================================================================
 * PRE-SAVE DIAGNOSTICS — why the dry run's issue counts are what they are
 * ============================================================================
 *
 * COUNTS AND FIELD COMBINATIONS ONLY. Nothing here names an employee: no name,
 * email, EmployeeID, login id or date is copied out — dates are compared and
 * bucketed, never returned. The only identifiers are Woven's own vocabulary
 * (status and termination-type integers with their enum labels) and LOCATION
 * ids and names, which are salons, not people.
 *
 * READ-ONLY BY CONSTRUCTION. This module takes what the sync already read and
 * returns a report. It decides nothing: no status, no change, no write reads it.
 */

export interface CodeCount {
  /** Woven's integer, or null when the field was absent. */
  code: number | null;
  /** Woven's label from /lists/enums, when it has one. */
  label: string | null;
  count: number;
}

export interface TriState {
  yes: number;
  no: number;
  unset: number;
}

export interface SyncDiagnostics {
  /** The employees flagged `status_termination_conflict`: Active in Woven, with a past TerminationDate. */
  statusTerminationConflict: {
    total: number;
    /** Woven `Status` integers among them. */
    statusCodes: CodeCount[];
    /** Woven `TerminationType` integers among them. */
    terminationTypeCodes: CodeCount[];
    /** How many also carry a real `TerminatedLastDayWorked`. */
    withLastDayWorked: number;
    /** The rehire shape: HireDate or StartDate LATER than the TerminationDate. */
    hiredOrStartedAfterTermination: number;
    /** HireDate/StartDate on or before the TerminationDate: termination recorded, status not changed. */
    hiredOrStartedOnOrBeforeTermination: number;
    noHireOrStartDate: number;
    /** How long ago the TerminationDate is, from the run's "today". */
    terminationDateAge: { within30Days: number; within365Days: number; over365Days: number; before2000: number };
    /** Which list read returned them. Only-with-terminated would mean Woven's own filter treats them as terminated. */
    inCurrentList: number;
    onlyInWithTerminatedList: number;
    wovenLoginAllowed: TriState;
  };
  /** Locations employees reference that `GET /locations` did not return. */
  locationsOutsideCatalog: {
    catalogSize: number;
    /** Distinct locations named by any employee (primary or details). */
    referencedLocations: number;
    referencedInCatalog: number;
    catalogNotReferenced: number;
    /** Location data only — no employee. `asPrimary`/`inDetails` count employees. */
    outside: { wovenLocationId: string; name: string | null; asPrimary: number; inDetails: number }[];
  };
  /** Who needed an employee-details read, and what happened. */
  detailSelection: {
    /** Employees not terminated whose list row does not settle their locations. */
    candidates: number;
    candidatesMultipleLocationFlagTrue: number;
    candidatesMultipleLocationFlagUnset: number;
    candidatesAllLocationAccess: number;
    /** All-location employees whose multiple-location flag is NOT true (these widen the count beyond it). */
    candidatesAllLocationWithoutMultipleFlag: number;
    budget: number;
    attempted: number;
    fetched: number;
    notFound: number;
    /** Read, but no usable Locations[] (e.g. an all-location employee with an empty list). */
    noUsableLocationList: number;
    /** A details failure other than 404 stopped further reads. */
    interrupted: boolean;
  };
  /** The employees whose details read returned 404. */
  detailsNotFound: {
    total: number;
    inCurrentList: number;
    withPrimaryLocation: number;
    primaryInCatalog: number;
    withEmployeeLoginId: number;
    withEmail: number;
    withPositionId: number;
    hasMultipleLocationAccess: TriState;
    hasAllLocationAccess: TriState;
    wovenLoginAllowed: TriState;
    statusCodes: CodeCount[];
    vendorEmployees: number;
    /** After resolution: the primary location is kept as the primary. */
    primaryRetained: number;
    /** After resolution: flagged `affiliations_not_verified`, so only the primary is asserted on save. */
    markedAffiliationsNotVerified: number;
  };
  missingPositionId: {
    total: number;
    /** Carried a PositionName without a PositionID. */
    withPositionName: number;
    statusCodes: CodeCount[];
  };
}

export interface DiagnosticsInput {
  employees: readonly NormalizedEmployee[];
  resolved: readonly ResolvedEmployee[];
  currentListIds: ReadonlySet<string>;
  catalog: ReadonlyMap<string, LocationCatalogEntry>;
  candidates: readonly NormalizedEmployee[];
  details: {
    budget: number;
    attempted: number;
    fetched: number;
    notFoundIds: ReadonlySet<string>;
    noUsableLocationList: number;
    interrupted: boolean;
  };
  statusLabels: Readonly<Record<number, string>>;
  terminationTypeLabels: Readonly<Record<number, string>>;
  /** YYYY-MM-DD. */
  today: string;
}

const MAX_OUTSIDE_LOCATIONS = 25;

function tri(values: Iterable<boolean | null>): TriState {
  const out = { yes: 0, no: 0, unset: 0 };
  for (const v of values) {
    if (v === true) out.yes += 1;
    else if (v === false) out.no += 1;
    else out.unset += 1;
  }
  return out;
}

function codeCounts(codes: Iterable<number | null>, labels: Readonly<Record<number, string>>): CodeCount[] {
  const counts = new Map<number | null, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, count]) => ({ code, label: code === null ? null : labels[code] ?? null, count }))
    .sort((a, b) => b.count - a.count || (a.code ?? -1) - (b.code ?? -1));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function joined(e: NormalizedEmployee): string | null {
  const dates = [e.hireDate, e.startDate].filter((d): d is string => d !== null).sort();
  return dates.at(-1) ?? null;
}

export function buildSyncDiagnostics(input: DiagnosticsInput): SyncDiagnostics {
  const { employees, resolved, currentListIds, catalog, candidates, details, statusLabels, today } = input;

  /* ---- status_termination_conflict ---- */
  const conflicts = employees.filter((e) => e.issues.includes("status_termination_conflict"));
  const age = { within30Days: 0, within365Days: 0, over365Days: 0, before2000: 0 };
  let after = 0;
  let onOrBefore = 0;
  let noJoin = 0;
  for (const e of conflicts) {
    const termination = e.terminationDate!;
    const latestJoin = joined(e);
    if (latestJoin === null) noJoin += 1;
    else if (latestJoin > termination) after += 1;
    else onOrBefore += 1;

    if (termination < "2000-01-01") age.before2000 += 1;
    else {
      const days = daysBetween(termination, today);
      if (days <= 30) age.within30Days += 1;
      else if (days <= 365) age.within365Days += 1;
      else age.over365Days += 1;
    }
  }

  /* ---- locations outside the catalog ---- */
  const referenced = new Map<string, { name: string | null; asPrimary: number; inDetails: number }>();
  for (const e of resolved) {
    for (const a of e.affiliations) {
      const entry = referenced.get(a.wovenLocationId) ?? { name: null, asPrimary: 0, inDetails: 0 };
      entry.name ??= a.locationName;
      if (a.accessType === "primary") entry.asPrimary += 1;
      else entry.inDetails += 1;
      referenced.set(a.wovenLocationId, entry);
    }
  }
  const outside = [...referenced.entries()]
    .filter(([id]) => !catalog.has(id))
    .map(([wovenLocationId, v]) => ({ wovenLocationId, ...v }))
    .sort((a, b) => a.wovenLocationId.localeCompare(b.wovenLocationId));
  const referencedInCatalog = [...referenced.keys()].filter((id) => catalog.has(id)).length;

  /* ---- details ---- */
  const notFound = employees.filter((e) => details.notFoundIds.has(e.externalEmployeeId));
  const resolvedById = new Map(resolved.map((e) => [e.externalEmployeeId, e]));

  const missingPosition = employees.filter((e) => e.positionId === null);

  return {
    statusTerminationConflict: {
      total: conflicts.length,
      statusCodes: codeCounts(conflicts.map((e) => e.employmentStatusCode), statusLabels),
      terminationTypeCodes: codeCounts(conflicts.map((e) => e.terminationTypeCode), input.terminationTypeLabels),
      withLastDayWorked: conflicts.filter((e) => e.terminationLastDayWorked !== null).length,
      hiredOrStartedAfterTermination: after,
      hiredOrStartedOnOrBeforeTermination: onOrBefore,
      noHireOrStartDate: noJoin,
      terminationDateAge: age,
      inCurrentList: conflicts.filter((e) => currentListIds.has(e.externalEmployeeId)).length,
      onlyInWithTerminatedList: conflicts.filter((e) => !currentListIds.has(e.externalEmployeeId)).length,
      wovenLoginAllowed: tri(conflicts.map((e) => e.wovenLoginAllowed)),
    },
    locationsOutsideCatalog: {
      catalogSize: catalog.size,
      referencedLocations: referenced.size,
      referencedInCatalog,
      catalogNotReferenced: [...catalog.keys()].filter((id) => !referenced.has(id)).length,
      outside: outside.slice(0, MAX_OUTSIDE_LOCATIONS),
    },
    detailSelection: {
      candidates: candidates.length,
      candidatesMultipleLocationFlagTrue: candidates.filter((e) => e.hasMultipleLocationAccess === true).length,
      candidatesMultipleLocationFlagUnset: candidates.filter((e) => e.hasMultipleLocationAccess === null).length,
      candidatesAllLocationAccess: candidates.filter((e) => e.hasAllLocationAccess === true).length,
      candidatesAllLocationWithoutMultipleFlag: candidates.filter(
        (e) => e.hasAllLocationAccess === true && e.hasMultipleLocationAccess !== true,
      ).length,
      budget: details.budget,
      attempted: details.attempted,
      fetched: details.fetched,
      notFound: details.notFoundIds.size,
      noUsableLocationList: details.noUsableLocationList,
      interrupted: details.interrupted,
    },
    detailsNotFound: {
      total: notFound.length,
      inCurrentList: notFound.filter((e) => currentListIds.has(e.externalEmployeeId)).length,
      withPrimaryLocation: notFound.filter((e) => e.primaryLocationId !== null).length,
      primaryInCatalog: notFound.filter((e) => e.primaryLocationId !== null && catalog.has(e.primaryLocationId)).length,
      withEmployeeLoginId: notFound.filter((e) => e.employeeLoginId !== null).length,
      withEmail: notFound.filter((e) => e.emailAddress !== null).length,
      withPositionId: notFound.filter((e) => e.positionId !== null).length,
      hasMultipleLocationAccess: tri(notFound.map((e) => e.hasMultipleLocationAccess)),
      hasAllLocationAccess: tri(notFound.map((e) => e.hasAllLocationAccess)),
      wovenLoginAllowed: tri(notFound.map((e) => e.wovenLoginAllowed)),
      statusCodes: codeCounts(notFound.map((e) => e.employmentStatusCode), statusLabels),
      vendorEmployees: notFound.filter((e) => e.issues.includes("vendor_employee")).length,
      primaryRetained: notFound.filter((e) => {
        const r = resolvedById.get(e.externalEmployeeId);
        return (
          e.primaryLocationId !== null &&
          r !== undefined &&
          r.affiliations.some((a) => a.accessType === "primary" && a.wovenLocationId === e.primaryLocationId)
        );
      }).length,
      markedAffiliationsNotVerified: notFound.filter((e) => {
        const r = resolvedById.get(e.externalEmployeeId);
        return r !== undefined && !r.affiliationsVerified && r.issues.includes("affiliations_not_verified");
      }).length,
    },
    missingPositionId: {
      total: missingPosition.length,
      withPositionName: missingPosition.filter((e) => e.positionName !== null).length,
      statusCodes: codeCounts(missingPosition.map((e) => e.employmentStatusCode), statusLabels),
    },
  };
}
