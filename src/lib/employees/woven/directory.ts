import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { classifyStatusError } from "./status";
import { EmployeeStoreError } from "./store";
import { CHANGE_KINDS, EMPLOYMENT_STATUSES, type ChangeKind, type EmploymentStatus, type LocationMapStatus, type PositionMapStatus } from "./types";
import type {
  ChangePage,
  ChangeQuery,
  ChangeRow,
  DirectoryLocation,
  DirectoryRow,
  ReviewStatus,
  RunRow,
} from "./view-types";
import { CHANGE_PAGE_SIZE, emptyKindCounts, employeeName } from "./views";

/**
 * ============================================================================
 * THE DIRECTORY, CHANGE FEED AND SYNC HISTORY — read from the migration's views
 * ============================================================================
 *
 * SERVER ONLY, UNDER THE SECRET KEY. Every Woven table and view is revoked from
 * `anon` and `authenticated`, so nothing here is reachable from a browser; the
 * pages and routes that call it check `manage_integrations` AND `manage_users`
 * first, because these rows carry names and email addresses.
 *
 * READ-ONLY, WITH ONE EXCEPTION: a person marking a change as acknowledged or
 * dismissed. That writes the three review columns the append-only trigger
 * allows, and nothing else.
 */

const PAGE = 1000;


const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0) || 0);

function locationsFrom(value: unknown): DirectoryLocation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .map((v) => ({
      wovenLocationId: String(v.wovenLocationId ?? ""),
      name: str(v.name),
      number: str(v.number),
      expiresOn: str(v.expiresOn),
    }))
    .filter((l) => l.wovenLocationId.length > 0);
}

export function directoryRowFromView(row: Record<string, unknown>): DirectoryRow {
  const status = (EMPLOYMENT_STATUSES as readonly string[]).includes(String(row.employment_status))
    ? (row.employment_status as EmploymentStatus)
    : "unknown";
  const positionStatus = ["unmapped", "mapped", "ignored"].includes(String(row.position_mapping_status))
    ? (row.position_mapping_status as PositionMapStatus)
    : null;
  const lastKind = (CHANGE_KINDS as readonly string[]).includes(String(row.last_change_kind))
    ? (row.last_change_kind as ChangeKind)
    : null;
  return {
    id: String(row.id),
    externalEmployeeId: String(row.external_employee_id),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    preferredFirstName: str(row.preferred_first_name),
    emailAddress: str(row.email_address),
    employmentStatus: status,
    positionId: str(row.position_id),
    positionName: str(row.position_name),
    positionMappingStatus: positionStatus,
    primaryLocationId: str(row.primary_woven_location_id),
    primaryLocationName: str(row.primary_location_name),
    primaryLocationMappingStatus: ["unmapped", "mapped", "ignored"].includes(String(row.primary_location_mapping_status))
      ? (row.primary_location_mapping_status as LocationMapStatus)
      : null,
    primarySalonNumber: str(row.primary_salon_number),
    additionalLocations: locationsFrom(row.additional_locations),
    temporaryOrExpiringLocations: locationsFrom(row.temporary_or_expiring_locations),
    activeLocationCount: num(row.active_location_count),
    hasUnmappedLocation: row.has_unmapped_location === true,
    hasMultipleLocationAccess: typeof row.has_multiple_location_access === "boolean" ? row.has_multiple_location_access : null,
    hasAllLocationAccess: typeof row.has_all_location_access === "boolean" ? row.has_all_location_access : null,
    hireDate: str(row.hire_date),
    terminationDate: str(row.termination_date),
    dataIssues: Array.isArray(row.data_issues) ? row.data_issues.map(String) : [],
    missingSyncCount: num(row.missing_sync_count),
    lastSeenAt: String(row.last_seen_at ?? ""),
    lastSyncedAt: String(row.last_synced_at ?? ""),
    lastChangeKind: lastKind,
    lastChangeClassification: str(row.last_change_classification),
    lastChangeAt: str(row.last_change_at),
    recentChangeKinds: Array.isArray(row.changes_last_30_days) ? row.changes_last_30_days.map(String) : [],
  };
}

/** Every directory row. A salon estate is hundreds of people, so the tab filters in memory with `views.ts`. */
export async function loadDirectoryRows(): Promise<DirectoryRow[]> {
  const db = getSupabaseAdmin();
  const rows: DirectoryRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("employee_directory_view")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw classifyStatusError(error);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page.map(directoryRowFromView));
    if (page.length < PAGE) break;
  }
  return rows;
}

export function changeRowFromTable(row: Record<string, unknown>): ChangeRow {
  const employee = (Array.isArray(row.employee_access_directory) ? row.employee_access_directory[0] : row.employee_access_directory) as
    | Record<string, unknown>
    | null
    | undefined;
  const review = ["unreviewed", "acknowledged", "dismissed"].includes(String(row.review_status))
    ? (row.review_status as ReviewStatus)
    : "unreviewed";
  return {
    id: String(row.id),
    employeeName: employee
      ? employeeName({
          firstName: str(employee.first_name),
          lastName: str(employee.last_name),
          preferredFirstName: str(employee.preferred_first_name),
        })
      : "(unknown employee)",
    externalEmployeeId: employee ? String(employee.external_employee_id ?? "") : "",
    kind: row.change_kind as ChangeKind,
    fieldName: str(row.field_name),
    classification: str(row.classification),
    fromValue: row.from_value ?? null,
    toValue: row.to_value ?? null,
    effectiveDate: str(row.effective_date),
    detectedAt: String(row.detected_at ?? ""),
    syncRunId: String(row.sync_run_id ?? ""),
    reviewStatus: review,
  };
}

