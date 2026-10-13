import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  result: { data: null, error: null } as { data: unknown; error: unknown },
  throws: false,
  calls: [] as Array<[string, unknown]>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "sb=1" }) }));

vi.mock("@/lib/supabase/auth-clients", () => ({
  cookieJarFromHeaders: () => ({}),
  getSupabaseSessionClientFor: () => {
    if (db.throws) throw new Error("client unavailable");
    const chain = {
      select: (columns: string) => {
        db.calls.push(["select", columns]);
        return chain;
      },
      eq: (column: string, value: unknown) => {
        db.calls.push([column, value]);
        return chain;
      },
      maybeSingle: async () => db.result,
    };
    return { from: (table: string) => (db.calls.push(["from", table]), chain) };
  },
}));

import { subjectHasSwitchGrant } from "./app-switch-grant";

beforeEach(() => {
  db.result = { data: null, error: null };
  db.throws = false;
  db.calls = [];
});

describe("the per-user switch grant read", () => {
  it("is true only for a literal true on the caller's own active row", async () => {
    db.result = { data: { can_switch_apps: true }, error: null };
    expect(await subjectHasSwitchGrant("sub-1")).toBe(true);
  });

  it("asks for exactly that column, keyed on the subject and an active profile", async () => {
    db.result = { data: { can_switch_apps: true }, error: null };
    await subjectHasSwitchGrant("sub-1");
    expect(db.calls).toContainEqual(["from", "app_users"]);
    expect(db.calls).toContainEqual(["select", "can_switch_apps"]);
    expect(db.calls).toContainEqual(["id", "sub-1"]);
    expect(db.calls).toContainEqual(["status", "active"]);
  });

  it.each([
    ["a revoked grant", { data: { can_switch_apps: false }, error: null }],
    ["a missing profile / disabled or invited user (no row)", { data: null, error: null }],
    ["a database error (e.g. the column does not exist yet)", { data: null, error: { message: "column does not exist" } }],
    ["an error alongside data", { data: { can_switch_apps: true }, error: { message: "x" } }],
    ["a string that merely looks true", { data: { can_switch_apps: "true" }, error: null }],
    ["a null flag", { data: { can_switch_apps: null }, error: null }],
    ["an unrelated shape", { data: { role: "admin" }, error: null }],
  ])("is false for %s", async (_label, result) => {
    db.result = result as typeof db.result;
    expect(await subjectHasSwitchGrant("sub-1")).toBe(false);
  });

  it("is false when the client cannot even be built", async () => {
    db.throws = true;
    expect(await subjectHasSwitchGrant("sub-1")).toBe(false);
  });
});
