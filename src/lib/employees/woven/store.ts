import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  ACCESS_TYPES,
  EMPLOYMENT_STATUSES,
  SOURCE_SYSTEM,
  type AccessType,
  type DirectoryChange,
  type DirectoryRecord,
  type EmploymentStatus,
  type LocationAffiliation,
  type LocationCatalogEntry,
  type LocationMapEntry,
  type LocationMapStatus,
  type PositionMapEntry,
  type PositionMapStatus,
} from "./types";

/**
 * ============================================================================
 * THE DIRECTORY STORE — the sync's only door into Supabase
 * ============================================================================
 *
 * An interface, so the sync's decisions can be tested against an in-memory
 * store (`memory-store.ts`) without a database, and a Supabase implementation
 * that calls the migration's functions under the secret key.
 *
 * WHAT IT CAN TOUCH. The Woven directory tables and their functions —
 * nothing else. It has no method that reads or writes a login, a role or a
 * scope, and the SQL functions it calls do not either.
 *
 * ONE TRANSACTION PER COMMIT. Every directory write of a run goes through
 * `employee_sync_commit_run`, which applies all of it or none of it.
 *
 * THE PAYLOAD KEYS ARE THE MIGRATION'S. `employeeToRow` produces exactly the
 * columns of `public.employee_sync_incoming`; `store.test.ts` asserts it
 * against the migration file, because `jsonb_populate_recordset` silently
 * IGNORES a key it does not know and NULLS one it is not given.
 */

export type ClaimResult =
  | { status: "claimed"; runId: string }
  | { status: "busy"; runningSince: string | null };

export interface RunStats {
  requestsMade: number;
  pagesFetched: number;
  employeesReceived: number;
  employeesActive: number;
  employeesTerminated: number;
  employeesStatusUnknown: number;
  detailsFetched: number;
  detailsSkipped: number;
  recordsRejected: number;
  issueCounts: Record<string, number>;
}

/** One employee as the commit function receives it. */
export interface EmployeeWrite {
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
  /** The full list when THIS run read it; null keeps what is on file and only asserts the primary. */
  affiliations: LocationAffiliation[] | null;
  issues: string[];
  recordHash: string;
}

export interface CommitLocation extends Partial<Omit<LocationCatalogEntry, "wovenLocationId">> {
  wovenLocationId: string;
}

export interface CommitInput {
  runId: string;
  employees: EmployeeWrite[];
  changes: DirectoryChange[];
  locations: CommitLocation[];
  stats: RunStats;
}

export type CommitResult =
  | { status: "committed"; created: number; updated: number; unchanged: number; missing: number; changes: number }
  | { status: "not_running" | "unknown_run" };

export interface AbandonInput {
  runId: string;
  status: "failed" | "rejected";
  errorCode: string;
  errorDetail: string | null;
  stats: Partial<RunStats>;
}

export interface EmployeeDirectoryStore {
  claimRun(requestedBy: string): Promise<ClaimResult>;
  loadDirectory(): Promise<DirectoryRecord[]>;
  loadLocationMap(): Promise<LocationMapEntry[]>;
  loadPositionMap(): Promise<PositionMapEntry[]>;
  commitRun(input: CommitInput): Promise<CommitResult>;
  abandonRun(input: AbandonInput): Promise<void>;
}

export class EmployeeStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EmployeeStoreError";
    this.code = code;
  }
}

/* ------------------------------------------------------ row conversion -- */

/** The keys of one `employee_location_affiliations` entry in a commit payload. */
export function affiliationToRow(entry: LocationAffiliation): Record<string, unknown> {
  return {
    woven_location_id: entry.wovenLocationId,
    location_name: entry.locationName,
    location_number: entry.locationNumber,
    access_type: entry.accessType,
    expires_on: entry.expiresOn,
  };
}

/** Exactly the columns of `public.employee_sync_incoming`. */
export function employeeToRow(employee: EmployeeWrite): Record<string, unknown> {
  return {
    external_employee_id: employee.externalEmployeeId,
    employee_login_id: employee.employeeLoginId,
    external_hris_id: employee.externalHrisId,
    first_name: employee.firstName,
    last_name: employee.lastName,
    preferred_first_name: employee.preferredFirstName,
    email_address: employee.emailAddress,
    employment_status: employee.employmentStatus,
    employment_status_code: employee.employmentStatusCode,
    hire_date: employee.hireDate,
    start_date: employee.startDate,
    termination_date: employee.terminationDate,
    termination_last_day_worked: employee.terminationLastDayWorked,
    termination_type_code: employee.terminationTypeCode,
    position_id: employee.positionId,
    position_name: employee.positionName,
    primary_woven_location_id: employee.primaryLocationId,
    primary_location_name: employee.primaryLocationName,
    has_multiple_location_access: employee.hasMultipleLocationAccess,
    has_all_location_access: employee.hasAllLocationAccess,
    woven_login_allowed: employee.wovenLoginAllowed,
    affiliations: employee.affiliations === null ? null : employee.affiliations.map(affiliationToRow),
    data_issues: employee.issues,
    record_hash: employee.recordHash,
  };
}

