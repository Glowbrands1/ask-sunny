import "server-only";

import { WovenApiError, WovenClient } from "./client";
import { readWovenConfig, type WovenConfig } from "./config";
import { EMPLOYEE_LIST_PASSES } from "./contract";
import { diffEmployee, missingChange, recordHash, type ResolvedEmployee } from "./diff";
import { normalizeEmployee, withDetails } from "./normalize";
import {
  createSupabaseDirectoryStore,
  EmployeeStoreError,
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
  type LocationAffiliation,
  type NormalizedEmployee,
} from "./types";

/**
 * ============================================================================
 * THE WOVEN EMPLOYEE SYNC — one full read, compared, then saved or refused
 * ============================================================================
 *
 * POLLING, NOT WEBHOOKS. Woven has no confirmed employee webhook and no
 * reliable modified-since filter, so every run reads every page of every
 * status pass and compares the whole read with the directory on file.
 *
 * THE ORDER OF A RUN:
 *
 *   1. Claim the run lock (a partial unique index — at most one live run).
 *   2. Read the directory on file and the Woven location map.
 *   3. Read EVERY page of the active pass and the terminated pass.
 *   4. PROVE THE READ IS COMPLETE, or refuse the run (see `validateRead`).
 *   5. Read employee details, within a per-run budget, to learn affiliations.
 *   6. Normalise, flag data-quality issues, and diff against the directory.
 *   7. Save everything in ONE database transaction.
 *
 * WHAT A FAILED OR REFUSED RUN LEAVES BEHIND: its own run row, marked failed
 * or rejected with a code, and NOTHING ELSE. The directory is untouched, so the
 * last good snapshot remains the answer.
 *
 * WHAT A SUCCESSFUL RUN NEVER DOES:
 *   - delete anybody (absence raises a miss count; it is not termination),
 *   - change `app_users`, a role, a scope, a salon assignment or a login,
 *   - call a position change a promotion,
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
  changesByKind: Record<ChangeKind, number>;
  issueCounts: Record<string, number>;
  /**
   * How many received employees carried each field. For live validation: a
   * field at 0 across the estate almost always means its key is spelled
   * differently from `contract.ts`, not that nobody has one.
   */
  fieldCoverage: {
    workEmail: number;
    positionId: number;
    positionName: number;
    primaryLocationId: number;
    hireDate: number;
    terminationDateAmongTerminated: number;
    multipleLocationFlag: number;
  };
}

export type SyncOutcome =
  | { status: "disabled"; reason: string }
  | { status: "not_configured"; missing: string[] }
  | { status: "busy"; runningSince: string | null }
  | { status: "succeeded"; runId: string | null; summary: SyncSummary }
  | { status: "rejected"; runId: string | null; code: string; reason: string; summary: SyncSummary | null }
  | { status: "failed"; runId: string | null; code: string; reason: string };

