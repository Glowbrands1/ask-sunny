/**
 * ============================================================================
 * THE EMPLOYEE DIRECTORY'S TYPES — what Ask Sunny keeps about a Woven employee
 * ============================================================================
 *
 * Everything here is the ALLOWLIST, expressed as a type. There is no field for
 * pay, date of birth, a phone, an address, an emergency contact, a background
 * check, a note, a document, a termination reason or a rehire decision, so
 * there is nowhere for one to land. `normalize.ts` builds these objects field
 * by field from named source keys; it never spreads a Woven record.
 *
 * PHASE ONE IS OBSERVATION ONLY. Nothing typed here is read by the permission
 * matrix, Supabase Auth or any scope resolver. A position or location change is
 * RECORDED; it does not grant or remove access.
 */

export const SOURCE_SYSTEM = "woven" as const;
export type SourceSystem = typeof SOURCE_SYSTEM;

/**
 * `unknown` is a real state, not a placeholder. A Woven `Status` integer that
 * `/lists/enums` does not resolve to Active or Terminated (a leave, a
 * suspension, a value nobody has seen yet) is `unknown` and NEVER treated as a
 * termination.
 */
export type EmploymentStatus = "active" | "terminated" | "unknown";

export const EMPLOYMENT_STATUSES = ["active", "terminated", "unknown"] as const satisfies readonly EmploymentStatus[];

/**
 * How an employee is attached to a location.
 *
 *   primary                       equals the employee's `PrimaryLocationID`
 *   additional                    any other location, with no `ExpiresOn`
 *   temporary_or_expiring_access  a location carrying an `ExpiresOn`. NOT
 *                                 called "borrowed": Woven's borrow feature
 *                                 sets an ExpiresOn, but the spec does not say
 *                                 every ExpiresOn is a borrow.
 */
export type AccessType = "primary" | "additional" | "temporary_or_expiring_access";

export const ACCESS_TYPES = ["primary", "additional", "temporary_or_expiring_access"] as const satisfies readonly AccessType[];

export interface LocationAffiliation {
  wovenLocationId: string;
  locationName: string | null;
  locationNumber: string | null;
  accessType: AccessType;
  /** YYYY-MM-DD, when Woven states one. */
  expiresOn: string | null;
}

/**
 * Data-quality codes stored on a directory row. Codes, never text — a code
 * cannot quote a person's details back into a log or a dashboard.
 */
export type EmployeeIssue =
  | "missing_email"
  | "invalid_email"
  | "duplicate_email"
  | "missing_position_id"
  | "missing_primary_location"
  | "unmapped_location"
  | "unmapped_position"
  | "unknown_status"
  | "status_termination_conflict"
  | "vendor_employee"
  | "affiliations_not_verified"
  /* Woven's Status for this EmployeeID differed between reads; a Terminated read won. */
  | "status_differs_between_reads"
  /* Woven's terminated-status filter returned this employee, but its own Status is not Terminated. */
  | "terminated_filter_lists_active"
  /* Per-read status evidence (status-evidence.ts): `status_read_<read>_<status>`, and why details gave none. */
  | `status_read_${string}_${EmploymentStatus}`
  | "status_read_terminated_status_not_returned"
  | "status_read_details_not_found"
  | "status_read_details_no_status";

export const EMPLOYEE_ISSUES = [
  "missing_email",
  "invalid_email",
  "duplicate_email",
  "missing_position_id",
  "missing_primary_location",
  "unmapped_location",
  "unmapped_position",
  "unknown_status",
  "status_termination_conflict",
  "vendor_employee",
  "affiliations_not_verified",
  "status_differs_between_reads",
  "terminated_filter_lists_active",
] as const satisfies readonly EmployeeIssue[];

/**
 * Where an employee's affiliation list came from THIS run.
 *
 *   details    `Locations[]` from `/employees/{id}/details` — a full read
 *   list_flag  the list row said `HasMultipleLocationAccess: false`, so the
 *              primary is the whole list
 *   null       not known this run; what is on file is kept
 */
export type AffiliationSource = "details" | "list_flag" | null;

