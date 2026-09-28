import type {
  AbandonInput,
  ClaimResult,
  CommitInput,
  CommitResult,
  EmployeeDirectoryStore,
} from "./store";
import type { DirectoryChange, DirectoryRecord, LocationMapEntry } from "./types";

/**
 * ============================================================================
 * AN IN-MEMORY DIRECTORY STORE — a TEST DOUBLE, never used by a route
 * ============================================================================
 *
 * It mirrors what `employee_sync_commit_run` and its siblings do in SQL, so the
 * sync's decisions — idempotency, never deleting, the miss count, the lock —
 * can be exercised end to end without a database. It is NOT evidence that the
 * SQL behaves the same way; `docs/woven-employee-sync.md` §9 lists the checks
 * that must be run against the real functions before the schedule is enabled.
 */

export interface MemoryRun {
  id: string;
  status: "running" | "succeeded" | "failed" | "rejected";
  requestedBy: string;
  errorCode: string | null;
}

export class MemoryDirectoryStore implements EmployeeDirectoryStore {
  readonly rows = new Map<string, DirectoryRecord & { lastSeenRunId: string | null }>();
  readonly changes: (DirectoryChange & { runId: string })[] = [];
  readonly runs: MemoryRun[] = [];
  readonly locationMap = new Map<string, LocationMapEntry & { name: string | null }>();
  /** Set to make the next commit throw, as a lost connection would. */
  failNextCommit = false;
  private sequence = 0;

  async claimRun(requestedBy: string): Promise<ClaimResult> {
    const live = this.runs.find((run) => run.status === "running");
    if (live) return { status: "busy", runningSince: null };
    const id = `run-${++this.sequence}`;
    this.runs.push({ id, status: "running", requestedBy, errorCode: null });
    return { status: "claimed", runId: id };
  }

  async loadDirectory(): Promise<DirectoryRecord[]> {
    return [...this.rows.values()].map((row) => {
      const { lastSeenRunId: _lastSeen, ...record } = row;
      void _lastSeen;
      return structuredClone(record);
    });
  }

  async loadLocationMap(): Promise<LocationMapEntry[]> {
    return [...this.locationMap.values()].map(({ wovenLocationId, status, salonId }) => ({
      wovenLocationId,
      status,
      salonId,
    }));
  }

  async commitRun(input: CommitInput): Promise<CommitResult> {
    const run = this.runs.find((r) => r.id === input.runId);
    if (!run) return { status: "unknown_run" };
    if (run.status !== "running") return { status: "not_running" };
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("simulated connection loss");
    }
    /* All-or-nothing, like the SQL transaction: validate before touching anything. */
    const incoming = new Set(input.employees.map((e) => e.externalEmployeeId));
    for (const change of input.changes) {
      if (!incoming.has(change.externalEmployeeId) && !this.rows.has(change.externalEmployeeId)) {
        throw new Error("change_without_employee");
      }
    }

    let created = 0;
    let updated = 0;
    for (const write of input.employees) {
      const existing = this.rows.get(write.externalEmployeeId);
      if (existing) updated += 1;
      else created += 1;
      this.rows.set(write.externalEmployeeId, {
        id: existing?.id ?? `emp-${write.externalEmployeeId}`,
        externalEmployeeId: write.externalEmployeeId,
        firstName: write.firstName,
        lastName: write.lastName,
        preferredName: write.preferredName,
        workEmail: write.workEmail,
        employmentStatus: write.employmentStatus,
        hireDate: write.hireDate,
        terminationDate: write.terminationDate,
        positionId: write.positionId,
        positionName: write.positionName,
        primaryLocationId: write.primaryLocationId,
        primaryLocationName: write.primaryLocationName,
        affiliations: structuredClone(write.affiliations),
        affiliationsVerifiedAt: write.affiliationsVerified
          ? `verified-by-${input.runId}`
          : existing?.affiliationsVerifiedAt ?? null,
        missingSyncCount: 0,
        recordHash: write.recordHash,
        lastSeenRunId: input.runId,
      });
    }

    /* Never deleted: an employee absent from this run keeps their row and gains a miss. */
    let missing = 0;
    for (const row of this.rows.values()) {
      if (row.lastSeenRunId !== input.runId) {
        row.missingSyncCount += 1;
        missing += 1;
      }
    }

    for (const change of input.changes) {
      this.changes.push({ ...structuredClone(change), runId: input.runId });
    }

    /* A new location is queued as unmapped; an existing mapping is never overwritten. */
    for (const location of input.locations) {
      if (!this.locationMap.has(location.wovenLocationId)) {
        this.locationMap.set(location.wovenLocationId, {
          wovenLocationId: location.wovenLocationId,
          status: "unmapped",
          salonId: null,
          name: location.name,
        });
      }
    }

    run.status = "succeeded";
    return { status: "committed", created, updated, missing, changes: input.changes.length };
  }

  async abandonRun(input: AbandonInput): Promise<void> {
    const run = this.runs.find((r) => r.id === input.runId);
    if (run && run.status === "running") {
      run.status = input.status;
      run.errorCode = input.errorCode;
    }
  }

  /** Test helper: what a reviewer does when they map a Woven location to a salon. */
  mapLocation(wovenLocationId: string, salonId: string | null, status: LocationMapEntry["status"] = "mapped") {
    const existing = this.locationMap.get(wovenLocationId);
    this.locationMap.set(wovenLocationId, {
      wovenLocationId,
      status,
      salonId,
      name: existing?.name ?? null,
    });
  }
}
