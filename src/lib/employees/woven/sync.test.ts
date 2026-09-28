import { describe, expect, it } from "vitest";

import { WovenClient } from "./client";
import { readWovenConfig } from "./config";
import { MemoryDirectoryStore } from "./memory-store";
import { outcomeHttpStatus, runWovenEmployeeSync, validateRead, type SyncOutcome } from "./sync";
import {
  createFakeWoven,
  FAKE_CREDENTIALS,
  SENSITIVE_MARKER,
  wovenDetails,
  wovenEmployee,
  type FixtureEmployeeOptions,
} from "./test-support";

/**
 * ============================================================================
 * THE SYNC, END TO END — fake Woven, real client, in-memory directory
 * ============================================================================
 *
 * The client is the real `WovenClient` over a fake Operations API; the store
 * is `MemoryDirectoryStore`, which mirrors the SQL functions' semantics. The
 * SQL itself is exercised separately against Postgres (see
 * `scripts/verify-woven-migration.mjs`); nothing here claims otherwise.
 */

const CONFIG = readWovenConfig({
  WOVEN_SYNC_ENABLED: "true",
  WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
  WOVEN_USERNAME: FAKE_CREDENTIALS.username,
  WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
  WOVEN_PAGE_SIZE: "25",
});

const NOW = () => new Date("2026-09-28T12:00:00Z");

function estate(count: number, options: FixtureEmployeeOptions = {}) {
  return Array.from({ length: count }, (_, i) => wovenEmployee(String(1000 + i), options));
}

function setup(employees: Record<string, unknown>[], details: Record<string, Record<string, unknown>> = {}) {
  const fake = createFakeWoven({ employees, details, tokenLifetimeSeconds: 3600 });
  const store = new MemoryDirectoryStore();
  const run = (overrides: Partial<Parameters<typeof runWovenEmployeeSync>[0]> = {}) =>
    runWovenEmployeeSync({
      requestedBy: "cron",
      config: CONFIG,
      store,
      now: NOW,
      client: new WovenClient({
        baseUrl: CONFIG.baseUrl,
        credentials: FAKE_CREDENTIALS,
        fetch: fake.fetch,
        sleep: async () => {},
      }),
      ...overrides,
    });
  return { fake, store, run };
}

function succeeded(outcome: SyncOutcome) {
  if (outcome.status !== "succeeded") throw new Error(`expected success, got ${JSON.stringify(outcome)}`);
  return outcome.summary;
}

const row = (store: MemoryDirectoryStore, id: string) => store.rows.get(id)!;
const changesOf = (store: MemoryDirectoryStore, runId: string) =>
  store.changes.filter((c) => c.runId === runId).map((c) => [c.externalEmployeeId, c.kind]);

describe("switches and configuration", () => {
  it("does nothing while WOVEN_SYNC_ENABLED is off", async () => {
    const { run, fake } = setup(estate(3));
    const outcome = await run({ config: readWovenConfig({}) });
    expect(outcome.status).toBe("disabled");
    expect(fake.calls).toHaveLength(0);
  });

  it("names the missing credentials", async () => {
    const { run } = setup(estate(3));
    const outcome = await run({ config: readWovenConfig({ WOVEN_SYNC_ENABLED: "1", WOVEN_USERNAME: "x" }) });
    expect(outcome).toEqual({ status: "not_configured", missing: ["WOVEN_SUBSCRIPTION_KEY", "WOVEN_PASSWORD"] });
  });

  it("refuses to start while another run holds the lock", async () => {
    const { run, store } = setup(estate(3));
    await store.claimRun("someone-else");
    expect((await run()).status).toBe("busy");
  });
});

