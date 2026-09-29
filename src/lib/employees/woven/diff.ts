import { createHash } from "node:crypto";

import type {
  ChangeClassification,
  DirectoryChange,
  DirectoryRecord,
  EmployeeIssue,
  JsonValue,
  LocationAffiliation,
  NormalizedEmployee,
  PositionMapEntry,
} from "./types";

/**
 * ============================================================================
 * CHANGE DETECTION — what moved between the directory on file and this read
 * ============================================================================
 *
 * PURE. No clock, no database, no network: `today` is passed in, so the same
 * inputs always give the same changes, which is what makes a re-run of an
 * unchanged read record nothing at all.
 *
 * WHAT A CHANGE IS NOT:
 *
 *   NOT A PROMOTION BY DEFAULT. A new PositionID is `position_changed`,
 *   classified `unclassified`. It is `promotion_confirmed` or
 *   `demotion_confirmed` only when BOTH positions are confirmed by a person in
 *   the position map and both carry a rank; `lateral` when the ranks are equal.
 *
 *   NOT MISSING DATA. A PositionID or location absent from this read is a
 *   data-quality issue, not a change.
 *
 *   NOT A REMOVAL THAT WAS NEVER READ. Location access is only compared when
 *   this run read the employee's full list.
 *
 *   NOT A STATUS GUESS. Moving INTO `unknown` records nothing, and neither
 *   does unknown → active. Only Woven's explicit terminated status records a
 *   termination.
 *
 *   NOT AN ACCESS DECISION. Nothing here changes a role, a scope, a salon
 *   assignment or a login.
 *
 * EFFECTIVE DATES ARE ONLY WOVEN'S: a hire or start date, a termination date,
 * an access expiry. Woven states no date for a position or location move, so
 * those carry none and the change feed shows when it was detected.
 */

/** An employee after the details step: affiliations settled, one way or the other. */
export interface ResolvedEmployee extends Omit<NormalizedEmployee, "affiliations"> {
  affiliations: LocationAffiliation[];
  /** True only when THIS run read the full affiliation list. */
  affiliationsVerified: boolean;
}

export interface DiffOptions {
  initialLoad: boolean;
  /** YYYY-MM-DD. */
  today: string;
  newHireWindowDays: number;
  positions: ReadonlyMap<string, PositionMapEntry>;
}

/** How many consecutive absences before `missing_from_source` is recorded. */
export const MISSING_THRESHOLD = 3;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function affiliationJson(entry: LocationAffiliation): JsonValue {
  return {
    wovenLocationId: entry.wovenLocationId,
    locationName: entry.locationName,
    locationNumber: entry.locationNumber,
    accessType: entry.accessType,
    expiresOn: entry.expiresOn,
  };
}

/** `promotion_confirmed` / `demotion_confirmed` / `lateral` only when both ends are confirmed and ranked. */
export function classifyPositionChange(
  fromId: string | null,
  toId: string,
  positions: ReadonlyMap<string, PositionMapEntry>,
): ChangeClassification {
  if (fromId === null) return "unclassified";
  const from = positions.get(fromId);
  const to = positions.get(toId);
  if (!from?.isConfirmed || !to?.isConfirmed) return "unclassified";
  if (from.hierarchyRank === null || to.hierarchyRank === null) return "unclassified";
  if (to.hierarchyRank > from.hierarchyRank) return "promotion_confirmed";
  if (to.hierarchyRank < from.hierarchyRank) return "demotion_confirmed";
  return "lateral";
}

/** `new_hire` when hired or started within the window of the first sync that saw them. */
export function classifyNewEmployee(next: ResolvedEmployee, options: DiffOptions): ChangeClassification {
  if (options.initialLoad) return "initial_load";
  const joined = next.startDate ?? next.hireDate;
  if (joined === null) return "newly_visible";
  const age = daysBetween(joined, options.today);
  return age >= -options.newHireWindowDays && age <= options.newHireWindowDays ? "new_hire" : "newly_visible";
}

