/**
 * ============================================================================
 * THE EMPLOYEE DIRECTORY'S TYPES — what Ask Sunny keeps about a Woven employee
 * ============================================================================
 *
 * Everything here is the ALLOWLIST, expressed as a type. There is no field for
 * pay, date of birth, a personal phone, an address, an emergency contact, a
 * background check, a note or a document, so there is nowhere for one to land.
 * `normalize.ts` builds these objects field by field from named source keys; it
 * never spreads a Woven record, so an unexpected field cannot ride along.
 *
 * PHASE ONE IS OBSERVATION ONLY. Nothing typed here is read by the permission
 * matrix, `app_users`, Supabase Auth or any scope resolver. A position or
 * location change is RECORDED; it does not grant or remove access.
 */

export const SOURCE_SYSTEM = "woven" as const;
export type SourceSystem = typeof SOURCE_SYSTEM;

/**
 * `unknown` is a real state, not a placeholder. A status Woven reports that is
 * neither active nor terminated (a leave, a suspension, a value nobody has
 * seen yet) is stored as `unknown` and NEVER treated as a termination.
 */
export type EmploymentStatus = "active" | "terminated" | "unknown";

export const EMPLOYMENT_STATUSES = ["active", "terminated", "unknown"] as const satisfies readonly EmploymentStatus[];

/**
 * How an employee is attached to a location.
 *
 *   primary     their home salon (`PrimaryLocationID`)
 *   additional  a standing affiliation — they can see or work another salon
 *   temporary   a borrowed / time-boxed affiliation (an expiry, or Woven
 *               marking it as borrowing)
 */
export type AffiliationKind = "primary" | "additional" | "temporary";

export interface LocationAffiliation {
  wovenLocationId: string;
  locationName: string | null;
  kind: AffiliationKind;
  /** YYYY-MM-DD, when Woven states one. */
  startsOn: string | null;
  /** YYYY-MM-DD, when Woven states one. A temporary affiliation's end. */
  expiresOn: string | null;
}

/**
 * Data-quality codes stored on a directory row. Codes, never text — a code
 * cannot quote a person's details back into a log or a dashboard.
 */
export type EmployeeIssue =
  | "missing_work_email"
  | "invalid_work_email"
  | "work_email_not_approved_domain"
  | "duplicate_work_email"
  | "missing_position_id"
  | "missing_primary_location"
  | "unmapped_location"
  | "unknown_status"
  | "affiliations_not_verified";

export const EMPLOYEE_ISSUES = [
  "missing_work_email",
  "invalid_work_email",
  "work_email_not_approved_domain",
  "duplicate_work_email",
  "missing_position_id",
  "missing_primary_location",
  "unmapped_location",
  "unknown_status",
  "affiliations_not_verified",
] as const satisfies readonly EmployeeIssue[];

/** One employee as normalised from Woven, before it is compared with the directory. */
export interface NormalizedEmployee {
  externalEmployeeId: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  workEmail: string | null;
  employmentStatus: EmploymentStatus;
  hireDate: string | null;
  terminationDate: string | null;
  positionId: string | null;
  positionName: string | null;
  primaryLocationId: string | null;
  primaryLocationName: string | null;
  /**
   * NULL MEANS "NOT KNOWN THIS RUN", which is different from "none".
   *
   * The list endpoint gives the primary location and, at most, a flag saying
   * there are more. The full affiliation list needs a details call per
   * employee, and the per-run budget may not reach everyone. An employee whose
   * affiliations were not read this run keeps the ones already on file, and no
   * affiliation is ever reported as REMOVED on the strength of a read that did
   * not happen.
   */
  affiliations: LocationAffiliation[] | null;
  /**
   * Whether the list row said this employee has more than one location.
   * `null` when Woven did not say either way — in which case only a details
   * read can settle it.
   */
  hasMultipleLocations: boolean | null;
  sourceUpdatedAt: string | null;
  issues: EmployeeIssue[];
}

/** One row of `employee_access_directory`, as the sync reads it back. */
export interface DirectoryRecord {
  id: string;
  externalEmployeeId: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  workEmail: string | null;
  employmentStatus: EmploymentStatus;
  hireDate: string | null;
  terminationDate: string | null;
  positionId: string | null;
  positionName: string | null;
  primaryLocationId: string | null;
  primaryLocationName: string | null;
  affiliations: LocationAffiliation[];
  affiliationsVerifiedAt: string | null;
  missingSyncCount: number;
  recordHash: string;
}

export type ChangeKind =
  | "new_employee"
  | "terminated"
  | "reactivated"
  | "position_changed"
  | "primary_location_changed"
  | "location_affiliation_added"
  | "location_affiliation_removed"
  | "work_email_changed"
  | "missing_from_source";

export const CHANGE_KINDS = [
  "new_employee",
  "terminated",
  "reactivated",
  "position_changed",
  "primary_location_changed",
  "location_affiliation_added",
  "location_affiliation_removed",
  "work_email_changed",
  "missing_from_source",
] as const satisfies readonly ChangeKind[];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** One detected change, ready for `employee_directory_changes`. */
export interface DirectoryChange {
  externalEmployeeId: string;
  kind: ChangeKind;
  fromValue: JsonValue;
  toValue: JsonValue;
  details: { [key: string]: JsonValue };
}

/** A row of `woven_location_map`, as far as the sync needs it. */
export type LocationMapStatus = "unmapped" | "mapped" | "ignored";

export interface LocationMapEntry {
  wovenLocationId: string;
  status: LocationMapStatus;
  salonId: string | null;
}