export function changeToRow(change: DirectoryChange): Record<string, unknown> {
  return {
    external_employee_id: change.externalEmployeeId,
    change_kind: change.kind,
    field_name: change.fieldName,
    from_value: change.fromValue,
    to_value: change.toValue,
    classification: change.classification,
    effective_date: change.effectiveDate,
    details: change.details,
  };
}

export function locationToRow(location: CommitLocation): Record<string, unknown> {
  return {
    woven_location_id: location.wovenLocationId,
    woven_location_name: location.name ?? null,
    woven_display_name: location.displayName ?? null,
    woven_location_number: location.number ?? null,
    woven_district_id: location.districtId ?? null,
    woven_district_name: location.districtName ?? null,
    woven_region_id: location.regionId ?? null,
    woven_region_name: location.regionName ?? null,
    is_closed: location.isClosed ?? null,
    is_non_location: location.isNonLocation ?? null,
  };
}

function statsToRow(stats: Partial<RunStats>): Record<string, unknown> {
  return {
    requests_made: stats.requestsMade,
    pages_fetched: stats.pagesFetched,
    employees_received: stats.employeesReceived,
    employees_active: stats.employeesActive,
    employees_terminated: stats.employeesTerminated,
    employees_status_unknown: stats.employeesStatusUnknown,
    details_fetched: stats.detailsFetched,
    details_skipped: stats.detailsSkipped,
    records_rejected: stats.recordsRejected,
    issue_counts: stats.issueCounts ?? {},
  };
}

const DIRECTORY_COLUMNS = [
  "id",
  "external_employee_id",
  "employee_login_id",
  "external_hris_id",
  "first_name",
  "last_name",
  "preferred_first_name",
  "email_address",
  "employment_status",
  "employment_status_code",
  "hire_date",
  "start_date",
  "termination_date",
  "termination_last_day_worked",
  "termination_type_code",
  "position_id",
  "position_name",
  "primary_woven_location_id",
  "primary_location_name",
  "has_multiple_location_access",
  "has_all_location_access",
  "woven_login_allowed",
  "affiliations_verified_at",
  "missing_sync_count",
  "record_hash",
].join(", ");

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const int = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

export function affiliationFromRow(row: Record<string, unknown>): LocationAffiliation | null {
  if (typeof row.woven_location_id !== "string") return null;
  const accessType = (ACCESS_TYPES as readonly string[]).includes(String(row.access_type))
    ? (row.access_type as AccessType)
    : null;
  if (accessType === null) return null;
  return {
    wovenLocationId: row.woven_location_id,
    locationName: str(row.location_name),
    locationNumber: str(row.location_number),
    accessType,
    expiresOn: str(row.expires_on),
  };
}

export function directoryFromRow(row: Record<string, unknown>, affiliations: LocationAffiliation[]): DirectoryRecord {
  const status = (EMPLOYMENT_STATUSES as readonly string[]).includes(String(row.employment_status))
    ? (row.employment_status as EmploymentStatus)
    : "unknown";
  return {
    id: String(row.id),
    externalEmployeeId: String(row.external_employee_id),
    employeeLoginId: str(row.employee_login_id),
    externalHrisId: str(row.external_hris_id),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    preferredFirstName: str(row.preferred_first_name),
    emailAddress: str(row.email_address),
    employmentStatus: status,
    employmentStatusCode: int(row.employment_status_code),
    hireDate: str(row.hire_date),
    startDate: str(row.start_date),
    terminationDate: str(row.termination_date),
    terminationLastDayWorked: str(row.termination_last_day_worked),
    terminationTypeCode: int(row.termination_type_code),
    positionId: str(row.position_id),
    positionName: str(row.position_name),
    primaryLocationId: str(row.primary_woven_location_id),
    primaryLocationName: str(row.primary_location_name),
    hasMultipleLocationAccess: bool(row.has_multiple_location_access),
    hasAllLocationAccess: bool(row.has_all_location_access),
    wovenLoginAllowed: bool(row.woven_login_allowed),
    affiliations,
    affiliationsVerifiedAt: str(row.affiliations_verified_at),
    missingSyncCount: typeof row.missing_sync_count === "number" ? row.missing_sync_count : 0,
    recordHash: String(row.record_hash ?? ""),
  };
}

