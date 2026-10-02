import { countActions } from "./plan";
import type { PlannedRow } from "./types";

/**
 * ============================================================================
 * THE MASS-CHANGE GUARDS — when a plan must not be applied, whatever it says
 * ============================================================================
 *
 * A Woven outage, a broken filter or a mapping deleted by mistake looks, from
 * here, exactly like a wave of terminations or transfers. So before ANY
 * mutation could be applied, the plan and the read behind it are checked, and
 * one tripped guard blocks every mutation in the run (the plan is still shown
 * and, in shadow mode, recorded as `aborted` with the guard codes).
 *
 * Pure: the caller passes the facts; nothing here reads a clock or a database.
 */

export const ACCESS_GUARD_LIMITS = {
  /** The latest successful directory sync must be at most this old. The schedule is daily. */
  maxDirectoryAgeHours: 26,
  /** Active employees in the latest successful run, against the one before it. */
  minActiveRetainedPercent: 80,
  /** Terminations may disable at most max(absolute, percent of managed, active accounts). */
  maxDisables: { absolute: 3, percent: 5 },
  /** Primary-salon moves: at most max(absolute, percent of salon-tier linked accounts). */
  maxLocationMoves: { absolute: 3, percent: 10 },
  maxRoleChanges: { absolute: 3, percent: 10 },
  /** Accounts created in one run. Invites are a separate, later action. */
  maxCreates: 25,
} as const;

export type AccessGuardCode =
  | "no_successful_directory_sync"
  | "latest_directory_run_not_successful"
  | "directory_sync_stale"
  | "status_enum_unresolved"
  | "terminated_read_failed"
  | "active_count_dropped"
  | "zero_active_employees"
  | "terminations_exceed_threshold"
  | "location_moves_exceed_threshold"
  | "role_changes_exceed_threshold"
  | "creates_exceed_batch_limit"
  | "mappings_disappeared";

export interface DirectoryRunFacts {
  status: "running" | "succeeded" | "failed" | "rejected";
  finishedAt: string | null;
  employeesActive: number;
  issueCounts: Record<string, number>;
}

export interface MappingCounts {
  mappedLocations: number;
  confirmedPositions: number;
}

export interface GuardInput {
  rows: readonly PlannedRow[];
  /** Directory sync runs, NEWEST FIRST. */
  runs: readonly DirectoryRunFacts[];
  mappings: MappingCounts;
  /** The mapping counts the last recorded access run saw; null when there is none yet. */
  mappingBaseline: MappingCounts | null;
  now: Date;
}

export interface GuardResult {
  mutationsAllowed: boolean;
  codes: AccessGuardCode[];
  /** The figures behind each decision, for the screen. */
  details: Record<string, number | string | null>;
}

const limit = (base: number, rule: { absolute: number; percent: number }) => Math.max(rule.absolute, Math.ceil((base * rule.percent) / 100));

