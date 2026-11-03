import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

/**
 * ROSTER_STORE_SCOPED_ENABLED (master plan step 1, 3 Nov 2026): name checks
 * and the staff list read only the manager's own salons' active people, paged
 * under the database's 1,000-row cap, minus reviewed shared logins.
 *
 * Pass, as the plan states it: a shared login absent; terminated absent; the
 * store roster equals the count of active people affiliated with the store; the
 * whole directory is never loaded. Flag off: the roster is today's, exactly.
 */

const tables = {} as FakeStore & Record<string, Record<string, unknown>[]>;
/** Every read, with the filters it carried, to prove what was (not) loaded. */
const reads: { table: string; calls: string[] }[] = [];
/** The real service's cap: at most this many rows per response, whatever `.limit()` says. */
const cap = vi.hoisted(() => ({ rows: 1000 }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const query = fakeSupabase(tables).from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      const read = { table, calls: [] as string[] };
      reads.push(read);
      const proxy: Record<string, unknown> = new Proxy(query, {
        get(target, key) {
          if (key === "then") {
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              (target.then as (a: (value: { data: unknown[] | null; error: unknown }) => unknown, b: unknown) => unknown).call(
                target,
                (value) => resolve({ ...value, data: Array.isArray(value.data) ? value.data.slice(0, cap.rows) : value.data }),
                reject,
              );
          }
          const value = target[key as string];
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            read.calls.push(`${String(key)}(${args.map((arg) => (Array.isArray(arg) ? `[${arg.length}]` : JSON.stringify(arg))).join(",")})`);
            value.apply(target, args);
            return proxy;
          };
        },
      });
      return proxy;
    },
  }),
}));

/* This app's list is empty (no shared login on its directory, 3 Nov 2026); the mechanism is tested with an invented one. */
const SHARED_LOGIN = "woven-shared-login-0000";
vi.mock("./roster-non-person", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./roster-non-person")>();
  return { ...actual, isNonPersonWovenId: (id: string | null | undefined) => actual.isNonPersonWovenId(id, new Set([SHARED_LOGIN])) };
});

const { loadScopedRoster, readDirectoryFacts, readStoreRoster } = await import("./employee-roster");

const SALON_A = "loc-0309";
const SALON_B = "loc-0462";
const SHARED_LOGIN_ID = SHARED_LOGIN;

function person(id: string, first: string, last: string, store: string, extra: Record<string, unknown> = {}) {
  tables.employee_access_directory!.push({
    id,
    external_employee_id: `woven-${id}`,
    first_name: first,
    last_name: last,
    preferred_first_name: null,
    employment_status: "active",
    position_name: "Tanning Consultant",
    last_synced_at: "2026-11-02T11:18:00Z",
    primary_location_name: null,
    ...extra,
  });
  tables.employee_location_affiliations!.push({ employee_id: id, woven_location_id: `w-${store}`, active: true });
}

const storeScope = (id: string): AccessScope => ({ level: "salon", primaryAreaId: id, alsoCoversAreaIds: [] });
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const names = (rows: readonly { firstName: string; lastName: string }[]) => rows.map((row) => `${row.firstName} ${row.lastName}`).sort();

beforeEach(() => {
  tables.employee_access_directory = [];
  tables.employee_location_affiliations = [];
  tables.salons = [
    { id: "salon-a", salon_number: "0309" },
    { id: "salon-b", salon_number: "0462" },
  ];
  tables.woven_location_map = [
    { woven_location_id: `w-${SALON_A}`, salon_id: "salon-a", status: "mapped" },
    { woven_location_id: `w-${SALON_B}`, salon_id: "salon-b", status: "mapped" },
    { woven_location_id: "w-unmapped", salon_id: null, status: "unmapped" },
  ];
  reads.length = 0;
  cap.rows = 1000;
  person("p1", "Avery", "Quill", SALON_A);
  person("p2", "Blair", "Fennick", SALON_A, { employment_status: "terminated" });
  person("p3", "Casey", "Morrow", SALON_A, { employment_status: "unknown" });
  person("p4", "Dana", "Hollis", SALON_B);
  person("login", "Shared", "Login", SALON_B, { external_employee_id: SHARED_LOGIN_ID, position_name: "Tanning Consultant" });
  person("p5", "Risk", "Management", SALON_B);
  // An inactive affiliation is not a store's person.
  tables.employee_location_affiliations.push({ employee_id: "p4", woven_location_id: `w-${SALON_A}`, active: false });
});

afterEach(() => {
  delete process.env.ROSTER_STORE_SCOPED_ENABLED;
});