export function diffEmployee(
  previous: DirectoryRecord | undefined,
  next: ResolvedEmployee,
  options: DiffOptions,
): DirectoryChange[] {
  const id = next.externalEmployeeId;

  if (!previous) {
    return [
      {
        externalEmployeeId: id,
        kind: "new_employee",
        fieldName: null,
        fromValue: null,
        toValue: {
          employmentStatus: next.employmentStatus,
          positionId: next.positionId,
          positionName: next.positionName,
          primaryLocationId: next.primaryLocationId,
          primaryLocationName: next.primaryLocationName,
        },
        classification: classifyNewEmployee(next, options),
        effectiveDate: next.hireDate ?? next.startDate,
        details: {},
      },
    ];
  }

  const changes: DirectoryChange[] = [];

  /*
   * ---- employment status ----
   * TERMINATED when Woven now says so and did not before — from active, or
   * from an unrecognised status such as a leave. REACTIVATED only from an
   * explicit terminated. A move INTO `unknown` records nothing: an unresolved
   * label is not news about a person.
   */
  if (next.employmentStatus === "terminated" && previous.employmentStatus !== "terminated") {
    changes.push({
      externalEmployeeId: id,
      kind: "terminated",
      fieldName: "employment_status",
      fromValue: { employmentStatus: previous.employmentStatus },
      toValue: { employmentStatus: next.employmentStatus, terminationDate: next.terminationDate },
      classification: null,
      effectiveDate: next.terminationDate,
      /* Recorded only. Disabling an Ask Sunny login is a later, separately approved phase. */
      details: {
        lastDayWorked: next.terminationLastDayWorked,
        terminationTypeCode: next.terminationTypeCode,
        accessChanged: false,
      },
    });
  } else if (next.employmentStatus === "active" && previous.employmentStatus === "terminated") {
    const rejoined =
      next.startDate !== previous.startDate ? next.startDate : next.hireDate !== previous.hireDate ? next.hireDate : null;
    changes.push({
      externalEmployeeId: id,
      kind: "reactivated",
      fieldName: "employment_status",
      fromValue: { employmentStatus: previous.employmentStatus, terminationDate: previous.terminationDate },
      toValue: { employmentStatus: next.employmentStatus, hireDate: next.hireDate, startDate: next.startDate },
      classification: "rehire",
      effectiveDate: rejoined,
      details: { accessChanged: false },
    });
  }

  /* ---- position ---- */
  if (next.positionId !== null && next.positionId !== previous.positionId) {
    changes.push({
      externalEmployeeId: id,
      kind: "position_changed",
      fieldName: "position_id",
      fromValue: { positionId: previous.positionId, positionName: previous.positionName },
      toValue: { positionId: next.positionId, positionName: next.positionName },
      classification: classifyPositionChange(previous.positionId, next.positionId, options.positions),
      effectiveDate: null,
      details: { roleChanged: false },
    });
  }

  /* ---- primary location ---- */
  if (next.primaryLocationId !== null && next.primaryLocationId !== previous.primaryLocationId) {
    changes.push({
      externalEmployeeId: id,
      kind: "primary_location_changed",
      fieldName: "primary_woven_location_id",
      fromValue: { primaryLocationId: previous.primaryLocationId, primaryLocationName: previous.primaryLocationName },
      toValue: { primaryLocationId: next.primaryLocationId, primaryLocationName: next.primaryLocationName },
      classification: previous.primaryLocationId === null ? "assigned" : "transfer",
      effectiveDate: null,
      details: { scopeChanged: false },
    });
  }

  /*
   * ---- location access, only when this run read the full list ----
   *
   * Compared by LOCATION, across every access type. A move of primary is the
   * primary change above, so the new primary is never also "added" and the old
   * one never also "removed". A location whose access type changes (additional
   * → expiring, say) is neither added nor removed.
   */
  if (next.affiliationsVerified) {
    const before = new Map(previous.affiliations.map((a) => [a.wovenLocationId, a]));
    const after = new Map(next.affiliations.map((a) => [a.wovenLocationId, a]));

    for (const [locationId, entry] of after) {
      if (before.has(locationId) || locationId === next.primaryLocationId) continue;
      changes.push({
        externalEmployeeId: id,
        kind: "location_access_added",
        fieldName: `location:${locationId}`,
        fromValue: null,
        toValue: affiliationJson(entry),
        classification: entry.accessType === "temporary_or_expiring_access" ? "temporary_or_expiring_access" : "additional",
        effectiveDate: null,
        details: { scopeChanged: false },
      });
    }
    for (const [locationId, entry] of before) {
      if (after.has(locationId) || locationId === previous.primaryLocationId) continue;
      const expired = entry.expiresOn !== null && entry.expiresOn < options.today;
      changes.push({
        externalEmployeeId: id,
        kind: "location_access_removed",
        fieldName: `location:${locationId}`,
        fromValue: affiliationJson(entry),
        toValue: null,
        classification: expired ? "expired" : "removed",
        effectiveDate: expired ? entry.expiresOn : null,
        details: { scopeChanged: false },
      });
    }
  }

  /* ---- email, compared case-insensitively ---- */
  if (
    next.emailAddress !== null &&
    next.emailAddress.toLowerCase() !== (previous.emailAddress ?? "").toLowerCase()
  ) {
    changes.push({
      externalEmployeeId: id,
      kind: "email_changed",
      fieldName: "email_address",
      fromValue: { emailAddress: previous.emailAddress },
      toValue: { emailAddress: next.emailAddress },
      classification: null,
      effectiveDate: null,
      /* An email change never re-points an existing Ask Sunny login. */
      details: { loginLinkChanged: false },
    });
  }

  return changes;
}

/**
 * The change recorded for an employee on file who did not appear in this read.
 *
 * RECORDED ONCE, at the threshold, and never acted on. Absence is not
 * termination: only an explicit terminated status from Woven records one.
 */
export function missingChange(previous: DirectoryRecord): DirectoryChange | null {
  if (previous.missingSyncCount + 1 !== MISSING_THRESHOLD) return null;
  return {
    externalEmployeeId: previous.externalEmployeeId,
    kind: "missing_from_source",
    fieldName: null,
    fromValue: { employmentStatus: previous.employmentStatus },
    toValue: null,
    classification: null,
    effectiveDate: null,
    details: { consecutiveMisses: MISSING_THRESHOLD, statusChanged: false },
  };
}

/**
 * A hash of exactly what the directory stores for an employee, so an unchanged
 * employee is recognised without comparing column by column.
 */
export function recordHash(employee: ResolvedEmployee, issues: readonly EmployeeIssue[]): string {
  const canonical = JSON.stringify([
    employee.externalEmployeeId,
    employee.employeeLoginId,
    employee.externalHrisId,
    employee.firstName,
    employee.lastName,
    employee.preferredFirstName,
    employee.emailAddress,
    employee.employmentStatus,
    employee.employmentStatusCode,
    employee.hireDate,
    employee.startDate,
    employee.terminationDate,
    employee.terminationLastDayWorked,
    employee.terminationTypeCode,
    employee.positionId,
    employee.positionName,
    employee.primaryLocationId,
    employee.primaryLocationName,
    employee.hasMultipleLocationAccess,
    employee.hasAllLocationAccess,
    employee.wovenLoginAllowed,
    employee.affiliations.map((a) => [a.wovenLocationId, a.locationName, a.locationNumber, a.accessType, a.expiresOn]),
    [...issues].sort(),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