export function evaluateAccessGuards(input: GuardInput): GuardResult {
  const codes: AccessGuardCode[] = [];
  const details: GuardResult["details"] = {};
  const L = ACCESS_GUARD_LIMITS;

  const latest = input.runs[0] ?? null;
  const successes = input.runs.filter((r) => r.status === "succeeded");
  const lastSuccess = successes[0] ?? null;
  const previousSuccess = successes[1] ?? null;

  if (!lastSuccess) codes.push("no_successful_directory_sync");
  if (latest && latest.status !== "succeeded") codes.push("latest_directory_run_not_successful");
  if (lastSuccess) {
    const ageHours = lastSuccess.finishedAt ? (input.now.getTime() - Date.parse(lastSuccess.finishedAt)) / 3_600_000 : Infinity;
    details.directoryAgeHours = Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null;
    if (!(ageHours <= L.maxDirectoryAgeHours)) codes.push("directory_sync_stale");

    const issues = lastSuccess.issueCounts;
    if ((issues.enums_unavailable ?? 0) > 0) codes.push("status_enum_unresolved");
    if (
      (issues.terminated_status_read_skipped_no_code ?? 0) > 0 ||
      Object.keys(issues).some((k) => k.startsWith("terminated_status_read_failed_") && (issues[k] ?? 0) > 0)
    ) {
      codes.push("terminated_read_failed");
    }
    if (previousSuccess && previousSuccess.employeesActive > 0) {
      const retained = (lastSuccess.employeesActive * 100) / previousSuccess.employeesActive;
      details.activeRetainedPercent = Math.round(retained * 10) / 10;
      if (retained < L.minActiveRetainedPercent) codes.push("active_count_dropped");
    }
  }

  const activeEmployees = input.rows.filter((r) => r.externalEmployeeId !== null && r.wovenStatus === "active").length;
  details.activeEmployees = activeEmployees;
  if (input.rows.some((r) => r.wovenStatus !== null) && activeEmployees === 0) codes.push("zero_active_employees");

  const counts = countActions(input.rows);
  const managedActive = input.rows.filter((r) => r.account?.via === "link" && r.account.status === "active").length;
  const salonTier = input.rows.filter((r) => r.account?.via === "link" && r.account.scopeLevel === "salon").length;

  const disableLimit = limit(managedActive, L.maxDisables);
  const moveLimit = limit(salonTier, L.maxLocationMoves);
  const roleLimit = limit(salonTier, L.maxRoleChanges);
  Object.assign(details, {
    disables: counts.DISABLE_TERMINATED,
    disableLimit,
    locationMoves: counts.UPDATE_PRIMARY_LOCATION,
    locationMoveLimit: moveLimit,
    roleChanges: counts.UPDATE_ROLE,
    roleChangeLimit: roleLimit,
    creates: counts.CREATE_USER,
    createLimit: L.maxCreates,
  });
  if (counts.DISABLE_TERMINATED > disableLimit) codes.push("terminations_exceed_threshold");
  if (counts.UPDATE_PRIMARY_LOCATION > moveLimit) codes.push("location_moves_exceed_threshold");
  if (counts.UPDATE_ROLE > roleLimit) codes.push("role_changes_exceed_threshold");
  if (counts.CREATE_USER > L.maxCreates) codes.push("creates_exceed_batch_limit");

  details.mappedLocations = input.mappings.mappedLocations;
  details.confirmedPositions = input.mappings.confirmedPositions;
  if (
    input.mappingBaseline &&
    (input.mappings.mappedLocations < input.mappingBaseline.mappedLocations ||
      input.mappings.confirmedPositions < input.mappingBaseline.confirmedPositions)
  ) {
    codes.push("mappings_disappeared");
  }
  if (input.mappings.mappedLocations === 0 || input.mappings.confirmedPositions === 0) {
    if (!codes.includes("mappings_disappeared")) codes.push("mappings_disappeared");
  }

  return { mutationsAllowed: codes.length === 0, codes, details };
}

export const GUARD_DESCRIPTIONS: Record<AccessGuardCode, string> = {
  no_successful_directory_sync: "No Woven directory sync has succeeded yet.",
  latest_directory_run_not_successful: "The most recent Woven directory sync did not succeed.",
  directory_sync_stale: `The last successful Woven sync is older than ${ACCESS_GUARD_LIMITS.maxDirectoryAgeHours} hours.`,
  status_enum_unresolved: "Woven's status meanings could not be read in the last sync.",
  terminated_read_failed: "Woven's terminated-status read failed or did not run in the last sync.",
  active_count_dropped: `Active employees fell below ${ACCESS_GUARD_LIMITS.minActiveRetainedPercent}% of the previous sync.`,
  zero_active_employees: "Woven shows no active employees at all.",
  terminations_exceed_threshold: "More accounts would be disabled than the safety threshold allows.",
  location_moves_exceed_threshold: "More primary salons would move than the safety threshold allows.",
  role_changes_exceed_threshold: "More roles would change than the safety threshold allows.",
  creates_exceed_batch_limit: `More than ${ACCESS_GUARD_LIMITS.maxCreates} accounts would be created in one run.`,
  mappings_disappeared: "Location or position mappings have disappeared since the last recorded run.",
};
