import { describe, expect, it } from "vitest";

import { WovenClient } from "./client";
import { readWovenConfig } from "./config";
import { statusResolver, parseEnums } from "./enums";
import { MemoryDirectoryStore } from "./memory-store";
import { resolveStatusAcrossReads, terminatedStatusCodes } from "./status-evidence";
import type { EmployeeWrite } from "./store";
import { runWovenEmployeeSync, type SyncOutcome } from "./sync";
import { createFakeWoven, FAKE_CREDENTIALS, FAKE_ENUMS, FAKE_STATUS, wovenDetails, wovenEmployee } from "./test-support";

/**
 * ============================================================================
 * THE TERMINATED-STATUS DISCREPANCY — one EmployeeID, reads that disagree
 * ============================================================================
 *
 * Reported in Production: an employee Woven's UI shows as Terminated stayed
 * Active in Ask Sunny. The run reads each EmployeeID several times (default
 * list, with-terminated list, and now Woven's terminated-status filter and
 * details). It used to keep the FIRST version it saw, so an Active copy in the
 * default read overwrote a Terminated one from a later read. These tests pin
 * the fix: a read whose own Status says Terminated wins — and a date alone
 * still never terminates anyone.
 */

const CONFIG = readWovenConfig({
  WOVEN_SYNC_ENABLED: "true",
  WOVEN_SYNC_WRITES_ENABLED: "true",
  WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
  WOVEN_USERNAME: FAKE_CREDENTIALS.username,
  WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
  WOVEN_PAGE_SIZE: "25",
});
const NOW = () => new Date("2026-09-30T11:17:00Z");
const { active: ACTIVE, terminated: TERMINATED } = FAKE_STATUS;
const ALYSSA = "b392525a-2ef6-4505-b985-df043bdb7b75";

/** Alyssa's shape: Active Status, TerminationDate 2026-05-04, TerminationType 0, no last day worked. */
const alyssa = () =>
  wovenEmployee(ALYSSA, { hireDate: "2025-12-03T00:00:00", startDate: null, terminationDate: "2026-05-04T00:00:00", terminationType: 0 });
const colleagues = () => Array.from({ length: 11 }, (_, i) => wovenEmployee(String(5000 + i)));

/** The memory store drops issue codes on save; this keeps the last commit's payload so the tests can read them. */
class CapturingStore extends MemoryDirectoryStore {
  lastWrites: EmployeeWrite[] = [];
  override async commitRun(input: Parameters<MemoryDirectoryStore["commitRun"]>[0]) {
    this.lastWrites = input.employees;
    return super.commitRun(input);
  }
  issuesOf(id: string) {
    return this.lastWrites.find((w) => w.externalEmployeeId === id)!.issues;
  }
}

function setup(extra: Partial<Parameters<typeof createFakeWoven>[0]> = {}) {
  const fake = createFakeWoven({ employees: [alyssa(), ...colleagues()], tokenLifetimeSeconds: 3600, ...extra });
  const store = new CapturingStore();
  const run = async (dryRun = false) => {
    const outcome: SyncOutcome = await runWovenEmployeeSync({
      requestedBy: "cron",
      config: CONFIG,
      store,
      now: NOW,
      dryRun,
      client: new WovenClient({ baseUrl: CONFIG.baseUrl, credentials: FAKE_CREDENTIALS, fetch: fake.fetch, sleep: async () => {} }),
    });
    if (outcome.status !== "succeeded") throw new Error(JSON.stringify(outcome));
    return outcome.summary;
  };
  return { fake, store, run };
}

describe("resolveStatusAcrossReads", () => {
  it("a Terminated read wins wherever it comes in the order", () => {
    for (const reads of [
      ["active", "terminated"],
      ["terminated", "active"],
      ["active", "active", "terminated"],
    ] as const) {
      const out = resolveStatusAcrossReads(reads.map((status, i) => ({ read: `r${i}`, status, code: status === "terminated" ? 2 : 1 })));
      expect(out.status, reads.join(",")).toBe("terminated");
      expect(out.code).toBe(2);
      expect(out.disagrees).toBe(true);
    }
  });

  it("agreeing reads keep the first version and are not flagged", () => {
    expect(resolveStatusAcrossReads([{ read: "a", status: "active", code: 1 }, { read: "b", status: "active", code: 1 }])).toEqual({
      winner: 0,
      status: "active",
      code: 1,
      disagrees: false,
    });
  });

  it("an unknown status never beats Active, but the disagreement is flagged", () => {
    const out = resolveStatusAcrossReads([{ read: "a", status: "active", code: 1 }, { read: "b", status: "unknown", code: 3 }]);
    expect(out).toMatchObject({ status: "active", disagrees: true });
  });

  it("finds the Terminated code(s) from /lists/enums", () => {
    expect(terminatedStatusCodes(statusResolver(parseEnums(FAKE_ENUMS)))).toEqual([TERMINATED]);
    expect(terminatedStatusCodes(statusResolver(null))).toEqual([]);
  });
});

