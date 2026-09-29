import "server-only";

import { WovenApiError, WovenClient } from "./client";
import { NEW_HIRE_WINDOW_DAYS, readWovenConfig, WOVEN_SYNC_WRITES_ENABLED_ENV, type WovenConfig } from "./config";
import { EMPLOYEE_LIST_PASSES } from "./contract";
import { buildSyncDiagnostics, type SyncDiagnostics } from "./diagnostics";
import { diffEmployee, missingChange, recordHash, type ResolvedEmployee } from "./diff";
import { parseEnums, statusResolver, terminationTypeLabels, type StatusResolver, type WovenEnumEntry } from "./enums";
import { normalizeEmployee, primaryOnly, readCatalogLocation, withDetails } from "./normalize";
import {
  createSupabaseDirectoryStore,
  EmployeeStoreError,
  type CommitLocation,
  type EmployeeDirectoryStore,
  type EmployeeWrite,
  type RunStats,
} from "./store";
import {
  CHANGE_KINDS,
  type ChangeKind,
  type DirectoryChange,
  type DirectoryRecord,
  type EmployeeIssue,
  type LocationCatalogEntry,
  type NormalizedEmployee,
  type PositionMapEntry,
} from "./types";

/**
 * ============================================================================
 * THE WOVEN EMPLOYEE SYNC — one full read, compared, then saved or refused
 * ============================================================================
 *
 * POLLING, NOT WEBHOOKS. The OpenAPI export names no employee webhook trigger
 * and no modified-since filter, so every run reads every page of both list
 * passes and compares the whole read with the directory on file.
 *
 * THE ORDER OF A RUN:
 *
 *   1. Claim the run lock (a partial unique index — at most one live run).
 *   2. Read the directory on file, the location map and the position map.
 *   3. Read `/lists/enums`, so `Status` integers mean what Woven says they mean.
 *   4. Read EVERY page of the default list and of the list with terminated.
 *   5. PROVE THE READ IS COMPLETE, or refuse the run (see `validateRead`).
 *   6. Read the location catalog (`/locations`) and, within a per-run budget,
 *      employee details for anyone whose location list is not settled.
 *   7. Normalise, flag data-quality issues, and diff against the directory.
 *   8. Save everything in ONE database transaction.
 *
 * WHAT A FAILED OR REFUSED RUN LEAVES BEHIND: its own run row, marked failed
 * or rejected with a code, and NOTHING ELSE.
 *
 * WHAT A SUCCESSFUL RUN NEVER DOES:
 *   - delete anybody (absence raises a miss count; it is not termination),
 *   - change a login, a role, a scope or a salon assignment,
 *   - call a position change a promotion without a confirmed, ranked mapping,
 *   - write anything to Woven.
 */

export const CRON_REQUESTER = "cron";

/**
 * How long a run may spend reading Woven before it stops starting requests,
 * leaving headroom inside the route's `maxDuration` for the commit.
 */
export const DEFAULT_READ_BUDGET_MS = 230_000;

/**
 * A directory smaller than this is too small for a percentage test to mean
 * anything, so the completeness check starts applying at this many actives.
 */
const COMPLETENESS_MIN_BASELINE = 10;

export interface SyncSummary {
  dryRun: boolean;
  requestsMade: number;
  pagesFetched: number;
  employeesReceived: number;
  employeesActive: number;
  employeesTerminated: number;
  employeesStatusUnknown: number;
  employeesCreated: number | null;
  employeesUpdated: number | null;
  employeesUnchanged: number;
  employeesMissing: number;
  detailsFetched: number;
  detailsSkipped: number;
  recordsRejected: number;
  unmappedLocations: number;
  unmappedPositions: number;
  /** Where status meanings came from. `none` means every status was `unknown`. */
  statusSource: StatusResolver["source"];
  changesByKind: Record<ChangeKind, number>;
  /** How the `new_employee` changes were classified: an initial load, a new hire, or newly visible. */
  newEmployeesByClassification: { initial_load: number; new_hire: number; newly_visible: number };
  issueCounts: Record<string, number>;
  /**
   * How many received employees carried each field. A field at 0 across the
   * estate almost always means the response differs from the spec.
   */
  fieldCoverage: {
    emailAddress: number;
    positionId: number;
    positionName: number;
    primaryLocationId: number;
    hireDate: number;
    terminationDateAmongTerminated: number;
    multipleLocationFlag: number;
  };
  /**
   * Why the issue counts are what they are: counts and field combinations
   * only, never an employee's name, email, id or date. Read by a person
   * before the first stored sync; nothing in the sync acts on it.
   */
  diagnostics?: SyncDiagnostics;
  /** What a STORED run saved. Absent on a dry run. Counts only. */
  saved?: SavedCounts;
}