describe("the first sync", () => {
  it("syncs active AND terminated employees across pages", async () => {
    const employees = [
      ...estate(60),
      wovenEmployee("T1", { status: "Terminated", terminationDate: "2026-06-30T00:00:00" }),
      wovenEmployee("T2", { status: "Terminated", terminationDate: "2025-12-31T00:00:00" }),
    ];
    const { run, store, fake } = setup(employees);

    const summary = succeeded(await run());

    expect(summary.employeesReceived).toBe(62);
    expect(summary.employeesActive).toBe(60);
    expect(summary.employeesTerminated).toBe(2);
    expect(summary.employeesCreated).toBe(62);
    expect(store.rows.size).toBe(62);
    expect(row(store, "T1")).toMatchObject({ employmentStatus: "terminated", terminationDate: "2026-06-30" });

    const passes = fake.calls.filter((c) => c.path === "/employees").map((c) => c.query.status);
    expect(new Set(passes)).toEqual(new Set(["Active", "Terminated"]));
    expect(summary.pagesFetched).toBeGreaterThanOrEqual(4);
  });

  it("records every employee as new, flagged as the initial load", async () => {
    const { run, store } = setup(estate(3));
    await run();
    expect(store.changes.map((c) => [c.kind, c.details.initialLoad])).toEqual([
      ["new_employee", true],
      ["new_employee", true],
      ["new_employee", true],
    ]);
  });

  it("stores nothing outside the allowlist", async () => {
    const { run, store } = setup(estate(3, { hasMultipleLocations: true }), {
      "1000": wovenDetails("1000", [{ id: "WL-0306", primary: true }, { id: "WL-0144" }]),
    });
    await run();
    const everything = JSON.stringify({ rows: [...store.rows.values()], changes: store.changes });
    expect(everything).not.toContain(SENSITIVE_MARKER);
  });

  it("never leaks a name or an email into the run outcome", async () => {
    const { run } = setup(estate(3, { firstName: "Quinlan", workEmail: "quinlan@suntancity.test" }));
    const outcome = await run();
    expect(JSON.stringify(outcome)).not.toMatch(/Quinlan|quinlan@/i);
  });
});

describe("re-running", () => {
  it("is idempotent: the same read twice records no changes and no duplicates", async () => {
    const { run, store } = setup(estate(30));
    const first = await run();
    const second = await run();

    const summary = succeeded(second);
    expect(summary.employeesCreated).toBe(0);
    expect(summary.employeesUnchanged).toBe(30);
    expect(Object.values(summary.changesByKind).reduce((a, b) => a + b, 0)).toBe(0);
    expect(store.rows.size).toBe(30);
    expect(changesOf(store, (second as { runId: string }).runId)).toEqual([]);
    expect(first.status).toBe("succeeded");
  });
});