export interface SyncOptions {
  requestedBy: string;
  /** Reads and compares, writes nothing, takes no lock. */
  dryRun?: boolean;
  config?: WovenConfig;
  store?: EmployeeDirectoryStore;
  client?: Pick<WovenClient, "listEmployees" | "getEmployeeDetails" | "requestsMade">;
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

/**
 * The HTTP status a route answers with for an outcome.
 *
 * A refused or failed run is NOT a 200: it must show as a failed invocation in
 * Vercel, because a sync that quietly stopped working looks, from the
 * directory alone, exactly like a quiet week. A run that correctly declined to
 * start (switched off, already running) is a successful invocation.
 */
export function outcomeHttpStatus(outcome: SyncOutcome): number {
  switch (outcome.status) {
    case "succeeded":
    case "disabled":
    case "busy":
      return 200;
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
 *   EMPTY. No employees at all is never a real answer for a salon estate; it is
 *   a filter, a permission or a shape problem.
 *
 *   SHORT OF THE REPORTED TOTAL. When Woven reports how many records a pass
 *   has, fewer arriving means pages were lost.
 *
 *   UNEXPECTEDLY SMALL. Fewer active employees than `WOVEN_MIN_COMPLETENESS_PERCENT`
 *   of the actives already on file. A real estate does not lose a fifth of its
 *   staff between two syncs; a half-read does.
 *
 *   MOSTLY UNREADABLE. More records rejected (no usable employee id) than
 *   accepted means the field names have drifted from `contract.ts`.
 */
export function validateRead(input: {
  received: number;
  rejected: number;
  activeNow: number;
  activeOnFile: number;
  minCompletenessPercent: number;
  shortPasses: string[];
}): { ok: true } | { ok: false; code: string; reason: string } {
  if (input.shortPasses.length > 0) {
    return {
      ok: false,
      code: "count_mismatch",
      reason: `Woven reported more records than arrived for the ${input.shortPasses.join(", ")} pass. The read is incomplete.`,
    };
  }
  if (input.received === 0) {
    return { ok: false, code: "empty_read", reason: "Woven returned no employees at all." };
  }
  if (input.rejected > input.received) {
    return {
      ok: false,
      code: "mostly_unreadable",
      reason: `${input.rejected} records had no usable employee id, against ${input.received} that did.`,
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

/* --------------------------------------------------- affiliation merge -- */

/**
 * The affiliations to store for an employee whose full list was NOT read this
 * run: the ones on file, with the primary re-pointed at today's primary. No
 * affiliation is added or removed on the strength of a read that did not
 * happen.
 */
function carriedAffiliations(employee: NormalizedEmployee, previous: DirectoryRecord | undefined): LocationAffiliation[] {
  const kept = (previous?.affiliations ?? []).filter(
    (a) => a.kind !== "primary" && a.wovenLocationId !== employee.primaryLocationId,
  );
  const primary: LocationAffiliation[] =
    employee.primaryLocationId === null
      ? []
      : [
          {
            wovenLocationId: employee.primaryLocationId,
            locationName: employee.primaryLocationName,
            kind: "primary",
            startsOn: null,
            expiresOn: null,
          },
        ];
  return [...primary, ...kept];
}

/* -------------------------------------------------------------- the run -- */

export async function runWovenEmployeeSync(options: SyncOptions): Promise<SyncOutcome> {
  const config = options.config ?? readWovenConfig();
  const now = options.now ?? (() => new Date());
  const dryRun = options.dryRun === true;

  if (!config.enabled) {
    return { status: "disabled", reason: "WOVEN_SYNC_ENABLED is not on, so nothing reaches Woven." };
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

  const client =
    options.client ??
    new WovenClient({
      baseUrl: config.baseUrl,
      credentials: config.credentials,
      deadlineAt: Date.now() + (options.readBudgetMs ?? DEFAULT_READ_BUDGET_MS),
    });

  const stats: RunStats = {
    requestsMade: 0,
    pagesFetched: 0,
    employeesReceived: 0,
    employeesActive: 0,
    employeesTerminated: 0,
    employeesStatusUnknown: 0,
    employeesUnchanged: 0,
    detailsFetched: 0,
    detailsSkipped: 0,
    unmappedLocations: 0,
    recordsRejected: 0,
    issueCounts: {},
  };

  try {
    /* ---- 2. what is on file ---- */
    let directory: DirectoryRecord[];
    let locationMap: Awaited<ReturnType<EmployeeDirectoryStore["loadLocationMap"]>>;
    try {
      directory = await store.loadDirectory();
      locationMap = await store.loadLocationMap();
    } catch (error) {
      /*
       * A DRY RUN CAN STILL BE USEFUL BEFORE THE MIGRATION EXISTS: it validates
       * the live API and the field mapping, and compares against nothing. A
       * real run cannot — it would record everybody as new.
       */
      if (!dryRun) throw error;
      directory = [];
      locationMap = [];
      stats.issueCounts.directory_unavailable = 1;
    }
    const previousById = new Map(directory.map((row) => [row.externalEmployeeId, row]));

    /* ---- 3. every page of every pass ---- */
    const today = isoDate(now());
    const received = new Map<string, NormalizedEmployee>();
    const shortPasses: string[] = [];

    for (const pass of EMPLOYEE_LIST_PASSES) {
      const result = await client.listEmployees({ status: pass.status }, config.pageSize);
      stats.pagesFetched += result.pages;
      if (result.reportedTotal !== null && result.records.length < result.reportedTotal) {
        shortPasses.push(pass.label);
      }

      for (const record of result.records) {
        const normalized = normalizeEmployee(record, {
          impliedStatus: pass.impliedStatus,
          workEmailDomains: config.workEmailDomains,
          today,
        });
        if (!normalized.ok) {
          stats.recordsRejected += 1;
          stats.issueCounts[`record_${normalized.reason}`] = (stats.issueCounts[`record_${normalized.reason}`] ?? 0) + 1;
          continue;
        }
        const id = normalized.employee.externalEmployeeId;
        if (received.has(id)) {
          /* The active pass is read first, so an employee in both keeps the active reading. */
          stats.issueCounts.duplicate_across_passes = (stats.issueCounts.duplicate_across_passes ?? 0) + 1;
          continue;
        }
        received.set(id, normalized.employee);
      }
    }

    const employees = [...received.values()];
    stats.employeesReceived = employees.length;
    stats.employeesActive = employees.filter((e) => e.employmentStatus === "active").length;
    stats.employeesTerminated = employees.filter((e) => e.employmentStatus === "terminated").length;
    stats.employeesStatusUnknown = employees.filter((e) => e.employmentStatus === "unknown").length;

    /* ---- 4. prove the read is the whole estate ---- */
    const verdict = validateRead({
      received: employees.length,
      rejected: stats.recordsRejected,
      activeNow: stats.employeesActive,
      activeOnFile: directory.filter((row) => row.employmentStatus === "active").length,
      minCompletenessPercent: config.minCompletenessPercent,
      shortPasses,
    });
    if (!verdict.ok) throw new SyncRejected(verdict.code, verdict.reason);

    /* ---- 5. details, within budget, least-recently-verified first ---- */
    const detailed = new Map<string, NormalizedEmployee>();
    const candidates = employees
      .filter((e) => e.affiliations === null && e.employmentStatus !== "terminated")
      .sort((a, b) => {
        const va = previousById.get(a.externalEmployeeId)?.affiliationsVerifiedAt ?? "";
        const vb = previousById.get(b.externalEmployeeId)?.affiliationsVerifiedAt ?? "";
        return va === vb ? a.externalEmployeeId.localeCompare(b.externalEmployeeId) : va < vb ? -1 : 1;
      });

    for (const candidate of candidates.slice(0, config.maxDetailRequestsPerRun)) {
      try {
        const details = await client.getEmployeeDetails(candidate.externalEmployeeId);
        const merged = withDetails(candidate, details);
        detailed.set(candidate.externalEmployeeId, merged);
        if (merged.affiliations !== null) stats.detailsFetched += 1;
      } catch (error) {
        /*
         * DETAILS ARE AN ENRICHMENT, NOT THE READ. The list is complete and has
         * already been proved so. A details failure leaves the affected
         * employees' affiliations as they are on file and stops further detail
         * reads — the same fault would only repeat — but does not fail the run.
         */
        if (error instanceof WovenApiError && error.code === "not_found") {
          stats.issueCounts.details_not_found = (stats.issueCounts.details_not_found ?? 0) + 1;
          continue;
        }
        const code = error instanceof WovenApiError ? error.code : "unexpected";
        stats.issueCounts[`details_interrupted_${code}`] = 1;
        break;
      }
    }
    stats.detailsSkipped = candidates.length - stats.detailsFetched;

    /* ---- 6. resolve, flag, diff ---- */
    const mappedOrIgnored = new Set(
      locationMap.filter((entry) => entry.status !== "unmapped").map((entry) => entry.wovenLocationId),
    );

    const resolved: ResolvedEmployee[] = employees.map((base) => {
      const employee = detailed.get(base.externalEmployeeId) ?? base;
      const previous = previousById.get(employee.externalEmployeeId);
      const verified = employee.affiliations !== null;
      const affiliations = verified ? employee.affiliations! : carriedAffiliations(employee, previous);
      const issues: EmployeeIssue[] = [...employee.issues];
      if (!verified && employee.employmentStatus !== "terminated") issues.push("affiliations_not_verified");
      return { ...employee, affiliations, affiliationsVerified: verified, issues };
    });

    /* Duplicate work emails: flagged on every holder, never resolved by guessing. */
    const holders = new Map<string, number>();
    for (const employee of resolved) {
      if (employee.workEmail) holders.set(employee.workEmail, (holders.get(employee.workEmail) ?? 0) + 1);
    }

    const locations = new Map<string, string | null>();
    const unmapped = new Set<string>();

    const writes: EmployeeWrite[] = [];
    const changes: DirectoryChange[] = [];
    const initialLoad = directory.length === 0;

    for (const employee of resolved) {
      if (employee.workEmail && (holders.get(employee.workEmail) ?? 0) > 1) {
        employee.issues.push("duplicate_work_email");
      }
      let hasUnmapped = false;
      for (const affiliation of employee.affiliations) {
        if (!locations.has(affiliation.wovenLocationId) || locations.get(affiliation.wovenLocationId) === null) {
          locations.set(affiliation.wovenLocationId, affiliation.locationName);
        }
        if (!mappedOrIgnored.has(affiliation.wovenLocationId)) {
          unmapped.add(affiliation.wovenLocationId);
          hasUnmapped = true;
        }
      }
      if (hasUnmapped) employee.issues.push("unmapped_location");

      const issues = [...new Set(employee.issues)].sort();
      for (const issue of issues) stats.issueCounts[issue] = (stats.issueCounts[issue] ?? 0) + 1;

      const previous = previousById.get(employee.externalEmployeeId);
      const hash = recordHash(employee, issues);
      if (previous && previous.recordHash === hash) stats.employeesUnchanged += 1;

      changes.push(...diffEmployee(previous, employee, { initialLoad }));
      writes.push({
        externalEmployeeId: employee.externalEmployeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        preferredName: employee.preferredName,
        workEmail: employee.workEmail,
        employmentStatus: employee.employmentStatus,
        hireDate: employee.hireDate,
        terminationDate: employee.terminationDate,
        positionId: employee.positionId,
        positionName: employee.positionName,
        primaryLocationId: employee.primaryLocationId,
        primaryLocationName: employee.primaryLocationName,
        affiliations: employee.affiliations,
        affiliationsVerified: employee.affiliationsVerified,
        sourceUpdatedAt: employee.sourceUpdatedAt,
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
    stats.unmappedLocations = unmapped.size;

    const changesByKind = emptyChangeCounts();
    for (const change of changes) changesByKind[change.kind] += 1;

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
      employeesUnchanged: stats.employeesUnchanged,
      employeesMissing: missing,
      detailsFetched: stats.detailsFetched,
      detailsSkipped: stats.detailsSkipped,
      recordsRejected: stats.recordsRejected,
      unmappedLocations: stats.unmappedLocations,
      changesByKind,
      issueCounts: { ...stats.issueCounts },
      fieldCoverage: {
        workEmail: resolved.filter((e) => e.workEmail !== null).length,
        positionId: resolved.filter((e) => e.positionId !== null).length,
        positionName: resolved.filter((e) => e.positionName !== null).length,
        primaryLocationId: resolved.filter((e) => e.primaryLocationId !== null).length,
        hireDate: resolved.filter((e) => e.hireDate !== null).length,
        terminationDateAmongTerminated: resolved.filter(
          (e) => e.employmentStatus === "terminated" && e.terminationDate !== null,
        ).length,
        multipleLocationFlag: resolved.filter((e) => e.hasMultipleLocations !== null).length,
      },
    };

    if (dryRun) return { status: "succeeded", runId: null, summary };

    /* ---- 7. one transaction ---- */
    stats.requestsMade = client.requestsMade;
    const committed = await store.commitRun({
      runId: runId!,
      employees: writes,
      changes,
      locations: [...locations].map(([wovenLocationId, name]) => ({ wovenLocationId, name })),
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
      summary: { ...summary, employeesCreated: committed.created, employeesUpdated: committed.updated },
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
        /*
         * If even the failure cannot be recorded, the run row stays `running`
         * and the claim function reaps it as stale on the next attempt. The
         * directory is untouched either way.
         */
      }
    }

    return status === "rejected"
      ? { status, runId, code, reason, summary }
      : { status, runId, code, reason };
  }
}