/* -------------------------------------------------- the Supabase store -- */

const PAGE = 1000;

/**
 * Supabase errors are reported by CODE. Their messages can quote the row that
 * failed a constraint, and a row here is a person.
 */
function storeFailure(operation: string, error: { code?: string } | null): EmployeeStoreError {
  const code = error?.code ? ` (${error.code})` : "";
  return new EmployeeStoreError("store_unavailable", `The employee directory could not ${operation}${code}.`);
}

async function readAll(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
  operation: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw storeFailure(operation, error);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export function createSupabaseDirectoryStore(client?: SupabaseClient): EmployeeDirectoryStore {
  const db = () => client ?? getSupabaseAdmin();

  return {
    async claimRun(requestedBy) {
      const { data, error } = await db().rpc("employee_sync_claim_run", { p_requested_by: requestedBy });
      if (error) throw storeFailure("start a sync run", error);
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.status === "claimed" && typeof result.runId === "string") {
        return { status: "claimed", runId: result.runId };
      }
      if (result.status === "busy") {
        return { status: "busy", runningSince: str(result.runningSince) };
      }
      throw new EmployeeStoreError("store_unexpected", "The sync run could not be claimed.");
    },

    async loadDirectory() {
      const rows = await readAll(
        (from, to) =>
          db()
            .from("employee_access_directory")
            .select(DIRECTORY_COLUMNS)
            .eq("source_system", SOURCE_SYSTEM)
            .order("id", { ascending: true })
            .range(from, to),
        "be read",
      );
      const affiliationRows = await readAll(
        (from, to) =>
          db()
            .from("employee_location_affiliations")
            .select("employee_id, woven_location_id, location_name, location_number, access_type, expires_on")
            .eq("active", true)
            .order("id", { ascending: true })
            .range(from, to),
        "read location access",
      );
      const byEmployee = new Map<string, LocationAffiliation[]>();
      for (const row of affiliationRows) {
        const entry = affiliationFromRow(row);
        if (!entry) continue;
        const key = String(row.employee_id);
        const list = byEmployee.get(key) ?? [];
        list.push(entry);
        byEmployee.set(key, list);
      }
      return rows.map((row) => directoryFromRow(row, byEmployee.get(String(row.id)) ?? []));
    },

    async loadLocationMap() {
      const { data, error } = await db().from("woven_location_map").select("woven_location_id, status, salon_id");
      if (error) throw storeFailure("read the Woven location map", error);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        wovenLocationId: String(row.woven_location_id),
        status: (["unmapped", "mapped", "ignored"].includes(String(row.status))
          ? row.status
          : "unmapped") as LocationMapStatus,
        salonId: str(row.salon_id),
      }));
    },

    async loadPositionMap() {
      const { data, error } = await db()
        .from("woven_position_map")
        .select("woven_position_id, status, is_confirmed, hierarchy_rank");
      if (error) throw storeFailure("read the Woven position map", error);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        wovenPositionId: String(row.woven_position_id),
        status: (["unmapped", "mapped", "ignored"].includes(String(row.status))
          ? row.status
          : "unmapped") as PositionMapStatus,
        isConfirmed: row.is_confirmed === true,
        hierarchyRank: int(row.hierarchy_rank),
      }));
    },

    async commitRun(input) {
      const { data, error } = await db().rpc("employee_sync_commit_run", {
        p_run_id: input.runId,
        p_employees: input.employees.map(employeeToRow),
        p_changes: input.changes.map(changeToRow),
        p_locations: input.locations.map(locationToRow),
        p_stats: statsToRow(input.stats),
      });
      if (error) throw storeFailure("save this sync", error);
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.status === "committed") {
        const n = (v: unknown) => (typeof v === "number" ? v : 0);
        return {
          status: "committed",
          created: n(result.created),
          updated: n(result.updated),
          unchanged: n(result.unchanged),
          missing: n(result.missing),
          changes: n(result.changes),
        };
      }
      return { status: result.status === "unknown_run" ? "unknown_run" : "not_running" };
    },

    async abandonRun(input) {
      const { error } = await db().rpc("employee_sync_abandon_run", {
        p_run_id: input.runId,
        p_status: input.status,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
        p_stats: statsToRow(input.stats),
      });
      if (error) throw storeFailure("record the failed sync", error);
    },
  };
}