describe("changes between syncs", () => {
  it("new employee, termination, reactivation, position change and transfer", async () => {
    const base = [
      wovenEmployee("A"),
      wovenEmployee("B"),
      wovenEmployee("C", { status: "Terminated", terminationDate: "2026-01-31" }),
      wovenEmployee("D"),
    ];
    const { run, store, fake } = setup(base);
    await run();

    fake.state.employees = [
      wovenEmployee("A", { status: "Terminated", terminationDate: "2026-09-20" }),
      wovenEmployee("B", { positionId: "POS-SD", positionName: "Salon Director" }),
      wovenEmployee("C", { status: "Active" }),
      wovenEmployee("D", { primaryLocationId: "WL-0144", primaryLocationName: "NE Lincoln" }),
      wovenEmployee("E"),
    ];
    const outcome = await run();
    const runId = (outcome as { runId: string }).runId;

    expect(changesOf(store, runId).sort()).toEqual(
      [
        ["A", "terminated"],
        ["B", "position_changed"],
        ["C", "reactivated"],
        ["D", "primary_location_changed"],
        ["E", "new_employee"],
      ].sort(),
    );
    const position = store.changes.find((c) => c.runId === runId && c.kind === "position_changed")!;
    expect(position.details).toEqual({ direction: "unclassified" });
    expect(store.changes.find((c) => c.runId === runId && c.kind === "new_employee")!.details).toEqual({
      initialLoad: false,
    });
  });

  it("detects added and removed affiliations, including borrowed ones", async () => {
    const employees = [wovenEmployee("M", { hasMultipleLocations: true })];
    const { run, store, fake } = setup(employees, {
      M: wovenDetails("M", [{ id: "WL-0306", primary: true }, { id: "WL-0144" }]),
    });
    await run();
    expect(row(store, "M").affiliations.map((a) => [a.wovenLocationId, a.kind])).toEqual([
      ["WL-0306", "primary"],
      ["WL-0144", "additional"],
    ]);

    fake.state.details.M = wovenDetails("M", [
      { id: "WL-0306", primary: true },
      { id: "WL-0200", borrowed: true, expires: "2026-10-31" },
    ]);
    const outcome = await run();
    const runId = (outcome as { runId: string }).runId;

    expect(changesOf(store, runId).sort()).toEqual(
      [
        ["M", "location_affiliation_added"],
        ["M", "location_affiliation_removed"],
      ].sort(),
    );
    const added = store.changes.find((c) => c.runId === runId && c.kind === "location_affiliation_added")!;
    expect(added.toValue).toMatchObject({ wovenLocationId: "WL-0200", kind: "temporary", expiresOn: "2026-10-31" });
  });

  it("keeps affiliations on file, and records no removal, when details could not be read", async () => {
    const { run, store, fake } = setup([wovenEmployee("M", { hasMultipleLocations: true })], {
      M: wovenDetails("M", [{ id: "WL-0306", primary: true }, { id: "WL-0144" }]),
    });
    await run();

    fake.override((c) => c.path.endsWith("/details"), () => fake.json({}, 500), 10);
    const outcome = await run();
    const summary = succeeded(outcome);

    expect(summary.detailsSkipped).toBe(1);
    expect(summary.issueCounts.details_interrupted_server_error).toBe(1);
    expect(row(store, "M").affiliations.map((a) => a.wovenLocationId)).toEqual(["WL-0306", "WL-0144"]);
    expect(changesOf(store, (outcome as { runId: string }).runId)).toEqual([]);
  });

  it("respects the details budget and reads the least-recently-verified first next time", async () => {
    const employees = ["P", "Q", "R"].map((id) => wovenEmployee(id, { hasMultipleLocations: true }));
    const details = Object.fromEntries(["P", "Q", "R"].map((id) => [id, wovenDetails(id, [{ id: "WL-0306", primary: true }])]));
    const { run, fake } = setup(employees, details);
    const config = readWovenConfig({ ...process.env, ...envOf(CONFIG), WOVEN_MAX_DETAIL_REQUESTS_PER_RUN: "2" });

    const first = succeeded(await run({ config }));
    expect(first.detailsFetched).toBe(2);
    expect(first.detailsSkipped).toBe(1);
    expect(first.issueCounts.affiliations_not_verified).toBe(1);

    fake.calls.length = 0;
    await run({ config });
    const read = fake.calls.filter((c) => c.path.endsWith("/details")).map((c) => c.path);
    expect(read[0]).toBe("/employees/R/details");
  });
});

describe("absence is not termination", () => {
  it("keeps an employee missing from one run, raises the miss count, and changes no status", async () => {
    const { run, store, fake } = setup([wovenEmployee("A"), wovenEmployee("B")]);
    await run();

    fake.state.employees = [wovenEmployee("A")];
    const summary = succeeded(await run());

    expect(summary.employeesMissing).toBe(1);
    expect(store.rows.size).toBe(2);
    expect(row(store, "B")).toMatchObject({ employmentStatus: "active", missingSyncCount: 1 });
    expect(store.changes.some((c) => c.externalEmployeeId === "B" && c.kind === "terminated")).toBe(false);
  });

  it("records missing_from_source once, at three consecutive misses", async () => {
    const { run, store, fake } = setup([wovenEmployee("A"), wovenEmployee("B")]);
    await run();
    fake.state.employees = [wovenEmployee("A")];
    for (let i = 0; i < 4; i += 1) await run();

    expect(store.changes.filter((c) => c.externalEmployeeId === "B" && c.kind === "missing_from_source")).toHaveLength(1);
    expect(row(store, "B").employmentStatus).toBe("active");
  });

  it("resets the miss count when the employee comes back", async () => {
    const { run, store, fake } = setup([wovenEmployee("A"), wovenEmployee("B")]);
    await run();
    fake.state.employees = [wovenEmployee("A")];
    await run();
    fake.state.employees = [wovenEmployee("A"), wovenEmployee("B")];
    await run();
    expect(row(store, "B").missingSyncCount).toBe(0);
  });
});