export interface SavedCounts {
  directoryCreated: number;
  directoryUpdated: number;
  directoryUnchanged: number;
  changesRecorded: number;
  /** Active affiliations written: each full list read, or the primary alone when the list was not read. */
  affiliationsSaved: number;
  /** Locations sent to the location map (catalog and employee-referenced); new ones are queued unmapped. */
  locationsQueued: number;
  /** Distinct PositionIDs sent to the position map; new ones are queued unmapped. */
  positionsQueued: number;
}

export type SyncOutcome =
  | { status: "disabled"; reason: string }
  /** A save was asked for while WOVEN_SYNC_WRITES_ENABLED is off. Nothing was opened, locked, read or written. */
  | { status: "writes_disabled"; reason: string }
  | { status: "not_configured"; missing: string[] }
  | { status: "busy"; runningSince: string | null }
  | { status: "succeeded"; runId: string | null; summary: SyncSummary }
  | { status: "rejected"; runId: string | null; code: string; reason: string; summary: SyncSummary | null }
  | { status: "failed"; runId: string | null; code: string; reason: string };

export type SyncClient = Pick<
  WovenClient,
  "listEmployees" | "getEmployeeDetails" | "listLocations" | "listEnums" | "requestsMade"
>;

export interface SyncOptions {
  requestedBy: string;
  /** Reads and compares, writes nothing, takes no lock. */
  dryRun?: boolean;
  config?: WovenConfig;
  store?: EmployeeDirectoryStore;
  client?: SyncClient;
  now?: () => Date;
  readBudgetMs?: number;
}

/** A read that arrived but cannot be trusted as the whole estate. */
class SyncRejected extends Error {
  readonly code: string;
  readonly summary: SyncSummary | null;
  constructor(code: string, message: string, summary: SyncSummary | null = null) {
    super(message);
    this.code = code;
    this.summary = summary;
  }
}

function emptyChangeCounts(): Record<ChangeKind, number> {
  return Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, 0])) as Record<ChangeKind, number>;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

/**
 * The HTTP status a route answers with for an outcome. A refused or failed
 * run is NOT a 200, so it shows as a failed invocation.
 */
export function outcomeHttpStatus(outcome: SyncOutcome): number {
  switch (outcome.status) {
    case "succeeded":
    case "disabled":
    case "busy":
      return 200;
    case "writes_disabled":
      return 409;
    case "not_configured":
      return 503;
    case "rejected":
      return 422;
    case "failed":
      if (outcome.code.startsWith("woven_")) return 502;
      return outcome.code === "store_unavailable" ? 503 : 500;
  }
}

/* ------------------------------------------------------- the read proof -- */

/**
 * Refuses a read that cannot be the whole estate.
 *
 *   EMPTY. No employees at all is never a real answer for a salon estate.
 *   MOSTLY UNREADABLE. More records without a usable EmployeeID than with one.
 *   UNEXPECTEDLY SMALL. Fewer active employees than
 *   `WOVEN_MIN_COMPLETENESS_PERCENT` of the actives already on file.
 */
