import { createHash } from "node:crypto";

import type {
  DirectoryChange,
  DirectoryRecord,
  EmployeeIssue,
  JsonValue,
  LocationAffiliation,
  NormalizedEmployee,
} from "./types";

/**
 * ============================================================================
 * CHANGE DETECTION — what moved between the directory on file and this read
 * ============================================================================
 *
 * PURE. No clock, no database, no network: the same two inputs always give the
 * same changes, which is what makes a re-run of an unchanged read record
 * nothing at all.
 *
 * WHAT A CHANGE IS NOT:
 *
 *   NOT A PROMOTION. A new PositionID is recorded as `position_changed` with
 *   `direction: "unclassified"`. Calling it a promotion or a demotion needs an
 *   approved position hierarchy, and none exists yet. When one does, it can
 *   classify these rows after the fact; guessing now would put a claim about a
 *   person's career into an audit trail that nobody approved.
 *
 *   NOT MISSING DATA. A PositionID or location that is simply absent from this
 *   read is a data-quality issue on the row, not a change — an employee does
 *   not "lose" their position because one response left the field blank.
 *
 *   NOT A REMOVAL THAT WAS NEVER READ. Affiliation additions and removals are
 *   only compared when this run actually read the employee's full list.
 *
 *   NOT AN ACCESS DECISION. Nothing here, or downstream of it in phase one,
 *   changes a role, a scope, a salon assignment or a login.
 */

/** An employee after the details step: affiliations settled, one way or the other. */
export interface ResolvedEmployee extends Omit<NormalizedEmployee, "affiliations"> {
  affiliations: LocationAffiliation[];
  /** True only when THIS run read the full affiliation list. */
  affiliationsVerified: boolean;
}

/** How many consecutive absences before `missing_from_source` is recorded. */
export const MISSING_THRESHOLD = 3;

function affiliationKey(entry: LocationAffiliation): string {
  return `${entry.wovenLocationId}|${entry.kind}`;
}

function affiliationJson(entry: LocationAffiliation): JsonValue {
  return {
    wovenLocationId: entry.wovenLocationId,
    locationName: entry.locationName,
    kind: entry.kind,
    startsOn: entry.startsOn,
    expiresOn: entry.expiresOn,
  };
}

export function diffEmployee(
  previous: DirectoryRecord | undefined,
  next: ResolvedEmployee,
  options: { initialLoad: boolean },
): DirectoryChange[] {
  const id = next.externalEmployeeId;

  if (!previous) {
    return [
      {
        externalEmployeeId: id,
        kind: "new_employee",
        fromValue: null,
        toValue: {
          employmentStatus: next.employmentStatus,
          positionId: next.positionId,
          positionName: next.positionName,
          primaryLocationId: next.primaryLocationId,
        },
        /*
         * `initialLoad` marks the first sync's rows, so "everybody is new" on day
         * one is not mistaken for a hiring wave in any later report.
         */
        details: { initialLoad: options.initialLoad },
      },
    ];
  }

  const changes: DirectoryChange[] = [];

  /* ---- employment status ---- */
  if (next.employmentStatus === "terminated" && previous.employmentStatus !== "terminated") {
    changes.push({
      externalEmployeeId: id,
      kind: "terminated",
      fromValue: { employmentStatus: previous.employmentStatus, terminationDate: previous.terminationDate },
      toValue: { employmentStatus: next.employmentStatus, terminationDate: next.terminationDate },
      /* Recorded only. Disabling an Ask Sunny login is a separate, unapproved decision. */
      details: { accessChanged: false },
    });
  } else if (next.employmentStatus === "active" && previous.employmentStatus === "terminated") {
    changes.push({
      externalEmployeeId: id,
      kind: "reactivated",
      fromValue: { employmentStatus: previous.employmentStatus, terminationDate: previous.terminationDate },
      toValue: { employmentStatus: next.employmentStatus, hireDate: next.hireDate },
      details: { accessChanged: false },
    });
  }

  /* ---- position ---- */
  if (next.positionId !== null && next.positionId !== previous.positionId) {
    changes.push({
      externalEmployeeId: id,
      kind: "position_changed",
      fromValue: { positionId: previous.positionId, positionName: previous.positionName },
      toValue: { positionId: next.positionId, positionName: next.positionName },
      details: { direction: "unclassified" },
    });
  }

  /* ---- primary location ---- */
  if (next.primaryLocationId !== null && next.primaryLocationId !== previous.primaryLocationId) {
    changes.push({
      externalEmployeeId: id,
      kind: "primary_location_changed",
      fromValue: { primaryLocationId: previous.primaryLocationId, primaryLocationName: previous.primaryLocationName },
      toValue: { primaryLocationId: next.primaryLocationId, primaryLocationName: next.primaryLocationName },
      details: { classification: previous.primaryLocationId === null ? "assigned" : "transfer" },
    });
  }

  /* ---- other affiliations, only when this run read them ---- */
  if (next.affiliationsVerified) {
    const before = new Map(
      previous.affiliations.filter((a) => a.kind !== "primary").map((a) => [affiliationKey(a), a]),
    );
    const after = new Map(
      next.affiliations.filter((a) => a.kind !== "primary").map((a) => [affiliationKey(a), a]),
    );

    for (const [key, entry] of after) {
      if (!before.has(key)) {
        changes.push({
          externalEmployeeId: id,
          kind: "location_affiliation_added",
          fromValue: null,
          toValue: affiliationJson(entry),
          details: { temporary: entry.kind === "temporary" },
        });
      }
    }
    for (const [key, entry] of before) {
      if (!after.has(key)) {
        changes.push({
          externalEmployeeId: id,
          kind: "location_affiliation_removed",
          fromValue: affiliationJson(entry),
          toValue: null,
          details: { temporary: entry.kind === "temporary" },
        });
      }
    }
  }

  /* ---- work email ---- */
  if (next.workEmail !== null && next.workEmail !== previous.workEmail) {
    changes.push({
      externalEmployeeId: id,
      kind: "work_email_changed",
      fromValue: { workEmail: previous.workEmail },
      toValue: { workEmail: next.workEmail },
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
 * termination: a filter, a page or a Woven-side glitch can drop somebody from
 * one response. The row is kept, its status is left alone, and its miss count
 * goes up; only an explicit terminated status from Woven records a termination.
 */
export function missingChange(previous: DirectoryRecord): DirectoryChange | null {
  if (previous.missingSyncCount + 1 !== MISSING_THRESHOLD) return null;
  return {
    externalEmployeeId: previous.externalEmployeeId,
    kind: "missing_from_source",
    fromValue: { employmentStatus: previous.employmentStatus },
    toValue: null,
    details: { consecutiveMisses: MISSING_THRESHOLD, statusChanged: false },
  };
}

/**
 * A hash of exactly what the directory stores for an employee, so an unchanged
 * employee is recognised without comparing column by column. Built from the
 * allowlisted fields only.
 */
export function recordHash(employee: ResolvedEmployee, issues: readonly EmployeeIssue[]): string {
  const canonical = JSON.stringify([
    employee.externalEmployeeId,
    employee.firstName,
    employee.lastName,
    employee.preferredName,
    employee.workEmail,
    employee.employmentStatus,
    employee.hireDate,
    employee.terminationDate,
    employee.positionId,
    employee.positionName,
    employee.primaryLocationId,
    employee.primaryLocationName,
    employee.affiliations.map((a) => [a.wovenLocationId, a.locationName, a.kind, a.startsOn, a.expiresOn]),
    employee.sourceUpdatedAt,
    [...issues].sort(),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
