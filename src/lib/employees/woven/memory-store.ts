import type {
  AbandonInput,
  ClaimResult,
  CommitInput,
  CommitResult,
  EmployeeDirectoryStore,
} from "./store";
import type {
  DirectoryChange,
  DirectoryRecord,
  LocationAffiliation,
  LocationMapEntry,
  PositionMapEntry,
} from "./types";

/**
 * ============================================================================
 * AN IN-MEMORY DIRECTORY STORE — a TEST DOUBLE, never used by a route
 * ============================================================================
 *
 * It mirrors what `employee_sync_commit_run` and its siblings do in SQL, so the
 * sync's decisions — idempotency, never deleting, the miss count, the lock,
 * affiliation reconciliation — can be exercised end to end without a
 * database. It is NOT evidence that the SQL behaves the same way; the PGlite
 * verifier (`scripts/verify-woven-migration.mjs`) checks the real functions.
 */

export interface MemoryRun {
  id: string;
  status: "running" | "succeeded" | "failed" | "rejected";
  requestedBy: string;
  errorCode: string | null;
}

interface MemoryAffiliation extends LocationAffiliation {
  active: boolean;
}

type MemoryRow = Omit<DirectoryRecord, "affiliations"> & { lastSeenRunId: string | null };

export class MemoryDirectoryStore implements EmployeeDirectoryStore {
  readonly rows = new Map<string, MemoryRow>();
  /** Keyed by external employee id, then Woven location id. Rows are deactivated, never deleted. */
  readonly affiliations = new Map<string, Map<string, MemoryAffiliation>>();
  readonly changes: (DirectoryChange & { runId: string })[] = [];
  readonly runs: MemoryRun[] = [];
  readonly locationMap = new Map<string, LocationMapEntry & { name: string | null; number: string | null }>();
  readonly positionMap = new Map<string, PositionMapEntry & { name: string | null }>();
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

  /** The ACTIVE affiliations on file for one employee. */
  activeAffiliations(externalEmployeeId: string): LocationAffiliation[] {
    return [...(this.affiliations.get(externalEmployeeId)?.values() ?? [])]
      .filter((a) => a.active)
      .map(({ active: _active, ...rest }) => {
        void _active;
        return structuredClone(rest);
      });
  }

  async loadDirectory(): Promise<DirectoryRecord[]> {
    return [...this.rows.values()].map((row) => {
      const { lastSeenRunId: _lastSeen, ...record } = row;
      void _lastSeen;
      return { ...structuredClone(record), affiliations: this.activeAffiliations(row.externalEmployeeId) };
    });
  }

  async loadLocationMap(): Promise<LocationMapEntry[]> {
    return [...this.locationMap.values()].map(({ wovenLocationId, status, salonId }) => ({ wovenLocationId, status, salonId }));
  }

  async loadPositionMap(): Promise<PositionMapEntry[]> {
    return [...this.positionMap.values()].map(({ wovenPositionId, status, isConfirmed, hierarchyRank }) => ({
      wovenPositionId,
      status,
      isConfirmed,
      hierarchyRank,
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
    if (incoming.size !== input.employees.length) throw new Error("duplicate_employee_in_payload");
    for (const change of input.changes) {
      if (!incoming.has(change.externalEmployeeId) && !this.rows.has(change.externalEmployeeId)) {
        throw new Error("change_without_employee");
      }
    }
    const seen = new Set<string>();
    for (const change of input.changes) {
      const key = `${change.externalEmployeeId}|${change.kind}|${change.fieldName ?? ""}|${JSON.stringify(change.toValue)}`;
      if (seen.has(key)) throw new Error("duplicate_change");
      seen.add(key);
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const write of input.employees) {
      const existing = this.rows.get(write.externalEmployeeId);
      if (!existing) created += 1;
      else if (existing.recordHash === write.recordHash) unchanged += 1;
      else updated += 1;
      const { affiliations: _aff, issues: _issues, recordHash, ...fields } = write;
      void _aff;
      void _issues;
      this.rows.set(write.externalEmployeeId, {
        ...fields,
        id: existing?.id ?? `emp-${write.externalEmployeeId}`,
        affiliationsVerifiedAt:
          write.affiliations !== null ? `verified-by-${input.runId}` : existing?.affiliationsVerifiedAt ?? null,
        missingSyncCount: 0,
        recordHash,
        lastSeenRunId: input.runId,
      });
      this.reconcileAffiliations(write.externalEmployeeId, write.primaryLocationId, write.primaryLocationName, write.affiliations);
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

    /* A new location or position is queued as unmapped; an existing mapping is never overwritten. */
    for (const location of input.locations) {
      const existing = this.locationMap.get(location.wovenLocationId);
      this.locationMap.set(location.wovenLocationId, {
        wovenLocationId: location.wovenLocationId,
        status: existing?.status ?? "unmapped",
        salonId: existing?.salonId ?? null,
        name: location.name ?? existing?.name ?? null,
        number: location.number ?? existing?.number ?? null,
      });
    }
    for (const write of input.employees) {
      if (write.positionId === null) continue;
      const existing = this.positionMap.get(write.positionId);
      this.positionMap.set(write.positionId, {
        wovenPositionId: write.positionId,
        status: existing?.status ?? "unmapped",
        isConfirmed: existing?.isConfirmed ?? false,
        hierarchyRank: existing?.hierarchyRank ?? null,
        name: write.positionName ?? existing?.name ?? null,
      });
    }

    run.status = "succeeded";
    return { status: "committed", created, updated, unchanged, missing, changes: input.changes.length };
  }

  /** Mirrors steps 3a–3d of the SQL commit. */
  private reconcileAffiliations(
    employeeId: string,
    primaryId: string | null,
    primaryName: string | null,
    list: LocationAffiliation[] | null,
  ) {
    const map = this.affiliations.get(employeeId) ?? new Map<string, MemoryAffiliation>();
    this.affiliations.set(employeeId, map);

    for (const entry of map.values()) {
      if (entry.accessType === "primary" && entry.wovenLocationId !== primaryId) entry.accessType = "additional";
    }
    if (list !== null) {
      const listed = new Set(list.map((a) => a.wovenLocationId));
      for (const a of list) map.set(a.wovenLocationId, { ...structuredClone(a), active: true });
      for (const entry of map.values()) if (!listed.has(entry.wovenLocationId)) entry.active = false;
    } else if (primaryId !== null) {
      const existing = map.get(primaryId);
      map.set(primaryId, {
        wovenLocationId: primaryId,
        locationName: primaryName ?? existing?.locationName ?? null,
        locationNumber: existing?.locationNumber ?? null,
        accessType: "primary",
        expiresOn: null,
        active: true,
      });
    }
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
      number: existing?.number ?? null,
    });
  }

  /** Test helper: what a reviewer does when they confirm a position with a rank. */
  mapPosition(wovenPositionId: string, hierarchyRank: number | null, status: PositionMapEntry["status"] = "mapped") {
    const existing = this.positionMap.get(wovenPositionId);
    this.positionMap.set(wovenPositionId, {
      wovenPositionId,
      status,
      isConfirmed: status === "mapped",
      hierarchyRank: status === "mapped" ? hierarchyRank : null,
      name: existing?.name ?? null,
    });
  }
}