describe("data quality is flagged, never fatal", () => {
  it("duplicate work email: flagged on every holder, both kept", async () => {
    const { run, store } = setup([
      wovenEmployee("A", { workEmail: "shared@suntancity.test" }),
      wovenEmployee("B", { workEmail: "Shared@SunTanCity.test" }),
      wovenEmployee("C"),
    ]);
    const summary = succeeded(await run());
    expect(row(store, "A").workEmail).toBe("shared@suntancity.test");
    expect(summary.issueCounts.duplicate_work_email).toBe(2);
    expect(store.rows.size).toBe(3);
  });

  it("missing email, missing PositionID and missing location sync with issue codes", async () => {
    const { run, store } = setup([
      wovenEmployee("A", { workEmail: null }),
      wovenEmployee("B", { positionId: null }),
      wovenEmployee("C", { primaryLocationId: null, primaryLocationName: null }),
    ]);
    const summary = succeeded(await run());
    expect(store.rows.size).toBe(3);
    expect(summary.issueCounts).toMatchObject({
      missing_work_email: 1,
      missing_position_id: 1,
      missing_primary_location: 1,
    });
    expect(row(store, "C").affiliations).toEqual([]);
  });

  it("unmapped location: queued for review, employees still synced, mapping never overwritten", async () => {
    const { run, store } = setup([wovenEmployee("A"), wovenEmployee("B", { primaryLocationId: "WL-0144" })]);
    const first = succeeded(await run());
    expect(first.unmappedLocations).toBe(2);
    expect(first.issueCounts.unmapped_location).toBe(2);
    expect([...store.locationMap.values()].every((l) => l.status === "unmapped")).toBe(true);

    store.mapLocation("WL-0306", "salon-uuid-0306");
    const second = succeeded(await run());
    expect(second.unmappedLocations).toBe(1);
    expect(store.locationMap.get("WL-0306")).toMatchObject({ status: "mapped", salonId: "salon-uuid-0306" });
  });

  it("a record with no employee id is rejected and counted; the rest sync", async () => {
    const bad = wovenEmployee("X");
    delete bad.EmployeeID;
    const { run, store } = setup([...estate(5), bad]);
    const summary = succeeded(await run());
    expect(summary.recordsRejected).toBe(1);
    expect(store.rows.size).toBe(5);
  });
});

describe("a read that cannot be trusted is refused, and the directory is untouched", () => {
  it("unexpectedly small sync", async () => {
    const { run, store, fake } = setup(estate(40));
    await run();
    const before = structuredClone([...store.rows.values()]);

    fake.state.employees = estate(20);
    const outcome = await run();

    expect(outcome.status).toBe("rejected");
    expect((outcome as { code: string }).code).toBe("unexpectedly_small");
    expect([...store.rows.values()]).toEqual(before);
    expect(store.runs.at(-1)).toMatchObject({ status: "rejected", errorCode: "unexpectedly_small" });
  });

  it("an empty read", async () => {
    const { run, store } = setup([]);
    const outcome = await run();
    expect(outcome).toMatchObject({ status: "rejected", code: "empty_read" });
    expect(store.rows.size).toBe(0);
  });

  it("partial-page failure: a page that keeps failing fails the whole run", async () => {
    const { run, store, fake } = setup(estate(60));
    await run();
    const before = structuredClone([...store.rows.values()]);

    fake.state.employees = estate(60, { positionId: "POS-NEW" });
    fake.override((c) => c.path === "/employees" && c.query.queryskip === "25", () => fake.json({}, 500), 10);
    const outcome = await run();

    expect(outcome).toMatchObject({ status: "failed", code: "woven_server_error" });
    expect([...store.rows.values()]).toEqual(before);
    expect(store.runs.at(-1)?.status).toBe("failed");
  });

  it("a mostly unreadable read", async () => {
    const rows = estate(10).map((r) => {
      const { EmployeeID: _id, ...rest } = r;
      void _id;
      return rest;
    });
    const { run } = setup([...rows, ...estate(2)]);
    expect(await run()).toMatchObject({ status: "rejected", code: "mostly_unreadable" });
  });

  it("a failure while saving leaves the directory as it was and closes the run", async () => {
    const { run, store, fake } = setup(estate(5));
    await run();
    const before = structuredClone([...store.rows.values()]);

    fake.state.employees = estate(5, { positionId: "POS-NEW" });
    store.failNextCommit = true;
    const outcome = await run();

    expect(outcome.status).toBe("failed");
    expect([...store.rows.values()]).toEqual(before);
    expect(store.runs.at(-1)?.status).toBe("failed");
  });
});

