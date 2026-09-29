import { describe, expect, it } from "vitest";

import { WovenClient } from "./client";
import { readWovenConfig } from "./config";
import { MemoryDirectoryStore } from "./memory-store";
import { outcomeHttpStatus, runWovenEmployeeSync, validateRead, type SyncOutcome } from "./sync";
import {
  createFakeWoven,
  FAKE_CREDENTIALS,
  FAKE_ENUMS,
  FAKE_STATUS,
  SENSITIVE_MARKER,
  wovenDetails,
  wovenEmployee,
  wovenLocation,
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

/* These tests exercise stored syncs, so both switches are on; the write switch has its own tests below. */
const CONFIG = readWovenConfig({
  WOVEN_SYNC_ENABLED: "true",
  WOVEN_SYNC_WRITES_ENABLED: "true",
  WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
  WOVEN_USERNAME: FAKE_CREDENTIALS.username,
  WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
  WOVEN_PAGE_SIZE: "25",
});

const NOW = () => new Date("2026-09-28T12:00:00Z");
const TERMINATED = FAKE_STATUS.terminated;
const ACTIVE = FAKE_STATUS.active;

function estate(count: number, options: FixtureEmployeeOptions = {}) {
  return Array.from({ length: count }, (_, i) => wovenEmployee(String(1000 + i), options));
}

function setup(
  employees: Record<string, unknown>[],
  details: Record<string, Record<string, unknown>> = {},
  extra: Partial<Parameters<typeof createFakeWoven>[0]> = {},
) {
  const fake = createFakeWoven({ employees, details, tokenLifetimeSeconds: 3600, ...extra });
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
const locationsOf = (store: MemoryDirectoryStore, id: string) =>
  store.activeAffiliations(id).map((a) => [a.wovenLocationId, a.accessType]);
const changesOf = (store: MemoryDirectoryStore, runId: string) =>
  store.changes.filter((c) => c.runId === runId).map((c) => [c.externalEmployeeId, c.kind]);

describe("switches and configuration", () => {
  it("does nothing while WOVEN_SYNC_ENABLED is off", async () => {
    const { run, fake } = setup(estate(3));
    const outcome = await run({ config: readWovenConfig({}) });
    expect(outcome.status).toBe("disabled");
    expect(fake.calls).toHaveLength(0);
  });

  it("does nothing — dry run or real — when only WOVEN_VALIDATION_ENABLED is on", async () => {
    const { run, fake, store } = setup(estate(3));
    const validationOnly = readWovenConfig({
      WOVEN_VALIDATION_ENABLED: "true",
      WOVEN_SYNC_ENABLED: "false",
      WOVEN_SUBSCRIPTION_KEY: "k",
      WOVEN_USERNAME: "u",
      WOVEN_PASSWORD: "p",
    });
    for (const dryRun of [true, false]) {
      expect((await run({ config: validationOnly, dryRun })).status).toBe("disabled");
    }
    expect(fake.calls).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it("names the missing credentials", async () => {
    const { run } = setup(estate(3));
    const outcome = await run({ config: readWovenConfig({ WOVEN_SYNC_ENABLED: "1", WOVEN_SYNC_WRITES_ENABLED: "1", WOVEN_USERNAME: "x" }) });
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
      wovenEmployee("T1", { status: TERMINATED, terminationDate: "2026-06-30T00:00:00" }),
      wovenEmployee("T2", { status: TERMINATED, terminationDate: "2025-12-31T00:00:00" }),
    ];
    const { run, store, fake } = setup(employees);

    const summary = succeeded(await run());

    expect(summary.employeesReceived).toBe(62);
    expect(summary.employeesActive).toBe(60);
    expect(summary.employeesTerminated).toBe(2);
    expect(summary.employeesCreated).toBe(62);
    expect(store.rows.size).toBe(62);
    expect(row(store, "T1")).toMatchObject({ employmentStatus: "terminated", terminationDate: "2026-06-30" });

    const passes = fake.calls.filter((c) => c.path === "/employees").map((c) => c.query.includeterminatedemployee ?? "default");
    expect(new Set(passes)).toEqual(new Set(["default", "true"]));
    expect(fake.calls.some((c) => c.path === "/lists/enums")).toBe(true);
    expect(summary.pagesFetched).toBeGreaterThanOrEqual(4);
  });

  it("records every employee as new, flagged as the initial load", async () => {
    const { run, store } = setup(estate(3));
    await run();
    expect(store.changes.map((c) => [c.kind, c.classification])).toEqual([
      ["new_employee", "initial_load"],
      ["new_employee", "initial_load"],
      ["new_employee", "initial_load"],
    ]);
  });

  it("stores nothing outside the allowlist", async () => {
    const { run, store } = setup(estate(3, { hasMultipleLocationAccess: true }), {
      "1000": wovenDetails("1000", [{ id: "WL-0306" }, { id: "WL-0144" }]),
    }, { locations: [wovenLocation("WL-0306", { number: "0306" })] });
    await run();
    const everything = JSON.stringify({
      rows: [...store.rows.values()],
      affiliations: [...store.affiliations.values()].map((m) => [...m.values()]),
      changes: store.changes,
      locations: [...store.locationMap.values()],
    });
    expect(everything).not.toContain(SENSITIVE_MARKER);
  });

  it("never leaks a name or an email into the run outcome", async () => {
    const { run } = setup(estate(3, { firstName: "Quinlan", email: "quinlan@suntancity.test" }));
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
      wovenEmployee("C", { status: TERMINATED, terminationDate: "2026-01-31" }),
      wovenEmployee("D"),
    ];
    const { run, store, fake } = setup(base);
    await run();

    fake.state.employees = [
      wovenEmployee("A", { status: TERMINATED, terminationDate: "2026-09-20" }),
      wovenEmployee("B", { positionId: "POS-SD", positionName: "Salon Director" }),
      wovenEmployee("C", { status: ACTIVE }),
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
    expect(position.classification).toBe("unclassified");
    /* E was hired in 2024: newly visible, not a new hire. */
    expect(store.changes.find((c) => c.runId === runId && c.kind === "new_employee")!.classification).toBe("newly_visible");
  });

  it("detects location access added and removed, including temporary-or-expiring access", async () => {
    const employees = [wovenEmployee("M", { hasMultipleLocationAccess: true })];
    const { run, store, fake } = setup(employees, {
      M: wovenDetails("M", [{ id: "WL-0306" }, { id: "WL-0144" }]),
    });
    await run();
    expect(locationsOf(store, "M")).toEqual([
      ["WL-0306", "primary"],
      ["WL-0144", "additional"],
    ]);

    fake.state.details.M = wovenDetails("M", [{ id: "WL-0306" }, { id: "WL-0200", expires: "2026-10-31T00:00:00" }]);
    const outcome = await run();
    const runId = (outcome as { runId: string }).runId;

    expect(changesOf(store, runId).sort()).toEqual(
      [
        ["M", "location_access_added"],
        ["M", "location_access_removed"],
      ].sort(),
    );
    const added = store.changes.find((c) => c.runId === runId && c.kind === "location_access_added")!;
    expect(added.classification).toBe("temporary_or_expiring_access");
    expect(added.toValue).toMatchObject({ wovenLocationId: "WL-0200", accessType: "temporary_or_expiring_access", expiresOn: "2026-10-31" });
    /* The old location is deactivated, never deleted. */
    expect(store.affiliations.get("M")!.get("WL-0144")).toMatchObject({ active: false });
  });

  it("keeps affiliations on file, and records no removal, when details could not be read", async () => {
    const { run, store, fake } = setup([wovenEmployee("M", { hasMultipleLocationAccess: true })], {
      M: wovenDetails("M", [{ id: "WL-0306" }, { id: "WL-0144" }]),
    });
    await run();

    fake.override((c) => c.path.endsWith("/details"), () => fake.json({}, 500), 10);
    const outcome = await run();
    const summary = succeeded(outcome);

    expect(summary.detailsSkipped).toBe(1);
    expect(summary.issueCounts.details_interrupted_server_error).toBe(1);
    expect(store.activeAffiliations("M").map((a) => a.wovenLocationId)).toEqual(["WL-0306", "WL-0144"]);
    expect(changesOf(store, (outcome as { runId: string }).runId)).toEqual([]);
  });

  it("respects the details budget and reads the least-recently-verified first next time", async () => {
    const employees = ["P", "Q", "R"].map((id) => wovenEmployee(id, { hasMultipleLocationAccess: true }));
    const details = Object.fromEntries(["P", "Q", "R"].map((id) => [id, wovenDetails(id, [{ id: "WL-0306" }])]));
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
  it("duplicate email, case-insensitively: flagged on every holder, both kept as provided", async () => {
    const { run, store } = setup([
      wovenEmployee("A", { email: "shared@suntancity.test" }),
      wovenEmployee("B", { email: "Shared@SunTanCity.test" }),
      wovenEmployee("C"),
    ]);
    const summary = succeeded(await run());
    expect(row(store, "A").emailAddress).toBe("shared@suntancity.test");
    expect(row(store, "B").emailAddress).toBe("Shared@SunTanCity.test");
    expect(summary.issueCounts.duplicate_email).toBe(2);
    expect(store.rows.size).toBe(3);
  });

  it("missing email, missing PositionID and missing location sync with issue codes", async () => {
    const { run, store } = setup([
      wovenEmployee("A", { email: null }),
      wovenEmployee("B", { positionId: null }),
      wovenEmployee("C", { primaryLocationId: null, primaryLocationName: null }),
    ]);
    const summary = succeeded(await run());
    expect(store.rows.size).toBe(3);
    expect(summary.issueCounts).toMatchObject({
      missing_email: 1,
      missing_position_id: 1,
      missing_primary_location: 1,
    });
    expect(store.activeAffiliations("C")).toEqual([]);
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
    expect(summary.fieldCoverage).toMatchObject({ emailAddress: 5, positionId: 5, primaryLocationId: 5, hireDate: 5 });
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
  const base = { received: 100, rejected: 0, activeNow: 90, activeOnFile: 100, minCompletenessPercent: 80 };
  it("accepts a read at the threshold and refuses one below it", () => {
    expect(validateRead({ ...base, activeNow: 80 }).ok).toBe(true);
    expect(validateRead({ ...base, activeNow: 79 })).toMatchObject({ ok: false, code: "unexpectedly_small" });
  });
  it("does not apply the percentage to a tiny directory", () => {
    expect(validateRead({ ...base, activeOnFile: 5, activeNow: 1 }).ok).toBe(true);
  });
});

describe("status comes only from Woven's enum list", () => {
  it("refuses a REAL run when /lists/enums cannot be read, saving nothing", async () => {
    const { run, store } = setup(estate(5), {}, { enums: null });
    const outcome = await run();
    expect(outcome).toMatchObject({ status: "rejected", code: "status_enum_unresolved" });
    expect(store.rows.size).toBe(0);
    expect(store.runs.at(-1)).toMatchObject({ status: "rejected", errorCode: "status_enum_unresolved" });
  });

  it("still reports on a DRY run, with every status unknown", async () => {
    const { run } = setup(estate(5), {}, { enums: null });
    const summary = succeeded(await run({ dryRun: true }));
    expect(summary.statusSource).toBe("none");
    expect(summary.employeesStatusUnknown).toBe(5);
    expect(summary.issueCounts.enums_unavailable).toBe(1);
  });

  it("stores an On Leave employee as unknown, never terminated", async () => {
    const { run, store } = setup([...estate(3), wovenEmployee("L", { status: FAKE_STATUS.onLeave })], {}, { alwaysIncludeTerminated: true });
    await run();
    expect(row(store, "L").employmentStatus).toBe("unknown");
  });
});

describe("position changes use the confirmed position map, and only it", () => {
  it("is a confirmed promotion only when both positions are mapped with ranks", async () => {
    const { run, store, fake } = setup([wovenEmployee("A", { positionId: "POS-SC" }), wovenEmployee("B", { positionId: "POS-SC" })]);
    await run();
    store.mapPosition("POS-SC", 10);
    store.mapPosition("POS-SD", 30);

    fake.state.employees = [wovenEmployee("A", { positionId: "POS-SD" }), wovenEmployee("B", { positionId: "POS-LEAD" })];
    const outcome = await run();
    const runId = (outcome as { runId: string }).runId;
    const byEmployee = Object.fromEntries(
      store.changes.filter((c) => c.runId === runId && c.kind === "position_changed").map((c) => [c.externalEmployeeId, c.classification]),
    );
    expect(byEmployee).toEqual({ A: "promotion_confirmed", B: "unclassified" });
  });

  it("flags an employee whose position is not mapped, and queues the position", async () => {
    const { run, store } = setup([wovenEmployee("A", { positionId: "POS-NEW" })]);
    const summary = succeeded(await run());
    expect(summary.issueCounts.unmapped_position).toBe(1);
    expect(store.positionMap.get("POS-NEW")).toMatchObject({ status: "unmapped", isConfirmed: false });
  });
});

describe("locations", () => {
  it("stores the /locations catalog on the location map, never a mapping", async () => {
    const { run, store } = setup([wovenEmployee("A")], {}, { locations: [wovenLocation("WL-0306", { number: "0306" }), wovenLocation("WL-HQ", { nonLocation: true })] });
    await run();
    expect(store.locationMap.get("WL-0306")).toMatchObject({ status: "unmapped", salonId: null, number: "0306" });
    expect(store.locationMap.has("WL-HQ")).toBe(true);
  });

  it("does not fail when /locations cannot be read", async () => {
    const { run, fake } = setup([wovenEmployee("A")]);
    fake.override((c) => c.path === "/locations", () => fake.json({}, 500), 10);
    const summary = succeeded(await run());
    expect(summary.issueCounts.locations_catalog_unavailable).toBe(1);
  });

  it("reads details when the list flag says 'one location' but more are on file", async () => {
    const { run, store, fake } = setup([wovenEmployee("M", { hasMultipleLocationAccess: true })], {
      M: wovenDetails("M", [{ id: "WL-0306" }, { id: "WL-0200", expires: "2026-12-31T00:00:00" }]),
    });
    await run();
    fake.state.employees = [wovenEmployee("M", { hasMultipleLocationAccess: false })];
    fake.calls.length = 0;
    await run();
    expect(fake.calls.some((c) => c.path === "/employees/M/details")).toBe(true);
    expect(locationsOf(store, "M")).toEqual([
      ["WL-0306", "primary"],
      ["WL-0200", "temporary_or_expiring_access"],
    ]);
  });

  it("never ends a terminated employee's locations on the strength of the list flag alone", async () => {
    const { run, store, fake } = setup([wovenEmployee("M", { hasMultipleLocationAccess: true })], {
      M: wovenDetails("M", [{ id: "WL-0306" }, { id: "WL-0144" }]),
    });
    await run();
    fake.state.employees = [wovenEmployee("M", { status: TERMINATED, hasMultipleLocationAccess: false })];
    const outcome = await run();
    const runId = (outcome as { runId: string }).runId;
    expect(changesOf(store, runId)).toEqual([["M", "terminated"]]);
    expect(store.activeAffiliations("M")).toHaveLength(2);
  });

  it("counts, never guesses about, employees the with-terminated read left out", async () => {
    const { run, fake } = setup(estate(3));
    fake.override((c) => c.path === "/employees" && c.query.includeterminatedemployee === "true" && c.query.queryskip === "0", () => fake.json([wovenEmployee("1000")]));
    fake.override((c) => c.path === "/employees" && c.query.includeterminatedemployee === "true" && c.query.queryskip === "1", () => fake.json([]));
    const summary = succeeded(await run());
    expect(summary.issueCounts.current_missing_from_with_terminated).toBe(2);
    expect(summary.employeesReceived).toBe(3);
  });
});

describe("new hires", () => {
  it("classifies an employee first seen within 30 days of their start as a new hire", async () => {
    const { run, store, fake } = setup([wovenEmployee("A")]);
    await run();
    fake.state.employees = [wovenEmployee("A"), wovenEmployee("N", { hireDate: "2026-09-21T00:00:00", startDate: "2026-09-22T00:00:00" })];
    const outcome = await run();
    const change = store.changes.find((c) => c.runId === (outcome as { runId: string }).runId && c.kind === "new_employee")!;
    expect(change.classification).toBe("new_hire");
    expect(change.effectiveDate).toBe("2026-09-21");
  });
});

function envOf(config: typeof CONFIG): Record<string, string> {
  return {
    WOVEN_SYNC_ENABLED: config.enabled ? "true" : "false",
    WOVEN_SYNC_WRITES_ENABLED: config.writesEnabled ? "true" : "false",
    WOVEN_SUBSCRIPTION_KEY: config.credentials!.subscriptionKey,
    WOVEN_USERNAME: config.credentials!.username,
    WOVEN_PASSWORD: config.credentials!.password,
    WOVEN_PAGE_SIZE: String(config.pageSize),
  };
}

describe("pre-sync safety: live-shaped responses", () => {
  it("a details 404 is a per-employee warning: the run saves everyone, keeps reading details, and flags only that employee", async () => {
    /* 1000 is read first and has no details record, as two live employees did. */
    const employees = ["1000", "1001", "1002"].map((id) => wovenEmployee(id, { hasMultipleLocationAccess: true }));
    const { run, store } = setup(employees, {
      "1001": wovenDetails("1001", [{ id: "WL-0306" }, { id: "WL-0144" }]),
      "1002": wovenDetails("1002", [{ id: "WL-0306" }, { id: "WL-0200" }]),
    });
    const summary = succeeded(await run());

    expect(summary.employeesReceived).toBe(3);
    expect(summary.issueCounts.details_not_found).toBe(1);
    expect(Object.keys(summary.issueCounts).some((k) => k.startsWith("details_interrupted"))).toBe(false);
    expect(summary.detailsFetched).toBe(2);
    expect(store.rows.size).toBe(3);
    expect(store.runs.at(-1)?.status).toBe("succeeded");

    /* The 404 employee keeps its primary, is marked unverified, and nothing else is invented. */
    expect(locationsOf(store, "1000")).toEqual([["WL-0306", "primary"]]);
    expect(row(store, "1000").affiliationsVerifiedAt).toBeNull();
    /* The others were read after it, and verified. */
    expect(locationsOf(store, "1001")).toEqual([["WL-0306", "primary"], ["WL-0144", "additional"]]);
    expect(locationsOf(store, "1002")).toEqual([["WL-0306", "primary"], ["WL-0200", "additional"]]);
    expect(row(store, "1001").affiliationsVerifiedAt).not.toBeNull();
  });

  it("the same 404 in a dry run: counted, and nothing written anywhere", async () => {
    const { run, store } = setup([wovenEmployee("1000", { hasMultipleLocationAccess: true })]);
    const summary = succeeded(await run({ dryRun: true }));
    expect(summary.dryRun).toBe(true);
    expect(summary.issueCounts.details_not_found).toBe(1);
    expect(store.runs).toHaveLength(0);
    expect(store.rows.size).toBe(0);
    expect(store.changes).toHaveLength(0);
    expect(store.locationMap.size).toBe(0);
  });

  it("the live EmployeeStatus enum: 1 Active, 2 Terminated, 10 Vendor, 100 Active Hidden — only exact labels map", async () => {
    const LIVE_STATUS_ENUM = [
      { EnumerationName: "EmployeeStatus", PropertyName: "Active", PropertyDisplayName: "Active", PropertyValue: 1 },
      { EnumerationName: "EmployeeStatus", PropertyName: "Terminated", PropertyDisplayName: "Terminated", PropertyValue: 2 },
      { EnumerationName: "EmployeeStatus", PropertyName: "Vendor", PropertyDisplayName: "Vendor", PropertyValue: 10 },
      { EnumerationName: "EmployeeStatus", PropertyName: "ActiveHidden", PropertyDisplayName: "Active Hidden", PropertyValue: 100 },
    ];
    const employees = [
      wovenEmployee("1000", { status: 1 }),
      wovenEmployee("1001", { status: 2, terminationDate: "2026-08-31T00:00:00" }),
      wovenEmployee("1002", { status: 10 }),
      wovenEmployee("1003", { status: 100 }),
    ];
    const { run, store } = setup(employees, {}, { enums: [...LIVE_STATUS_ENUM, ...FAKE_ENUMS.filter((e) => e.EnumerationName !== "EmployeeStatus")] });
    const summary = succeeded(await run());
    expect(summary.statusSource).toBe("enums");
    expect([summary.employeesActive, summary.employeesTerminated, summary.employeesStatusUnknown]).toEqual([1, 1, 2]);
    expect([...store.rows.values()].map((r) => [r.externalEmployeeId, r.employmentStatus, r.employmentStatusCode]).sort()).toEqual([
      ["1000", "active", 1],
      ["1001", "terminated", 2],
      ["1002", "unknown", 10],
      ["1003", "unknown", 100],
    ]);
    /* Vendor and Active Hidden are neither active nor terminated, and never produce a termination. */
    const run1 = store.runs.at(-1)!.id;
    expect(changesOf(store, run1).filter(([, kind]) => kind === "terminated")).toEqual([]);
  });

  it("background-check, I-9, SSN and 2FA fields — on the list row or the details record — are never stored", async () => {
    const extra = {
      I9Status: "SENSITIVE-I9",
      I9DocumentNumber: "SENSITIVE-I9-DOC",
      BackgroundCheckStatus: "SENSITIVE-BACKGROUND",
      BackgroundCheckDate: "SENSITIVE-BACKGROUND-DATE",
      SocialSecurityNumber: "SENSITIVE-SSN",
      TwoFactorAuthentication: { EmailAddress: "SENSITIVE-2FA-EMAIL", TwoFactorAuthenticationCellPhone: "SENSITIVE-2FA-PHONE" },
      HomeAddress: { Address1: "SENSITIVE-HOME-STREET", City: "SENSITIVE-HOME-CITY" },
      SecureDocuments: [{ Name: "SENSITIVE-SECURE-DOC" }],
    };
    const employees = [{ ...wovenEmployee("1000", { hasMultipleLocationAccess: true }), ...extra }];
    const { run, store } = setup(employees, {
      "1000": { ...wovenDetails("1000", [{ id: "WL-0306" }, { id: "WL-0144" }]), ...extra },
    });
    succeeded(await run());
    const everything = JSON.stringify({
      rows: [...store.rows.values()],
      affiliations: [...store.affiliations.values()].map((m) => [...m.values()]),
      changes: store.changes,
      runs: store.runs,
      locations: [...store.locationMap.values()],
      positions: [...store.positionMap.values()],
    });
    expect(everything).not.toContain(SENSITIVE_MARKER);
  });
});

describe("the write switch (WOVEN_SYNC_WRITES_ENABLED)", () => {
  const creds = {
    WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
    WOVEN_USERNAME: FAKE_CREDENTIALS.username,
    WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
    WOVEN_PAGE_SIZE: "25",
  };
  const DRY_RUN_ONLY = readWovenConfig({ ...creds, WOVEN_SYNC_ENABLED: "true" });

  /** A store that records every method called on it, reads and writes alike. */
  function recordingStore() {
    const inner = new MemoryDirectoryStore();
    const calls: string[] = [];
    const store = new Proxy(inner, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(String(key));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    return { store, inner, calls };
  }
  const WRITE_METHODS = ["claimRun", "commitRun", "abandonRun"];

  it("1. sync switch off: nothing runs, whatever the write switch says", async () => {
    for (const writes of ["true", "false"]) {
      const { store, calls } = recordingStore();
      const { run, fake } = setup(estate(3));
      const outcome = await run({ config: readWovenConfig({ ...creds, WOVEN_SYNC_WRITES_ENABLED: writes }), store, dryRun: false });
      expect(outcome.status).toBe("disabled");
      expect(fake.calls).toHaveLength(0);
      expect(calls).toEqual([]);
    }
  });

  it("2. sync on, writes off: a dry run succeeds, reads only, and writes nothing", async () => {
    const { store, inner, calls } = recordingStore();
    const { run, fake } = setup(estate(3, { hasMultipleLocationAccess: true }), {
      "1000": wovenDetails("1000", [{ id: "WL-0306" }, { id: "WL-0144" }]),
    });
    const summary = succeeded(await run({ config: DRY_RUN_ONLY, store, dryRun: true }));
    expect(summary.dryRun).toBe(true);
    expect(summary.employeesReceived).toBe(3);
    expect(summary.newEmployeesByClassification.initial_load).toBe(3);
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => WRITE_METHODS.includes(c))).toEqual([]);
    expect([inner.runs.length, inner.rows.size, inner.changes.length, inner.affiliations.size, inner.locationMap.size, inner.positionMap.size]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("3 and 4. sync on, writes off: a save — explicit, or the cron's default — is refused before the store or Woven is touched", async () => {
    for (const dryRun of [false, undefined]) {
      const { store, inner, calls } = recordingStore();
      const { run, fake } = setup(estate(3));
      const outcome = await run({ config: DRY_RUN_ONLY, store, dryRun });
      expect(outcome.status).toBe("writes_disabled");
      expect(outcomeHttpStatus(outcome)).toBe(409);
      expect((outcome as { reason: string }).reason).toContain("WOVEN_SYNC_WRITES_ENABLED");
      /* Zero store calls of any kind — not even a read — and zero Woven requests. */
      expect(calls).toEqual([]);
      expect(fake.calls).toHaveLength(0);
      expect([inner.runs.length, inner.rows.size, inner.changes.length, inner.affiliations.size, inner.locationMap.size, inner.positionMap.size]).toEqual([0, 0, 0, 0, 0, 0]);
    }
  });

  it("the refusal does not depend on credentials being set", async () => {
    const { store, calls } = recordingStore();
    const { run } = setup(estate(1));
    const outcome = await run({ config: readWovenConfig({ WOVEN_SYNC_ENABLED: "true" }), store, dryRun: false });
    expect(outcome.status).toBe("writes_disabled");
    expect(calls).toEqual([]);
  });

  it("sync on, writes on: a stored sync saves (not enabled anywhere yet)", async () => {
    const { store, inner, calls } = recordingStore();
    const { run } = setup(estate(2));
    const writesOn = readWovenConfig({ ...creds, WOVEN_SYNC_ENABLED: "true", WOVEN_SYNC_WRITES_ENABLED: "true" });
    succeeded(await run({ config: writesOn, store, dryRun: false }));
    expect(calls).toContain("claimRun");
    expect(calls).toContain("commitRun");
    expect(inner.rows.size).toBe(2);
  });
});

describe("dry-run diagnostics: counts and field combinations, never a person", () => {
  /* The Production dry run's shapes, one of each. NOW is 2026-09-28. */
  function productionShape() {
    const employees = [
      /* Rehire shape: Active, an old TerminationDate, hired again after it. */
      wovenEmployee("1001", { hireDate: "2025-06-01T00:00:00", terminationDate: "2025-01-10T00:00:00", lastDayWorked: "2025-01-09T00:00:00", terminationType: 1 }),
      /* Termination recorded, status not changed: hired before a recent TerminationDate. */
      wovenEmployee("1002", { hireDate: "2023-02-01T00:00:00", startDate: null, terminationDate: "2026-09-15T00:00:00", terminationType: 2 }),
      /* A future TerminationDate is not a conflict. */
      wovenEmployee("1003", { terminationDate: "2026-12-31T00:00:00" }),
      /* Multiple-location, details 404. */
      wovenEmployee("1004", { hasMultipleLocationAccess: true }),
      /* Multiple-location; details list a location /locations does not return. */
      wovenEmployee("1005", { hasMultipleLocationAccess: true }),
      /* All-location without the multiple flag: still needs a details read. */
      wovenEmployee("1006", { allLocationAccess: true }),
      /* Primary outside /locations, and no PositionID. */
      wovenEmployee("1007", { primaryLocationId: "WL-OFFCAT-P", primaryLocationName: "Off-catalog primary", positionId: null, positionName: "Floater" }),
    ];
    const details = {
      "1005": wovenDetails("1005", [{ id: "WL-0306" }, { id: "WL-OFFCAT-D", name: "Off-catalog detail" }]),
      "1006": wovenDetails("1006", [{ id: "WL-0306" }, { id: "WL-A" }]),
    };
    return setup(employees, details, { locations: [wovenLocation("WL-0306"), wovenLocation("WL-A"), wovenLocation("WL-B")] });
  }

  it("explains each issue count without writing anything", async () => {
    const { run, store } = productionShape();
    const summary = succeeded(await run({ dryRun: true }));
    const d = summary.diagnostics!;

    expect(summary.issueCounts.status_termination_conflict).toBe(2);
    expect(d.statusTerminationConflict).toMatchObject({
      total: 2,
      statusCodes: [{ code: ACTIVE, label: "Active", count: 2 }],
      withLastDayWorked: 1,
      hiredOrStartedAfterTermination: 1,
      hiredOrStartedOnOrBeforeTermination: 1,
      noHireOrStartDate: 0,
      terminationDateAge: { within30Days: 1, within365Days: 0, over365Days: 1, before2000: 0 },
      inCurrentList: 2,
      onlyInWithTerminatedList: 0,
    });
    expect(d.statusTerminationConflict.terminationTypeCodes).toEqual([
      { code: 1, label: "Voluntary", count: 1 },
      { code: 2, label: "Involuntary", count: 1 },
    ]);

    expect(d.locationsOutsideCatalog).toMatchObject({ catalogSize: 3, referencedInCatalog: 2, catalogNotReferenced: 1 });
    expect(d.locationsOutsideCatalog.outside).toEqual([
      { wovenLocationId: "WL-OFFCAT-D", name: "Off-catalog detail", asPrimary: 0, inDetails: 1 },
      { wovenLocationId: "WL-OFFCAT-P", name: "Off-catalog primary", asPrimary: 1, inDetails: 0 },
    ]);
    expect(summary.unmappedLocations).toBe(d.locationsOutsideCatalog.referencedLocations);

    expect(d.detailSelection).toEqual({
      candidates: 3,
      candidatesMultipleLocationFlagTrue: 2,
      candidatesMultipleLocationFlagUnset: 0,
      candidatesAllLocationAccess: 1,
      candidatesAllLocationWithoutMultipleFlag: 1,
      budget: CONFIG.maxDetailRequestsPerRun,
      attempted: 3,
      fetched: 2,
      notFound: 1,
      noUsableLocationList: 0,
      interrupted: false,
    });
    expect(summary.detailsSkipped).toBe(d.detailSelection.candidates - d.detailSelection.fetched);

    expect(d.detailsNotFound).toMatchObject({
      total: 1,
      inCurrentList: 1,
      withPrimaryLocation: 1,
      primaryInCatalog: 1,
      primaryRetained: 1,
      markedAffiliationsNotVerified: 1,
      withEmployeeLoginId: 1,
      hasMultipleLocationAccess: { yes: 1, no: 0, unset: 0 },
    });
    expect(d.missingPositionId).toMatchObject({ total: 1, withPositionName: 1 });

    expect(store.runs).toHaveLength(0);
    expect(store.rows.size).toBe(0);
    expect(store.changes).toHaveLength(0);
  });

  it("carries no employee name, email, id, login id, HRIS id or date", async () => {
    const { run } = productionShape();
    const json = JSON.stringify(succeeded(await run({ dryRun: true })).diagnostics);
    for (const id of ["1001", "1002", "1003", "1004", "1005", "1006", "1007"]) expect(json).not.toContain(id);
    for (const fragment of ["First100", "Last100", "@", "LOGIN-", "HRIS-", "SENSITIVE", "2023-", "2025-", "2026-"]) {
      expect(json).not.toContain(fragment);
    }
  });

  it("a stored run of the same shape keeps conflicts Active, records no termination and guesses no position", async () => {
    const { run, store } = productionShape();
    succeeded(await run());
    expect(row(store, "1001").employmentStatus).toBe("active");
    expect(row(store, "1002").employmentStatus).toBe("active");
    expect(store.changes.filter((c) => c.kind === "terminated")).toHaveLength(0);
    expect(store.changes.every((c) => c.kind === "new_employee" && c.classification === "initial_load")).toBe(true);
    expect(row(store, "1007").positionId).toBeNull();
    expect([...store.positionMap.keys()]).toEqual(["POS-SC"]);
    expect(locationsOf(store, "1004")).toEqual([["WL-0306", "primary"]]);
    expect(row(store, "1004").affiliationsVerifiedAt).toBeNull();

    /* The same read again: nothing recorded, still Active. */
    const again = succeeded(await run());
    expect(Object.values(again.changesByKind).reduce((a, b) => a + b, 0)).toBe(0);
    expect(row(store, "1002").employmentStatus).toBe("active");
  });
});