describe("the sync: an explicit Terminated result wins for the same EmployeeID", { timeout: 60_000 }, () => {
  it("REPRODUCTION: default read Active, with-terminated read Terminated → stored Terminated (first-seen-wins kept Active)", async () => {
    let split = false;
    const { store, run } = setup({ statusInRead: (read, id) => (split && id === ALYSSA && read !== "current" ? TERMINATED : undefined) });
    await run();
    expect(store.rows.get(ALYSSA)!.employmentStatus).toBe("active");

    /* Woven now answers differently per read for the same EmployeeID. */
    split = true;
    const summary = await run();
    const second = { store };

    const stored = second.store.rows.get(ALYSSA)!;
    expect(stored.employmentStatus).toBe("terminated");
    expect(stored.employmentStatusCode).toBe(TERMINATED);
    expect(second.store.issuesOf(ALYSSA)).toContain("status_differs_between_reads");
    expect(second.store.issuesOf(ALYSSA)).not.toContain("status_termination_conflict");
    /* History: one terminated event, dated by Woven's own TerminationDate. */
    const terminated = second.store.changes.filter((c) => c.kind === "terminated");
    expect(terminated.map((c) => c.externalEmployeeId)).toEqual([ALYSSA]);
    expect(terminated[0]!.effectiveDate).toBe("2026-05-04");
    expect(summary.issueCounts.status_differs_between_reads).toBe(1);
    expect(summary.employeesTerminated).toBe(1);
    /* Nobody else moved. */
    expect([...second.store.rows.values()].filter((r) => r.employmentStatus === "terminated")).toHaveLength(1);
  });

  it("Woven's terminated-status filter returning her with Status Terminated wins over two Active list reads", async () => {
    const { store, run, fake } = setup({ statusInRead: (read, id) => (id === ALYSSA && read === "terminated_status" ? TERMINATED : undefined) });
    const summary = await run();
    expect(store.rows.get(ALYSSA)!.employmentStatus).toBe("terminated");
    expect(store.issuesOf(ALYSSA)).toContain("status_differs_between_reads");
    /* The filter read is the spec's own: employeestatus=<Terminated> with terminated included. */
    const filterCalls = fake.calls.filter((c) => c.path === "/employees" && c.query.employeestatus !== undefined);
    expect(filterCalls.length).toBeGreaterThan(0);
    expect(filterCalls.every((c) => c.query.employeestatus === String(TERMINATED) && c.query.includeterminatedemployee === "true")).toBe(true);
  });

  it("a Terminated details Status wins over an Active list row, and past-TerminationDate employees always get that details read", async () => {
    const details = {
      /* Details say Terminated; her one location is settled by the list, so only the status check reads it. */
      [ALYSSA]: { ...wovenDetails(ALYSSA, [{ id: "WL-0306" }]), Status: TERMINATED },
    };
    const { store, run, fake } = setup({ details });
    await run();
    expect(fake.calls.some((c) => c.path === `/employees/${ALYSSA}/details`)).toBe(true);
    expect(fake.calls.filter((c) => c.path.endsWith("/details"))).toHaveLength(1);
    expect(store.rows.get(ALYSSA)!.employmentStatus).toBe("terminated");
    expect(store.issuesOf(ALYSSA)).toEqual(expect.arrayContaining(["status_differs_between_reads"]));
    expect(store.issuesOf(ALYSSA)).not.toContain("status_termination_conflict");
  });

  it("CONTROL — Alyssa as Production shows her today: Active in every read, past TerminationDate → stays Active, flagged, no termination", async () => {
    const { store, run } = setup({ details: { [ALYSSA]: { ...wovenDetails(ALYSSA, [{ id: "WL-0306" }]), Status: ACTIVE } } });
    await run();
    expect(store.rows.get(ALYSSA)!.employmentStatus).toBe("active");
    expect(store.issuesOf(ALYSSA)).toContain("status_termination_conflict");
    expect(store.issuesOf(ALYSSA)).not.toContain("status_differs_between_reads");
    expect(store.issuesOf(ALYSSA)).not.toContain("terminated_filter_lists_active");
    expect(store.changes.some((c) => c.kind === "terminated")).toBe(false);
  });

  it("returned by the terminated filter while its own Status says Active: flagged for review, never terminated", async () => {
    const { store, run, fake } = setup();
    fake.override(
      (c) => c.path === "/employees" && c.query.employeestatus !== undefined && (c.query.queryskip ?? "0") === "0",
      () => fake.json([alyssa()]),
    );
    const summary = await run();
    expect(store.rows.get(ALYSSA)!.employmentStatus).toBe("active");
    expect(store.issuesOf(ALYSSA)).toEqual(expect.arrayContaining(["status_termination_conflict", "terminated_filter_lists_active"]));
    expect(summary.issueCounts.terminated_status_read_status_active).toBe(1);
  });

  it("someone only the terminated filter returns is counted, not imported", async () => {
    const former = wovenEmployee("9999", { status: TERMINATED, terminationDate: "2025-01-01T00:00:00" });
    const { store, run, fake } = setup();
    /* Neither list read returns 9999; the filter does. */
    fake.override(
      (c) => c.path === "/employees" && c.query.employeestatus !== undefined && (c.query.queryskip ?? "0") === "0",
      () => fake.json([former]),
    );
    const summary = await run();
    expect(store.rows.has("9999")).toBe(false);
    expect(summary.issueCounts.terminated_status_read_not_in_list_reads).toBe(1);
    expect(summary.employeesReceived).toBe(12);
  });

  it("a failing terminated-status read never fails the run and changes no status", async () => {
    const { store, run, fake } = setup();
    fake.override((c) => c.path === "/employees" && c.query.employeestatus !== undefined, () => fake.json({ message: "bad filter" }, 400), 5);
    const summary = await run();
    expect(summary.issueCounts.terminated_status_read_failed_request_rejected).toBe(1);
    expect(store.rows.get(ALYSSA)!.employmentStatus).toBe("active");
    expect(store.rows.size).toBe(12);
  });

  it("the dry run reports what each read said, counts only", async () => {
    const { run } = setup({ statusInRead: (read, id) => (id === ALYSSA && read === "with_terminated" ? TERMINATED : undefined) });
    const summary = await run(true);
    const d = summary.diagnostics!;
    expect(d.statusReads).toMatchObject({
      currentRecords: 12,
      withTerminatedRecords: 12,
      withTerminatedAdded: 0,
      terminatedStatusRead: "read",
      terminatedStatusCodes: [TERMINATED],
      /* Her own Status is Active in the filter read here, so Woven's filter does not return her. */
      terminatedStatusRecords: 0,
      terminatedStatusMatched: 0,
      terminatedStatusNotInListReads: 0,
      statusDiffersBetweenReads: 1,
    });
    expect(d.pastTerminationDate).toMatchObject({ total: 1, activeInEveryRead: 0, terminatedInWoven: 1, statusDiffersBetweenReads: 1 });
    expect(JSON.stringify(d)).not.toContain(ALYSSA);
  });

  describe("per-read evidence on the row: what each Woven read said", () => {
    const readCodes = (issues: string[]) => issues.filter((i) => i.startsWith("status_read_")).sort();

    it("Alyssa as today: Active in both lists, not returned by the filter, Active in details", async () => {
      const { store, run } = setup({ details: { [ALYSSA]: { ...wovenDetails(ALYSSA, [{ id: "WL-0306" }]), Status: ACTIVE } } });
      const summary = await run();
      expect(readCodes(store.issuesOf(ALYSSA))).toEqual([
        "status_read_current_active",
        "status_read_details_active",
        "status_read_terminated_status_not_returned",
        "status_read_with_terminated_active",
      ]);
      expect(store.rows.get(ALYSSA)!.employmentStatus).toBe("active");
      /* The same codes are totalled on the run. */
      expect(summary.issueCounts.status_read_terminated_status_not_returned).toBe(1);
    });

    it("the reproduction: the with-terminated read and the filter say Terminated; the row says which", async () => {
      const { store, run } = setup({ statusInRead: (read, id) => (id === ALYSSA && read !== "current" ? TERMINATED : undefined) });
      await run();
      expect(readCodes(store.issuesOf(ALYSSA))).toEqual([
        "status_read_current_active",
        "status_read_terminated_status_terminated",
        "status_read_with_terminated_terminated",
      ]);
      expect(store.rows.get(ALYSSA)!.employmentStatus).toBe("terminated");
    });

    it("says why details gave no Status: not found, or no Status field", async () => {
      const notFound = setup();
      await notFound.run();
      expect(notFound.store.issuesOf(ALYSSA)).toContain("status_read_details_not_found");

      const noStatus = setup({ details: { [ALYSSA]: wovenDetails(ALYSSA, [{ id: "WL-0306" }]) } });
      await noStatus.run();
      expect(noStatus.store.issuesOf(ALYSSA)).toContain("status_read_details_no_status");
    });

    it("a failed filter read claims nothing about it; colleagues with no past TerminationDate get no evidence codes", async () => {
      const { store, run, fake } = setup();
      fake.override((c) => c.path === "/employees" && c.query.employeestatus !== undefined, () => fake.json({ message: "bad filter" }, 400), 5);
      await run();
      expect(store.issuesOf(ALYSSA)).not.toContain("status_read_terminated_status_not_returned");
      expect(readCodes(store.issuesOf("5000"))).toEqual([]);
    });
  });
});