describe("API failures fail the run cleanly", () => {
  it("credential failure (401)", async () => {
    const { run, store } = setup(estate(5));
    const outcome = await run({
      client: new WovenClient({
        baseUrl: CONFIG.baseUrl,
        credentials: { ...FAKE_CREDENTIALS, password: "wrong" },
        fetch: createFakeWoven({ employees: estate(5) }).fetch,
        sleep: async () => {},
      }),
    });
    expect(outcome).toMatchObject({ status: "failed", code: "woven_auth_failed" });
    expect(outcomeHttpStatus(outcome)).toBe(502);
    expect(store.rows.size).toBe(0);
    expect(JSON.stringify(outcome)).not.toContain("wrong");
  });

  it("subscription not approved (403)", async () => {
    const { run, fake } = setup(estate(5));
    fake.override((c) => c.path === "/tokens/v2", () => fake.json({}, 403));
    expect(await run()).toMatchObject({ status: "failed", code: "woven_forbidden" });
  });

  it("rate limiting that never clears", async () => {
    const { run, fake } = setup(estate(5));
    fake.override((c) => c.path === "/employees", () => fake.json({}, 429, { "Retry-After": "1" }), 20);
    expect(await run()).toMatchObject({ status: "failed", code: "woven_rate_limited" });
  });

  it("rate limiting that clears is absorbed", async () => {
    const { run, fake } = setup(estate(5));
    fake.override((c) => c.path === "/employees", () => fake.json({}, 429, { "Retry-After": "2" }), 2);
    expect((await run()).status).toBe("succeeded");
  });
});

describe("dry run", () => {
  it("reads and compares but writes nothing and takes no lock", async () => {
    const { run, store } = setup(estate(5));
    const outcome = await run({ dryRun: true });
    const summary = succeeded(outcome);
    expect(summary.dryRun).toBe(true);
    expect(summary.changesByKind.new_employee).toBe(5);
    expect(summary.fieldCoverage).toMatchObject({ workEmail: 5, positionId: 5, primaryLocationId: 5, hireDate: 5 });
    expect(store.rows.size).toBe(0);
    expect(store.runs).toHaveLength(0);
  });

  it("still works before the migration exists", async () => {
    const { run, store } = setup(estate(5));
    store.loadDirectory = async () => {
      throw new Error("relation does not exist");
    };
    const summary = succeeded(await run({ dryRun: true }));
    expect(summary.issueCounts.directory_unavailable).toBe(1);
  });
});

describe("validateRead", () => {
  const base = { received: 100, rejected: 0, activeNow: 90, activeOnFile: 100, minCompletenessPercent: 80, shortPasses: [] };
  it("accepts a read at the threshold and refuses one below it", () => {
    expect(validateRead({ ...base, activeNow: 80 }).ok).toBe(true);
    expect(validateRead({ ...base, activeNow: 79 })).toMatchObject({ ok: false, code: "unexpectedly_small" });
  });
  it("does not apply the percentage to a tiny directory", () => {
    expect(validateRead({ ...base, activeOnFile: 5, activeNow: 1 }).ok).toBe(true);
  });
  it("refuses a read short of Woven's reported total", () => {
    expect(validateRead({ ...base, shortPasses: ["active"] })).toMatchObject({ ok: false, code: "count_mismatch" });
  });
});

function envOf(config: typeof CONFIG): Record<string, string> {
  return {
    WOVEN_SYNC_ENABLED: config.enabled ? "true" : "false",
    WOVEN_SUBSCRIPTION_KEY: config.credentials!.subscriptionKey,
    WOVEN_USERNAME: config.credentials!.username,
    WOVEN_PASSWORD: config.credentials!.password,
    WOVEN_PAGE_SIZE: String(config.pageSize),
  };
}