/** One employee as normalised from Woven, before it is compared with the directory. */
export interface NormalizedEmployee {
  externalEmployeeId: string;
  employeeLoginId: string | null;
  externalHrisId: string | null;
  firstName: string | null;
  lastName: string | null;
  preferredFirstName: string | null;
  /** Woven `EmailAddress`, trimmed and otherwise as provided. May be personal. */
  emailAddress: string | null;
  employmentStatus: EmploymentStatus;
  /** Woven's raw `Status` integer. */
  employmentStatusCode: number | null;
  hireDate: string | null;
  startDate: string | null;
  terminationDate: string | null;
  terminationLastDayWorked: string | null;
  terminationTypeCode: number | null;
  positionId: string | null;
  positionName: string | null;
  primaryLocationId: string | null;
  primaryLocationName: string | null;
  hasMultipleLocationAccess: boolean | null;
  hasAllLocationAccess: boolean | null;
  wovenLoginAllowed: boolean | null;
  /** NULL MEANS "NOT KNOWN THIS RUN", which is different from "none". */
  affiliations: LocationAffiliation[] | null;
  affiliationSource: AffiliationSource;
  issues: EmployeeIssue[];
}

/** One row of `employee_access_directory`, as the sync reads it back, with its ACTIVE affiliations. */
export interface DirectoryRecord {
  id: string;
  externalEmployeeId: string;
  employeeLoginId: string | null;
  externalHrisId: string | null;
  firstName: string | null;
  lastName: string | null;
  preferredFirstName: string | null;
  emailAddress: string | null;
  employmentStatus: EmploymentStatus;
  employmentStatusCode: number | null;
  hireDate: string | null;
  startDate: string | null;
  terminationDate: string | null;
  terminationLastDayWorked: string | null;
  terminationTypeCode: number | null;
  positionId: string | null;
  positionName: string | null;
  primaryLocationId: string | null;
  primaryLocationName: string | null;
  hasMultipleLocationAccess: boolean | null;
  hasAllLocationAccess: boolean | null;
  wovenLoginAllowed: boolean | null;
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
  | "location_access_added"
  | "location_access_removed"
  | "email_changed"
  | "missing_from_source";

export const CHANGE_KINDS = [
  "new_employee",
  "terminated",
  "reactivated",
  "position_changed",
  "primary_location_changed",
  "location_access_added",
  "location_access_removed",
  "email_changed",
  "missing_from_source",
] as const satisfies readonly ChangeKind[];

/**
 * The classification codes a change may carry. A position change is
 * `unclassified` unless BOTH positions are confirmed in the position map with
 * ranks — only then `promotion_confirmed`, `demotion_confirmed` or `lateral`.
 */
export type ChangeClassification =
  | "initial_load"
  | "new_hire"
  | "newly_visible"
  | "rehire"
  | "unclassified"
  | "promotion_confirmed"
  | "demotion_confirmed"
  | "lateral"
  | "transfer"
  | "assigned"
  | "additional"
  | "temporary_or_expiring_access"
  | "expired"
  | "removed";

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
  /** The directory column, or `location:<woven id>`, the change is about. */
  fieldName: string | null;
  fromValue: JsonValue;
  toValue: JsonValue;
  classification: ChangeClassification | null;
  /** Only a date Woven itself states. Never invented. */
  effectiveDate: string | null;
  details: { [key: string]: JsonValue };
}

/** A row of `woven_location_map`, as far as the sync needs it. */
export type LocationMapStatus = "unmapped" | "mapped" | "ignored";

export interface LocationMapEntry {
  wovenLocationId: string;
  status: LocationMapStatus;
  salonId: string | null;
}

/** A row of `woven_position_map`, as far as the sync needs it: labels, never access. */
export type PositionMapStatus = "unmapped" | "mapped" | "ignored";

export interface PositionMapEntry {
  wovenPositionId: string;
  status: PositionMapStatus;
  isConfirmed: boolean;
  hierarchyRank: number | null;
}

/** One Woven location from `GET /locations`, for the location map's catalog columns. */
export interface LocationCatalogEntry {
  wovenLocationId: string;
  name: string | null;
  displayName: string | null;
  number: string | null;
  districtId: string | null;
  districtName: string | null;
  regionId: string | null;
  regionName: string | null;
  isClosed: boolean | null;
  isNonLocation: boolean | null;
}
