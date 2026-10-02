import type { EmploymentStatus } from "./types";

/**
 * ============================================================================
 * ONE EMPLOYEE, SEVERAL WOVEN READS — which Status wins
 * ============================================================================
 *
 * A run reads the same EmployeeID more than once: the default list, the list
 * with terminated employees, Woven's own terminated-status filter, and, for
 * some employees, their details. Each read carries the employee's `Status`
 * integer. They should agree. When they do not:
 *
 *   A READ WHOSE OWN `Status` RESOLVES TO TERMINATED WINS. Woven saying
 *   "terminated" anywhere is the authoritative statement; a stale Active copy
 *   in another read must not overwrite it (which a first-seen-wins merge did).
 *
 *   STATUS STILL COMES ONLY FROM THE `Status` INTEGER. A TerminationDate, a
 *   TerminationType, or being returned by a terminated filter is never, by
 *   itself, a termination — those are flagged for review, not acted on.
 *
 * Otherwise the first read's version is kept, as before.
 */

export interface StatusObservation {
  /** Which read: "current", "with_terminated", "terminated_status", "details". */
  read: string;
  status: EmploymentStatus;
  code: number | null;
}

export interface ResolvedStatus {
  /** Index of the observation whose record is used. */
  winner: number;
  status: EmploymentStatus;
  code: number | null;
  /** The reads did not all resolve to the same status. */
  disagrees: boolean;
}

export function resolveStatusAcrossReads(observations: readonly StatusObservation[]): ResolvedStatus {
  if (observations.length === 0) throw new Error("resolveStatusAcrossReads needs at least one observation");
  const terminated = observations.findIndex((o) => o.status === "terminated");
  const winner = terminated >= 0 ? terminated : 0;
  const chosen = observations[winner]!;
  return {
    winner,
    status: chosen.status,
    code: chosen.code,
    disagrees: new Set(observations.map((o) => o.status)).size > 1,
  };
}

/** The `Status` integers Woven's /lists/enums labels Terminated — what the terminated-status read filters on. */
export function terminatedStatusCodes(statuses: { labels: Readonly<Record<number, string>>; resolve(code: number | null): EmploymentStatus }): number[] {
  return Object.keys(statuses.labels)
    .map(Number)
    .filter((code) => Number.isInteger(code) && statuses.resolve(code) === "terminated")
    .sort((a, b) => a - b);
}

/**
 * PER-READ EVIDENCE, stored as issue codes on the employee's row: what one
 * read said, e.g. `status_read_with_terminated_terminated`. Written only for
 * employees with a past TerminationDate or reads that disagree, so the
 * directory can answer "which Woven read, if any, calls this person
 * Terminated?" without anyone re-running the sync.
 */
export type StatusReadCode = `status_read_${string}_${EmploymentStatus}`;

export function statusReadCode(read: string, status: EmploymentStatus): StatusReadCode {
  return `status_read_${read}_${status}`;
}

export function hasPastTermination(versions: readonly { terminationDate: string | null }[], today: string): boolean {
  return versions.some((v) => v.terminationDate !== null && v.terminationDate <= today);
}

/**
 * THE STATUS ASK SUNNY MAY ACT ON, from one directory row.
 *
 *   active      Woven's own Status, read in the latest stored run, is Active.
 *   terminated  Woven's own Status, read in the latest stored run (a list read,
 *               the terminated-status filter or details), is Terminated.
 *   unknown     Woven's Status meant neither — or the employee was in NO read
 *               of the latest stored run (`missing_sync_count > 0`).
 *
 * The stored `employment_status` is the LAST status Woven gave; it is kept as
 * history and never rewritten by absence. But absence is not an answer, so an
 * employee nobody read this run is `unknown` here, never still "active" and
 * never "terminated".
 */
export function observedStatus(row: { employmentStatus: EmploymentStatus; missingSyncCount: number }): EmploymentStatus {
  return row.missingSyncCount > 0 ? "unknown" : row.employmentStatus;
}
