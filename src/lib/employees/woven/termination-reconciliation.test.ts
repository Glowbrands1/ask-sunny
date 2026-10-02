import { describe, expect, it } from "vitest";

import { WovenClient } from "./client";
import { readWovenConfig } from "./config";
import { MemoryDirectoryStore } from "./memory-store";
import { observedStatus } from "./status-evidence";
import type { EmployeeWrite } from "./store";
import { runWovenEmployeeSync, type SyncOutcome } from "./sync";
import { createFakeWoven, FAKE_CREDENTIALS, FAKE_STATUS, wovenEmployee } from "./test-support";

/**
 * ============================================================================
 * TERMINATION DETECTION IN PRODUCTION'S SHAPE — EmployeeID reconciliation
 * ============================================================================
 *
 * Observed in Production (29 Sep – 2 Oct 2026): every stored run had
 * `employees_terminated = 0`. Woven drops a terminated employee from BOTH list
 * reads — `includeterminatedemployee=true` returns no one extra — and only the
 * `employeestatus=<Terminated>` filter returns them (~1,115 records). The sync
 * matched that filter only against the list reads, so a terminated employee
 * already on file was counted under "not in list reads" and discarded, and the
 * directory kept them `active` with a rising miss count. A `terminated`
 * change had never fired.
 *
 * These tests run the fake in that shape (`listReadsOmitTerminated`) and pin
 * the fix: the filter's records are matched BY EMPLOYEEID against the
 * directory on file, and only Woven's own Terminated Status terminates anyone.
 */

const CONFIG = readWovenConfig({
  WOVEN_SYNC_ENABLED: "true",
  WOVEN_SYNC_WRITES_ENABLED: "true",
  WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
  WOVEN_USERNAME: FAKE_CREDENTIALS.username,
  WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
  WOVEN_PAGE_SIZE: "25",
});
const NOW = () => new Date("2026-10-02T11:17:00Z");
const { active: ACTIVE, terminated: TERMINATED } = FAKE_STATUS;

/** The memory store drops issue codes on save; this keeps the last commit's payload. */
class CapturingStore extends MemoryDirectoryStore {
  lastWrites: EmployeeWrite[] = [];
  override async commitRun(input: Parameters<MemoryDirectoryStore["commitRun"]>[0]) {
    this.lastWrites = input.employees;
    return super.commitRun(input);
  }
  issuesOf(id: string) {
    return this.lastWrites.find((w) => w.externalEmployeeId === id)?.issues ?? null;
  }
}

/** Twelve active employees, enough for the completeness check to apply. */
const staff = () => Array.from({ length: 12 }, (_, i) => wovenEmployee(String(7000 + i)));
const LEAVER = "7003";
const VANISHED = "7007";
const FORMER = "9999";

function setup(extra: Partial<Parameters<typeof createFakeWoven>[0]> = {}) {
  const fake = createFakeWoven({ employees: staff(), tokenLifetimeSeconds: 3600, listReadsOmitTerminated: true, ...extra });
  const store = new CapturingStore();
  const raw = (dryRun = false): Promise<SyncOutcome> =>
    runWovenEmployeeSync({
      requestedBy: "cron",
      config: CONFIG,
      store,
      now: NOW,
      dryRun,
      client: new WovenClient({ baseUrl: CONFIG.baseUrl, credentials: FAKE_CREDENTIALS, fetch: fake.fetch, sleep: async () => {} }),
    });
  const run = async (dryRun = false) => {
    const outcome = await raw(dryRun);
    if (outcome.status !== "succeeded") throw new Error(JSON.stringify(outcome));
    return outcome.summary;
  };
  /** Woven terminates someone: their own Status becomes Terminated, so the lists drop them. */
  const terminate = (id: string, terminationDate = "2026-10-01T00:00:00") => {
    fake.state.employees = fake.state.employees.map((e) =>
      e.EmployeeID === id ? { ...e, Status: TERMINATED, TerminationDate: terminationDate } : e,
    );
  };
  /** Someone disappears from every read Woven offers, with no status at all. */
  const vanish = (id: string) => {
    fake.state.employees = fake.state.employees.filter((e) => e.EmployeeID !== id);
  };
  const rehire = (id: string) => {
    fake.state.employees = fake.state.employees.map((e) =>
      e.EmployeeID === id ? { ...e, Status: ACTIVE, StartDate: "2026-10-02T00:00:00" } : e,
    );
  };
  return { fake, store, run, raw, terminate, vanish, rehire };
}

const row = (store: MemoryDirectoryStore, id: string) => store.rows.get(id)!;
const kindsFor = (store: MemoryDirectoryStore, id: string) => store.changes.filter((c) => c.externalEmployeeId === id).map((c) => c.kind);