export function validateRead(input: {
  received: number;
  rejected: number;
  activeNow: number;
  activeOnFile: number;
  minCompletenessPercent: number;
}): { ok: true } | { ok: false; code: string; reason: string } {
  if (input.received === 0) {
    return { ok: false, code: "empty_read", reason: "Woven returned no employees at all." };
  }
  if (input.rejected > input.received) {
    return {
      ok: false,
      code: "mostly_unreadable",
      reason: `${input.rejected} records had no usable EmployeeID, against ${input.received} that did.`,
    };
  }
  if (input.activeOnFile >= COMPLETENESS_MIN_BASELINE) {
    const required = Math.ceil((input.activeOnFile * input.minCompletenessPercent) / 100);
    if (input.activeNow < required) {
      return {
        ok: false,
        code: "unexpectedly_small",
        reason: `Only ${input.activeNow} active employees arrived, against ${input.activeOnFile} on file; at least ${required} (${input.minCompletenessPercent}%) are required before a sync is trusted.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Whether an employee's location list must come from a details read this run.
 *
 * A list row that says "no multiple-location access" settles it — UNLESS the
 * directory already holds other active locations for them, which that flag
 * alone cannot be trusted to end: Woven may not set it for expiring access.
 * Terminated employees are not read; what is on file is kept for them.
 */
export function needsDetailsRead(employee: NormalizedEmployee, previous: DirectoryRecord | undefined): boolean {
  if (employee.employmentStatus === "terminated") return false;
  return !listSettlesLocations(employee, previous);
}

/**
 * True when this run's LIST ROW alone is a full answer for the employee's
 * locations: Woven says no multiple-location access, and nothing beyond the
 * primary is on file for that flag to contradict.
 */
export function listSettlesLocations(employee: NormalizedEmployee, previous: DirectoryRecord | undefined): boolean {
  if (employee.affiliationSource !== "list_flag") return false;
  return !(previous?.affiliations ?? []).some((a) => a.wovenLocationId !== employee.primaryLocationId);
}

/* -------------------------------------------------------------- the run -- */

/** A refused sign-in stops the run wherever it surfaces; it is never read as "that endpoint was unavailable". */
const SIGN_IN_FAILURES = new Set(["auth_failed", "forbidden", "login_refused"]);

export async function runWovenEmployeeSync(options: SyncOptions): Promise<SyncOutcome> {
  const config = options.config ?? readWovenConfig();
  const now = options.now ?? (() => new Date());
  const dryRun = options.dryRun === true;

  if (!config.enabled) {
    return { status: "disabled", reason: "WOVEN_SYNC_ENABLED is not on, so nothing reaches Woven." };
  }
  /*
   * THE WRITE SWITCH, ENFORCED HERE — THE ONE PLACE EVERY SYNC PASSES. A save
   * with WOVEN_SYNC_WRITES_ENABLED off is refused before the store is opened,
   * the run lock is taken or Woven is called, so it writes nothing: no run
   * row, no directory row, no change, no affiliation, no location or position
   * map row. The manual route and the cron both reach this; neither can skip it.
   */
  if (!dryRun && !config.writesEnabled) {
    return {
      status: "writes_disabled",
      reason: `${WOVEN_SYNC_WRITES_ENABLED_ENV} is not on, so only a dry run is possible. Nothing was read or saved.`,
    };
  }
  if (!config.credentials) {
    return { status: "not_configured", missing: config.missingCredentials };
  }

  const store = options.store ?? createSupabaseDirectoryStore();

  let runId: string | null = null;
  if (!dryRun) {
    const claim = await store.claimRun(options.requestedBy);
    if (claim.status === "busy") return { status: "busy", runningSince: claim.runningSince };
    runId = claim.runId;
  }

  const client: SyncClient =
    options.client ??
    new WovenClient({
      baseUrl: config.baseUrl,
      credentials: config.credentials,
      companyId: config.companyId,
      platform: config.platform,
      deadlineAt: Date.now() + (options.readBudgetMs ?? DEFAULT_READ_BUDGET_MS),
    });

  const stats: RunStats = {
    requestsMade: 0,
    pagesFetched: 0,
    employeesReceived: 0,
    employeesActive: 0,
    employeesTerminated: 0,
    employeesStatusUnknown: 0,
    detailsFetched: 0,
    detailsSkipped: 0,
    recordsRejected: 0,
    issueCounts: {},
  };

  try {
    /* ---- 2. what is on file ---- */
    let directory: DirectoryRecord[];
    let locationMap: Awaited<ReturnType<EmployeeDirectoryStore["loadLocationMap"]>>;
    let positionMap: PositionMapEntry[];
    try {
      directory = await store.loadDirectory();
      locationMap = await store.loadLocationMap();
      positionMap = await store.loadPositionMap();
    } catch (error) {
      /*
       * A DRY RUN CAN STILL BE USEFUL BEFORE THE MIGRATION EXISTS: it validates
       * the live API and the field mapping, and compares against nothing.
       */
      if (!dryRun) throw error;
      directory = [];
      locationMap = [];
      positionMap = [];
      stats.issueCounts.directory_unavailable = 1;
    }
    const previousById = new Map(directory.map((row) => [row.externalEmployeeId, row]));
    const positions = new Map(positionMap.map((p) => [p.wovenPositionId, p]));

    /* ---- 3. what Woven's status integers mean ---- */
    let statuses: StatusResolver;
    let enumEntries: WovenEnumEntry[] | null = null;
    try {
      enumEntries = parseEnums(await client.listEnums());
      statuses = statusResolver(enumEntries);
    } catch (error) {
      if (error instanceof WovenApiError && SIGN_IN_FAILURES.has(error.code)) throw error;
      statuses = statusResolver(null);
      stats.issueCounts.enums_unavailable = 1;
    }

    /* ---- 4. every page of both passes ---- */
    const today = isoDate(now());
    const received = new Map<string, NormalizedEmployee>();
    const idsByPass = new Map<string, Set<string>>();

    /*
     * An unreadable record (no usable EmployeeID) appears in BOTH reads and
     * cannot be matched across them, so the larger per-read count is kept — a
     * lower bound on distinct unreadable records — rather than the sum.
     */
    const rejectedByPass: Record<string, number>[] = [];
    for (const pass of EMPLOYEE_LIST_PASSES) {
      const result = await client.listEmployees(pass.query, config.pageSize);
      stats.pagesFetched += result.pages;
      const ids = new Set<string>();
      idsByPass.set(pass.label, ids);
      const rejected: Record<string, number> = {};
      rejectedByPass.push(rejected);

      for (const record of result.records) {
        const normalized = normalizeEmployee(record, { statuses, today });
        if (!normalized.ok) {
          bump(rejected, `record_${normalized.reason}`);
          continue;
        }
        const id = normalized.employee.externalEmployeeId;
        ids.add(id);
        if (!received.has(id)) received.set(id, normalized.employee);
      }
    }
    for (const reason of new Set(rejectedByPass.flatMap((r) => Object.keys(r)))) {
      stats.issueCounts[reason] = Math.max(...rejectedByPass.map((r) => r[reason] ?? 0));
    }
    stats.recordsRejected = Math.max(0, ...rejectedByPass.map((r) => Object.values(r).reduce((a, b) => a + b, 0)));

    /* The with-terminated read should contain everyone the default read did. Counted, never guessed at. */
    const current = idsByPass.get("current") ?? new Set<string>();
    const withTerminated = idsByPass.get("with_terminated") ?? new Set<string>();
    const notInSuperset = [...current].filter((id) => !withTerminated.has(id)).length;
    if (notInSuperset > 0) stats.issueCounts.current_missing_from_with_terminated = notInSuperset;

    const employees = [...received.values()];
    stats.employeesReceived = employees.length;
    stats.employeesActive = employees.filter((e) => e.employmentStatus === "active").length;
    stats.employeesTerminated = employees.filter((e) => e.employmentStatus === "terminated").length;
    stats.employeesStatusUnknown = employees.filter((e) => e.employmentStatus === "unknown").length;

    /* ---- 5. prove the read is the whole estate ---- */
    const verdict = validateRead({
      received: employees.length,
      rejected: stats.recordsRejected,
      activeNow: stats.employeesActive,
      activeOnFile: directory.filter((row) => row.employmentStatus === "active").length,
      minCompletenessPercent: config.minCompletenessPercent,
    });
    if (!verdict.ok) throw new SyncRejected(verdict.code, verdict.reason);
    /*
     * A DIRECTORY OF UNKNOWNS IS NOT SAVED. If Woven's status meanings could
     * not be read, every employee would be stored as `unknown` — true, and
     * useless, and a later resolved run would then look like an estate of
     * status changes. A dry run still reports; a real run is refused.
     */
    if (statuses.source === "none" && !dryRun) {
      throw new SyncRejected(
        "status_enum_unresolved",
        "Woven's /lists/enums named no employee-status enumeration, so no employee's status could be read. Nothing was saved.",
      );
    }

    /* ---- 6a. the location catalog: enrichment, never required ---- */
    const catalog = new Map<string, LocationCatalogEntry>();
    try {
      const body = await client.listLocations();
      for (const entry of Array.isArray(body) ? body : []) {
        const location = readCatalogLocation(entry);
        if (location) catalog.set(location.wovenLocationId, location);
      }
    } catch (error) {
      if (error instanceof WovenApiError && SIGN_IN_FAILURES.has(error.code)) throw error;
      stats.issueCounts.locations_catalog_unavailable = 1;
    }

    /* ---- 6b. details, within budget, least-recently-verified first ---- */
    const detailed = new Map<string, NormalizedEmployee>();
    const candidates = employees
      .filter((e) => needsDetailsRead(e, previousById.get(e.externalEmployeeId)))
      .sort((a, b) => {
        const va = previousById.get(a.externalEmployeeId)?.affiliationsVerifiedAt ?? "";
        const vb = previousById.get(b.externalEmployeeId)?.affiliationsVerifiedAt ?? "";
        return va === vb ? a.externalEmployeeId.localeCompare(b.externalEmployeeId) : va < vb ? -1 : 1;
      });

    const detailOutcomes = { attempted: 0, notFoundIds: new Set<string>(), noUsableLocationList: 0, interrupted: false };
    for (const candidate of candidates.slice(0, config.maxDetailRequestsPerRun)) {
      detailOutcomes.attempted += 1;
      try {
        const details = await client.getEmployeeDetails(candidate.externalEmployeeId);
        const merged = withDetails(candidate, details);
        if (merged.affiliationSource === "details") {
          detailed.set(candidate.externalEmployeeId, merged);
          stats.detailsFetched += 1;
        } else {
          detailOutcomes.noUsableLocationList += 1;
        }
      } catch (error) {
        /*
         * DETAILS ARE AN ENRICHMENT, NOT THE READ. A details failure keeps the
         * affected employees' locations as they are on file and stops further
         * detail reads, but does not fail the run.
         */
        if (error instanceof WovenApiError && error.code === "not_found") {
          bump(stats.issueCounts, "details_not_found");
          detailOutcomes.notFoundIds.add(candidate.externalEmployeeId);
          continue;
        }
        const code = error instanceof WovenApiError ? error.code : "unexpected";
        stats.issueCounts[`details_interrupted_${code}`] = 1;
        detailOutcomes.interrupted = true;
        break;
      }
    }
    stats.detailsSkipped = candidates.length - stats.detailsFetched;

    /* ---- 7. resolve, flag, diff ---- */
    const mappedOrIgnored = new Set(
      locationMap.filter((entry) => entry.status !== "unmapped").map((entry) => entry.wovenLocationId),
    );

    const resolved: ResolvedEmployee[] = employees.map((base) => {
      const previous = previousById.get(base.externalEmployeeId);
      const employee = detailed.get(base.externalEmployeeId) ?? base;
      const settled = employee.affiliationSource === "details" || listSettlesLocations(employee, previous);
      const affiliations = settled
        ? employee.affiliations!
        : [
            ...primaryOnly(employee),
            ...(previous?.affiliations ?? []).filter(
              (a) => a.accessType !== "primary" && a.wovenLocationId !== employee.primaryLocationId,
            ),
          ];
      const issues: EmployeeIssue[] = [...employee.issues];
      if (!settled && employee.employmentStatus !== "terminated") issues.push("affiliations_not_verified");
      return { ...employee, affiliations, affiliationsVerified: settled, issues };
    });

    /* Duplicate emails, case-insensitively: flagged on every holder, never resolved by guessing. */
    const holders = new Map<string, number>();
    for (const employee of resolved) {
      const key = employee.emailAddress?.toLowerCase();
      if (key) holders.set(key, (holders.get(key) ?? 0) + 1);
    }

    const locations = new Map<string, CommitLocation>();
    for (const entry of catalog.values()) locations.set(entry.wovenLocationId, { ...entry });
    const unmapped = new Set<string>();
    const unmappedPositions = new Set<string>();

    const writes: EmployeeWrite[] = [];
    const changes: DirectoryChange[] = [];
    const initialLoad = directory.length === 0;

    for (const employee of resolved) {
      if (employee.emailAddress && (holders.get(employee.emailAddress.toLowerCase()) ?? 0) > 1) {
        employee.issues.push("duplicate_email");
      }
      let hasUnmapped = false;
      for (const affiliation of employee.affiliations) {
        if (!locations.has(affiliation.wovenLocationId)) {
          locations.set(affiliation.wovenLocationId, {
            wovenLocationId: affiliation.wovenLocationId,
            name: affiliation.locationName,
            number: affiliation.locationNumber,
          });
        }
        if (!mappedOrIgnored.has(affiliation.wovenLocationId)) {
          unmapped.add(affiliation.wovenLocationId);
          hasUnmapped = true;
        }
      }
      if (hasUnmapped) employee.issues.push("unmapped_location");
      const positionStatus = employee.positionId === null ? null : positions.get(employee.positionId)?.status ?? "unmapped";
      if (employee.positionId !== null && positionStatus === "unmapped") {
        employee.issues.push("unmapped_position");
        unmappedPositions.add(employee.positionId);
      }

      const issues = [...new Set(employee.issues)].sort();
      for (const issue of issues) bump(stats.issueCounts, issue);

      const previous = previousById.get(employee.externalEmployeeId);
      const hash = recordHash(employee, issues);

      changes.push(
        ...diffEmployee(previous, employee, {
          initialLoad,
          today,
          newHireWindowDays: NEW_HIRE_WINDOW_DAYS,
          positions,
        }),
      );
      writes.push({
        externalEmployeeId: employee.externalEmployeeId,
        employeeLoginId: employee.employeeLoginId,
        externalHrisId: employee.externalHrisId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        preferredFirstName: employee.preferredFirstName,
        emailAddress: employee.emailAddress,
        employmentStatus: employee.employmentStatus,
        employmentStatusCode: employee.employmentStatusCode,
        hireDate: employee.hireDate,
        startDate: employee.startDate,
        terminationDate: employee.terminationDate,
        terminationLastDayWorked: employee.terminationLastDayWorked,
        terminationTypeCode: employee.terminationTypeCode,
        positionId: employee.positionId,
        positionName: employee.positionName,
        primaryLocationId: employee.primaryLocationId,
        primaryLocationName: employee.primaryLocationName,
        hasMultipleLocationAccess: employee.hasMultipleLocationAccess,
        hasAllLocationAccess: employee.hasAllLocationAccess,
        wovenLoginAllowed: employee.wovenLoginAllowed,
        affiliations: employee.affiliationsVerified ? employee.affiliations : null,
        issues,
        recordHash: hash,
      });
    }

    /* Everybody on file who did not appear: kept, counted, flagged once at the threshold. */
    let missing = 0;
    for (const row of directory) {
      if (received.has(row.externalEmployeeId)) continue;
      missing += 1;
      const change = missingChange(row);
      if (change) changes.push(change);
    }

    const changesByKind = emptyChangeCounts();
    const newEmployeesByClassification = { initial_load: 0, new_hire: 0, newly_visible: 0 };
    for (const change of changes) {
      changesByKind[change.kind] += 1;
      if (change.kind === "new_employee" && change.classification && change.classification in newEmployeesByClassification) {
        newEmployeesByClassification[change.classification as keyof typeof newEmployeesByClassification] += 1;
      }
    }

    const unchanged = writes.filter((w) => previousById.get(w.externalEmployeeId)?.recordHash === w.recordHash).length;

    const summary: SyncSummary = {
      dryRun,
      requestsMade: client.requestsMade,
      pagesFetched: stats.pagesFetched,
      employeesReceived: stats.employeesReceived,
      employeesActive: stats.employeesActive,
      employeesTerminated: stats.employeesTerminated,
      employeesStatusUnknown: stats.employeesStatusUnknown,
      employeesCreated: null,
      employeesUpdated: null,
      employeesUnchanged: unchanged,
      employeesMissing: missing,
      detailsFetched: stats.detailsFetched,
      detailsSkipped: stats.detailsSkipped,
      recordsRejected: stats.recordsRejected,
      unmappedLocations: unmapped.size,
      unmappedPositions: unmappedPositions.size,
      statusSource: statuses.source,
      changesByKind,
      newEmployeesByClassification,
      issueCounts: { ...stats.issueCounts },
      fieldCoverage: {
        emailAddress: resolved.filter((e) => e.emailAddress !== null).length,
        positionId: resolved.filter((e) => e.positionId !== null).length,
        positionName: resolved.filter((e) => e.positionName !== null).length,
        primaryLocationId: resolved.filter((e) => e.primaryLocationId !== null).length,
        hireDate: resolved.filter((e) => e.hireDate !== null).length,
        terminationDateAmongTerminated: resolved.filter(
          (e) => e.employmentStatus === "terminated" && e.terminationDate !== null,
        ).length,
        multipleLocationFlag: resolved.filter((e) => e.hasMultipleLocationAccess !== null).length,
      },
      diagnostics: buildSyncDiagnostics({
        employees,
        resolved,
        currentListIds: current,
        catalog,
        candidates,
        details: {
          budget: config.maxDetailRequestsPerRun,
          attempted: detailOutcomes.attempted,
          fetched: stats.detailsFetched,
          notFoundIds: detailOutcomes.notFoundIds,
          noUsableLocationList: detailOutcomes.noUsableLocationList,
          interrupted: detailOutcomes.interrupted,
        },
        statusLabels: statuses.labels,
        terminationTypeLabels: terminationTypeLabels(enumEntries),
        today,
      }),
    };

    if (dryRun) return { status: "succeeded", runId: null, summary };

    /* ---- 8. one transaction ---- */
    stats.requestsMade = client.requestsMade;
    const committed = await store.commitRun({
      runId: runId!,
      employees: writes,
      changes,
      locations: [...locations.values()],
      stats,
    });
    if (committed.status !== "committed") {
      throw new EmployeeStoreError(
        "run_not_running",
        "This sync's run was no longer open when it tried to save, so nothing was saved.",
      );
    }

    return {
      status: "succeeded",
      runId,
      summary: {
        ...summary,
        employeesCreated: committed.created,
        employeesUpdated: committed.updated,
        employeesUnchanged: committed.unchanged,
        saved: {
          directoryCreated: committed.created,
          directoryUpdated: committed.updated,
          directoryUnchanged: committed.unchanged,
          changesRecorded: committed.changes,
          affiliationsSaved: writes.reduce(
            (n, w) => n + (w.affiliations ? w.affiliations.length : w.primaryLocationId ? 1 : 0),
            0,
          ),
          locationsQueued: locations.size,
          positionsQueued: new Set(writes.map((w) => w.positionId).filter((id) => id !== null)).size,
        },
      },
    };
  } catch (error) {
    stats.requestsMade = client.requestsMade;

    let status: "failed" | "rejected" = "failed";
    let code = "internal_error";
    let reason = "The sync stopped on an unexpected error. Nothing was saved to the directory.";
    let summary: SyncSummary | null = null;

    if (error instanceof SyncRejected) {
      status = "rejected";
      code = error.code;
      reason = error.message;
      summary = error.summary;
    } else if (error instanceof WovenApiError) {
      code = `woven_${error.code}`;
      reason = error.message;
    } else if (error instanceof EmployeeStoreError) {
      code = error.code;
      reason = error.message;
    }

    if (runId) {
      try {
        await store.abandonRun({ runId, status, errorCode: code, errorDetail: reason, stats });
      } catch {
        /* The run row stays `running` and is reaped as stale by the next claim. */
      }
    }

    return status === "rejected" ? { status, runId, code, reason, summary } : { status, runId, code, reason };
  }
}