describe("ROSTER_STORE_SCOPED_ENABLED off", () => {
  it("is today's roster: the whole directory, scoped in memory, the shared login and unknown statuses included", async () => {
    expect(names(await loadScopedRoster(storeScope(SALON_B)))).toEqual(["Dana Hollis", "Shared Login"]);
    expect(names(await loadScopedRoster(storeScope(SALON_A)))).toEqual(["Avery Quill", "Casey Morrow"]);
    const directory = reads.filter((read) => read.table === "employee_access_directory");
    expect(directory.length).toBeGreaterThan(0);
    expect(directory.every((read) => read.calls.includes("limit(5000)"))).toBe(true);
  });
});

describe("ROSTER_STORE_SCOPED_ENABLED on", () => {
  beforeEach(() => {
    process.env.ROSTER_STORE_SCOPED_ENABLED = "true";
  });

  it("leaves out a reviewed shared login, by its Woven id", async () => {
    expect(names(await loadScopedRoster(storeScope(SALON_B)))).toEqual(["Dana Hollis"]);
  });

  it("leaves out terminated and unknown statuses: active people only", async () => {
    expect(names(await loadScopedRoster(storeScope(SALON_A)))).toEqual(["Avery Quill"]);
  });

  it("a store roster is exactly the store's active, affiliated people", async () => {
    const roster = await loadScopedRoster(storeScope(SALON_A));
    const expected = tables.employee_location_affiliations!.filter(
      (row) =>
        row.active === true &&
        row.woven_location_id === `w-${SALON_A}` &&
        tables.employee_access_directory!.find((entry) => entry.id === row.employee_id)?.employment_status === "active",
    );
    expect(roster).toHaveLength(expected.length);
    expect(roster[0]!.salonIds).toEqual([SALON_A]);
  });

  it("a global scope is every salon, still without the login or the service account", async () => {
    expect(names(await loadScopedRoster(GLOBAL))).toEqual(["Avery Quill", "Dana Hollis"]);
  });

  it("never loads the whole directory: every directory read is filtered to the store's people and paged", async () => {
    await loadScopedRoster(storeScope(SALON_A));
    const directory = reads.filter((read) => read.table === "employee_access_directory");
    expect(directory.length).toBeGreaterThan(0);
    for (const read of directory) {
      expect(read.calls.some((call) => call.startsWith('in("id"'))).toBe(true);
      expect(read.calls).toContain('eq("employment_status","active")');
      expect(read.calls.some((call) => call.startsWith("range("))).toBe(true);
      expect(read.calls.some((call) => call.startsWith("limit("))).toBe(false);
    }
    for (const read of reads.filter((entry) => entry.table === "employee_location_affiliations")) {
      expect(read.calls.some((call) => call.startsWith('in("woven_location_id"'))).toBe(true);
    }
  });

  it("pages past the 1,000-row cap instead of being cut short", async () => {
    for (let index = 0; index < 1205; index += 1) person(`bulk-${String(index).padStart(4, "0")}`, "Bulk", `Person${index}`, SALON_A);
    const roster = await readStoreRoster(storeScope(SALON_A));
    expect(roster).toHaveLength(1206);
    // Flag off, the same directory is cut at the cap with no error.
    delete process.env.ROSTER_STORE_SCOPED_ENABLED;
    expect((await loadScopedRoster(storeScope(SALON_A))).length).toBeLessThan(1206);
  });

  it("a read error is unchecked (empty, the typed name used as typed), never everyone", async () => {
    delete (tables as Record<string, unknown>).employee_location_affiliations;
    await expect(loadScopedRoster(storeScope(SALON_A))).resolves.toEqual([]);
    await expect(readDirectoryFacts(storeScope(SALON_A))).resolves.toEqual([]);
  });

  it("the grounded facts read the same store roster, with title", async () => {
    const facts = await readDirectoryFacts(storeScope(SALON_B));
    expect(facts.map((fact) => [fact.firstName, fact.title])).toEqual([["Dana", "Tanning Consultant"]]);
  });

  it("no scope, a district (unchecked as before), or a salon scope with no salon reads nothing", async () => {
    expect(await readStoreRoster(null)).toEqual([]);
    expect(await readStoreRoster({ level: "district", primaryAreaId: "d1", alsoCoversAreaIds: [] })).toEqual([]);
    expect(await readStoreRoster({ level: "salon", primaryAreaId: null, alsoCoversAreaIds: [] })).toEqual([]);
    expect(reads).toEqual([]);
  });
});