/** The change feed, filtered and paged in the database; counts per kind for the chips. */
export async function loadChangePage(query: ChangeQuery): Promise<ChangePage> {
  const db = getSupabaseAdmin();
  const from = (query.page - 1) * CHANGE_PAGE_SIZE;
  let request = db
    .from("employee_directory_changes")
    .select(
      "id, change_kind, field_name, classification, from_value, to_value, effective_date, detected_at, sync_run_id, review_status, employee_access_directory(external_employee_id, first_name, last_name, preferred_first_name)",
      { count: "exact" },
    )
    .order("detected_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + CHANGE_PAGE_SIZE - 1);
  if (query.kind) request = request.eq("change_kind", query.kind);
  if (query.review) request = request.eq("review_status", query.review);

  const [{ data, error, count }, ...kindResults] = await Promise.all([
    request,
    ...CHANGE_KINDS.map((kind) =>
      db.from("employee_directory_changes").select("id", { count: "exact", head: true }).eq("change_kind", kind),
    ),
  ]);
  const failed = error ?? kindResults.find((r) => r.error)?.error;
  if (failed) throw classifyStatusError(failed);

  const kindCounts = emptyKindCounts();
  CHANGE_KINDS.forEach((kind, i) => (kindCounts[kind] = kindResults[i].count ?? 0));
  return {
    rows: ((data ?? []) as Record<string, unknown>[]).map(changeRowFromTable),
    total: count ?? 0,
    page: query.page,
    pageSize: CHANGE_PAGE_SIZE,
    kindCounts,
  };
}

export function runRowFromView(row: Record<string, unknown>): RunRow {
  const status = ["running", "succeeded", "failed", "rejected"].includes(String(row.status))
    ? (row.status as RunRow["status"])
    : "failed";
  const mode = ["scheduled_poll", "manual_poll", "webhook"].includes(String(row.source_mode))
    ? (row.source_mode as RunRow["sourceMode"])
    : "manual_poll";
  return {
    id: String(row.id),
    startedAt: String(row.started_at ?? ""),
    finishedAt: str(row.finished_at),
    status,
    sourceMode: mode,
    employeesFetched: num(row.employees_fetched),
    employeesAdded: num(row.employees_added),
    employeesUpdated: num(row.employees_updated),
    newHires: num(row.new_hires),
    terminations: num(row.terminations),
    positionChanges: num(row.position_changes),
    confirmedPromotionsDemotions: num(row.confirmed_promotions_demotions),
    transfers: num(row.transfers),
    locationAccessChanges: num(row.location_access_changes),
    errorCount: num(row.error_count),
    errorCode: str(row.error_code),
    errorDetail: str(row.error_detail),
  };
}

/** Sync History: aggregates only. */
export async function loadRuns(limit = 60): Promise<RunRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("employee_sync_run_summary")
    .select(
      "id, started_at, finished_at, status, source_mode, employees_fetched, employees_added, employees_updated, new_hires, terminations, position_changes, confirmed_promotions_demotions, transfers, location_access_changes, error_count, error_code, error_detail",
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw classifyStatusError(error);
  return ((data ?? []) as Record<string, unknown>[]).map(runRowFromView);
}

export class ChangeReviewError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ChangeReviewError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseChangeReview(id: string, body: Partial<Record<string, unknown>>): { id: string; reviewStatus: ReviewStatus } {
  if (!UUID.test(id)) throw new ChangeReviewError("A change id is required.");
  const status = body.reviewStatus;
  if (status !== "acknowledged" && status !== "dismissed" && status !== "unreviewed") {
    throw new ChangeReviewError("A change is `acknowledged`, `dismissed` or `unreviewed`.");
  }
  return { id, reviewStatus: status };
}

/**
 * A PERSON'S REVIEW OF ONE CHANGE. Writes only `review_status`, `reviewed_by`
 * and `reviewed_at` — the append-only trigger refuses anything else — and
 * changes nobody's access.
 */
export async function reviewChange(input: { id: string; reviewStatus: ReviewStatus; reviewedBy: string }): Promise<"reviewed" | "unknown_change"> {
  const unreviewed = input.reviewStatus === "unreviewed";
  const { data, error } = await getSupabaseAdmin()
    .from("employee_directory_changes")
    .update({
      review_status: input.reviewStatus,
      reviewed_by: unreviewed ? null : input.reviewedBy.slice(0, 120),
      reviewed_at: unreviewed ? null : new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("id");
  if (error) throw new EmployeeStoreError("store_unavailable", "The change review could not be saved.");
  return (data ?? []).length === 1 ? "reviewed" : "unknown_change";
}