describe("the fake reproduces Production's shape", () => {
  it("a terminated employee is in neither list read, only in the terminated-status filter", async () => {
    const { fake, run, terminate } = setup();
    terminate(LEAVER);
    await run(true);
    const lists = fake.calls.filter((c) => c.path === "/employees" && c.query.employeestatus === undefined);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    expect(lists.some((c) => c.query.includeterminatedemployee === "true")).toBe(true);
  });
});

describe("termination: Woven's terminated-status read, matched by EmployeeID against the directory on file", { timeout: 60_000 }, () => {
  it("REPRODUCTION: on file Active, then gone from both lists and Terminated in the filter → stored terminated, one terminated change", async () => {
    const { store, run, terminate } = setup();
    await run();
    expect(row(store, LEAVER).employmentStatus).toBe("active");

    terminate(LEAVER);
    const summary = await run();

    const stored = row(store, LEAVER);
    expect(stored.employmentStatus).toBe("terminated");
    expect(stored.employmentStatusCode).toBe(TERMINATED);
    expect(stored.terminationDate).toBe("2026-10-01");
    /* Observed this run, so not counted missing. */
    expect(stored.missingSyncCount).toBe(0);
    expect(observedStatus(stored)).toBe("terminated");
    expect(store.issuesOf(LEAVER)).toContain("status_from_terminated_read");

    const terminated = store.changes.filter((c) => c.kind === "terminated");
    expect(terminated.map((c) => c.externalEmployeeId)).toEqual([LEAVER]);
    expect(terminated[0]!.effectiveDate).toBe("2026-10-01");

    expect(summary.employeesTerminated).toBe(1);
    expect(summary.employeesMissing).toBe(0);
    expect(summary.issueCounts.terminated_status_read_matched_on_file).toBe(1);
    /* Nobody else moved. */
    expect([...store.rows.values()].filter((r) => r.employmentStatus === "terminated")).toHaveLength(1);
  });

  it("the next runs: still Terminated in Woven → no second terminated change, still observed, zero changes", async () => {
    const { store, run, terminate } = setup();
    await run();
    terminate(LEAVER);
    await run();
    const third = await run();
    const fourth = await run();
    expect(kindsFor(store, LEAVER).filter((k) => k === "terminated")).toHaveLength(1);
    expect(row(store, LEAVER).missingSyncCount).toBe(0);
    expect(Object.values(third.changesByKind).reduce((a, b) => a + b, 0)).toBe(0);
    expect(Object.values(fourth.changesByKind).reduce((a, b) => a + b, 0)).toBe(0);
    expect(third.employeesTerminated).toBe(1);
  });

  it("CONTROL — absence is NOT termination: gone from every read → status kept, miss counted, observed status unknown, no terminated change", async () => {
    const { store, run, vanish } = setup();
    await run();
    vanish(VANISHED);
    await run();
    await run();
    const stored = row(store, VANISHED);
    expect(stored.employmentStatus).toBe("active");
    expect(stored.missingSyncCount).toBe(2);
    expect(observedStatus(stored)).toBe("unknown");
    expect(kindsFor(store, VANISHED)).not.toContain("terminated");
    /* The third miss records missing_from_source — review only, still not a termination. */
    await run();
    expect(kindsFor(store, VANISHED)).toContain("missing_from_source");
    expect(kindsFor(store, VANISHED)).not.toContain("terminated");
    expect(row(store, VANISHED).employmentStatus).toBe("active");
  });

  it("a terminated read that fails terminates no one: the leaver stays as on file, missing, observed unknown", async () => {
    const { store, run, terminate, fake } = setup();
    await run();
    terminate(LEAVER);
    fake.override((c) => c.path === "/employees" && c.query.employeestatus !== undefined, () => fake.json({ message: "bad filter" }, 400), 1);
    const summary = await run();
    expect(summary.issueCounts.terminated_status_read_failed_request_rejected).toBe(1);
    expect(row(store, LEAVER).employmentStatus).toBe("active");
    expect(row(store, LEAVER).missingSyncCount).toBe(1);
    expect(observedStatus(row(store, LEAVER))).toBe("unknown");
    expect(kindsFor(store, LEAVER)).not.toContain("terminated");

    /* The read recovers the next day: the termination is then recorded, once. */
    await run();
    expect(row(store, LEAVER).employmentStatus).toBe("terminated");
    expect(row(store, LEAVER).missingSyncCount).toBe(0);
    expect(kindsFor(store, LEAVER).filter((k) => k === "terminated")).toHaveLength(1);
  });

  it("returned by the filter while its OWN Status is not Terminated: proves nothing — not received, not terminated", async () => {
    const { store, run, vanish, fake } = setup();
    await run();
    const copy = { ...fake.state.employees.find((e) => e.EmployeeID === VANISHED)! };
    vanish(VANISHED);
    fake.override(
      (c) => c.path === "/employees" && c.query.employeestatus !== undefined && (c.query.queryskip ?? "0") === "0",
      () => fake.json([copy]),
    );
    const summary = await run();
    expect(summary.issueCounts.terminated_status_read_on_file_not_terminated).toBe(1);
    expect(row(store, VANISHED).employmentStatus).toBe("active");
    expect(row(store, VANISHED).missingSyncCount).toBe(1);
    expect(kindsFor(store, VANISHED)).not.toContain("terminated");
  });

  it("former staff only the filter returns, never on file, are counted and NOT imported", async () => {
    const former = wovenEmployee(FORMER, { status: TERMINATED, terminationDate: "2024-01-01T00:00:00" });
    const { store, run } = setup({ employees: [...staff(), former] });
    await run();
    const summary = await run();
    expect(store.rows.has(FORMER)).toBe(false);
    expect(summary.issueCounts.terminated_status_read_not_in_list_reads).toBe(1);
    expect(summary.issueCounts.terminated_status_read_matched_on_file).toBeUndefined();
    expect(summary.diagnostics!.statusReads).toMatchObject({ terminatedStatusMatchedOnFile: 0, terminatedStatusNotInListReads: 1 });
  });

  it("an Unknown Woven status stays unknown — never terminated", async () => {
    const { store, run, fake } = setup();
    await run();
    fake.state.employees = fake.state.employees.map((e) => (e.EmployeeID === LEAVER ? { ...e, Status: FAKE_STATUS.onLeave } : e));
    await run();
    expect(row(store, LEAVER).employmentStatus).not.toBe("terminated");
    expect(kindsFor(store, LEAVER)).not.toContain("terminated");
  });

  it("rehire: terminated via the filter, then Active in the list reads again → one reactivated change, classified rehire", async () => {
    const { store, run, terminate, rehire } = setup();
    await run();
    terminate(LEAVER);
    await run();
    rehire(LEAVER);
    await run();
    const stored = row(store, LEAVER);
    expect(stored.employmentStatus).toBe("active");
    expect(observedStatus(stored)).toBe("active");
    const reactivated = store.changes.filter((c) => c.externalEmployeeId === LEAVER && c.kind === "reactivated");
    expect(reactivated).toHaveLength(1);
    expect(reactivated[0]!.classification).toBe("rehire");
  });

  it("several leavers at once are each matched by their own EmployeeID — explained departures do not trip the completeness check", async () => {
    const { store, run, terminate } = setup();
    await run();
    for (const id of ["7001", "7002", "7010"]) terminate(id);
    const summary = await run();
    expect(summary.issueCounts.terminated_status_read_matched_on_file).toBe(3);
    expect(
      [...store.rows.values()]
        .filter((r) => r.employmentStatus === "terminated")
        .map((r) => r.externalEmployeeId)
        .sort(),
    ).toEqual(["7001", "7002", "7010"]);
  });

  it("the completeness check still refuses a read where actives vanish WITHOUT a Terminated status", async () => {
    const { store, run, raw, vanish } = setup();
    await run();
    for (const id of ["7001", "7002", "7010"]) vanish(id);
    const outcome = await raw();
    expect(outcome).toMatchObject({ status: "rejected", code: "unexpectedly_small" });
    /* A refused run saves nothing: nobody's miss count moved. */
    expect([...store.rows.values()].every((r) => r.missingSyncCount === 0)).toBe(true);
  });

  it("the dry run reports the on-file matches and writes nothing", async () => {
    const { store, run, terminate } = setup();
    await run();
    terminate(LEAVER);
    const before = structuredClone([...store.rows.values()]);
    const summary = await run(true);
    expect(summary.diagnostics!.statusReads).toMatchObject({ terminatedStatusRead: "read", terminatedStatusMatchedOnFile: 1 });
    expect(summary.employeesTerminated).toBe(1);
    expect([...store.rows.values()]).toEqual(before);
    expect(JSON.stringify(summary.diagnostics)).not.toContain(LEAVER);
  });
});

describe("observedStatus", () => {
  it("is the stored status only when the employee was in the latest stored run", () => {
    expect(observedStatus({ employmentStatus: "active", missingSyncCount: 0 })).toBe("active");
    expect(observedStatus({ employmentStatus: "terminated", missingSyncCount: 0 })).toBe("terminated");
    expect(observedStatus({ employmentStatus: "unknown", missingSyncCount: 0 })).toBe("unknown");
    expect(observedStatus({ employmentStatus: "active", missingSyncCount: 1 })).toBe("unknown");
    expect(observedStatus({ employmentStatus: "terminated", missingSyncCount: 4 })).toBe("unknown");
  });
});
