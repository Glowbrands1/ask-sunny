import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  EMPLOYMENT_STATUSES,
  SOURCE_SYSTEM,
  type DirectoryChange,
  type DirectoryRecord,
  type EmploymentStatus,
  type LocationAffiliation,
  type LocationMapEntry,
  type LocationMapStatus,
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
 * WHAT IT CAN TOUCH. `employee_access_directory`, `employee_directory_changes`,
 * `employee_sync_runs` and `woven_location_map` — nothing else. It has no
 * method that reads or writes `app_users`, `auth.users`, a role or a scope,
 * and the SQL functions it calls do not either.
 *
 * ONE TRANSACTION PER COMMIT. Every directory write of a run goes through
 * `employee_sync_commit_run`, which applies all of it or none of it. A failed
 * run therefore leaves the directory exactly as the last good run left it.
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
  employeesUnchanged: number;
  detailsFetched: number;
  detailsSkipped: number;
  unmappedLocations: number;
  recordsRejected: number;
  issueCounts: Record<string, number>;
}

/** One employee as the commit function receives it. */
export interface EmployeeWrite {
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
  affiliationsVerified: boolean;
  sourceUpdatedAt: string | null;
  issues: string[];
  recordHash: string;
}

export interface CommitInput {
  runId: string;
  employees: EmployeeWrite[];
  changes: DirectoryChange[];
  locations: { wovenLocationId: string; name: string | null }[];
  stats: RunStats;
}

export type CommitResult =
  | { status: "committed"; created: number; updated: number; missing: number; changes: number }
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

interface AffiliationRow {
  woven_location_id: string;
  location_name: string | null;
  kind: LocationAffiliation["kind"];
  starts_on: string | null;
  expires_on: string | null;
}

export function affiliationToRow(entry: LocationAffiliation): AffiliationRow {
  return {
    woven_location_id: entry.wovenLocationId,
    location_name: entry.locationName,
    kind: entry.kind,
    starts_on: entry.startsOn,
    expires_on: entry.expiresOn,
  };
}

function affiliationFromRow(row: unknown): LocationAffiliation | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.woven_location_id !== "string") return null;
  const kind = r.kind === "primary" || r.kind === "additional" || r.kind === "temporary" ? r.kind : null;
  if (kind === null) return null;
  return {
    wovenLocationId: r.woven_location_id,
    locationName: typeof r.location_name === "string" ? r.location_name : null,
    kind,
    startsOn: typeof r.starts_on === "string" ? r.starts_on : null,
    expiresOn: typeof r.expires_on === "string" ? r.expires_on : null,
  };
}

export function employeeToRow(employee: EmployeeWrite): Record<string, unknown> {
  return {
    external_employee_id: employee.externalEmployeeId,
    first_name: employee.firstName,
    last_name: employee.lastName,
    preferred_name: employee.preferredName,
    work_email: employee.workEmail,
    employment_status: employee.employmentStatus,
    hire_date: employee.hireDate,
    termination_date: employee.terminationDate,
    position_id: employee.positionId,
    position_name: employee.positionName,
    primary_woven_location_id: employee.primaryLocationId,
    primary_location_name: employee.primaryLocationName,
    woven_location_ids: employee.affiliations.map((a) => a.wovenLocationId),
    location_affiliations: employee.affiliations.map(affiliationToRow),
    affiliations_verified: employee.affiliationsVerified,
    source_updated_at: employee.sourceUpdatedAt,
    data_issues: employee.issues,
    record_hash: employee.recordHash,
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
    employees_unchanged: stats.employeesUnchanged,
    details_fetched: stats.detailsFetched,
    details_skipped: stats.detailsSkipped,
    unmapped_locations: stats.unmappedLocations,
    records_rejected: stats.recordsRejected,
    issue_counts: stats.issueCounts ?? {},
  };
}

const DIRECTORY_COLUMNS = [
  "id",
  "external_employee_id",
  "first_name",
  "last_name",
  "preferred_name",
  "work_email",
  "employment_status",
  "hire_date",
  "termination_date",
  "position_id",
  "position_name",
  "primary_woven_location_id",
  "primary_location_name",
  "location_affiliations",
  "affiliations_verified_at",
  "missing_sync_count",
  "record_hash",
].join(", ");

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function directoryFromRow(row: Record<string, unknown>): DirectoryRecord {
  const status = (EMPLOYMENT_STATUSES as readonly string[]).includes(String(row.employment_status))
    ? (row.employment_status as EmploymentStatus)
    : "unknown";
  const affiliations = Array.isArray(row.location_affiliations)
    ? row.location_affiliations.map(affiliationFromRow).filter((a): a is LocationAffiliation => a !== null)
    : [];
  return {
    id: String(row.id),
    externalEmployeeId: String(row.external_employee_id),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    preferredName: str(row.preferred_name),
    workEmail: str(row.work_email),
    employmentStatus: status,
    hireDate: str(row.hire_date),
    terminationDate: str(row.termination_date),
    positionId: str(row.position_id),
    positionName: str(row.position_name),
    primaryLocationId: str(row.primary_woven_location_id),
    primaryLocationName: str(row.primary_location_name),
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
      const rows: DirectoryRecord[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db()
          .from("employee_access_directory")
          .select(DIRECTORY_COLUMNS)
          .eq("source_system", SOURCE_SYSTEM)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw storeFailure("be read", error);
        const page = (data ?? []) as unknown as Record<string, unknown>[];
        rows.push(...page.map(directoryFromRow));
        if (page.length < PAGE) break;
      }
      return rows;
    },

    async loadLocationMap() {
      const { data, error } = await db()
        .from("woven_location_map")
        .select("woven_location_id, status, salon_id");
      if (error) throw storeFailure("read the Woven location map", error);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        wovenLocationId: String(row.woven_location_id),
        status: (["unmapped", "mapped", "ignored"].includes(String(row.status))
          ? row.status
          : "unmapped") as LocationMapStatus,
        salonId: str(row.salon_id),
      }));
    },

    async commitRun(input) {
      const { data, error } = await db().rpc("employee_sync_commit_run", {
        p_run_id: input.runId,
        p_employees: input.employees.map(employeeToRow),
        p_changes: input.changes.map((change) => ({
          external_employee_id: change.externalEmployeeId,
          change_kind: change.kind,
          from_value: change.fromValue,
          to_value: change.toValue,
          details: change.details,
        })),
        p_locations: input.locations.map((l) => ({ woven_location_id: l.wovenLocationId, woven_location_name: l.name })),
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
