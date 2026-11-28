import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/**
 * NOBODY GIVES MORE THAN THEY HAVE (port of Ask Bubbles' rules; audit, 28 Nov 2026).
 *
 * Invite and edit took any well-formed scope and role from anyone with manage_users: an administrator whose account
 * covers one salon could PATCH their own scope to global and every report reader widened for them; a plain admin
 * could make someone Owner. These call the server functions directly with what the form would never send.
 */

const updates: string[] = [];
const salon = (id: string, also: string[] = []): AccessScope => ({ level: "salon", primaryAreaId: id, alsoCoversAreaIds: also });
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const ONE_SALON = salon("loc-0306");
const actor = (scope: AccessScope = ONE_SALON, role: "admin" | "owner" = "admin") => ({ id: "admin-1", email: "a@example.test", role, scope });

function stored(row: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "ilike", "limit", "in", "order", "neq", "not"]) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ data: row, error: null });
  chain.single = async () => ({ data: row, error: null });
  chain.update = () => {
    updates.push("app_users.update");
    return chain;
  };
  chain.insert = () => {
    updates.push("insert");
    return chain;
  };
  chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null, count: 0 });
  return chain;
}

async function load(row: Record<string, unknown>) {
  vi.resetModules();
  updates.length = 0;
  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({ from: () => stored(row), auth: { admin: { inviteUserByEmail: async () => ({ data: { user: { id: "new" } }, error: null }), deleteUser: async () => ({}) } } }),
    KNOWLEDGE_BUCKET: "knowledge-documents",
  }));
  return import("./user-directory");
}

const self = {
  id: "admin-1",
  email: "a@example.test",
  display_name: "An Admin",
  role: "admin",
  status: "active",
  scope_level: "salon",
  scope_primary_area_id: "loc-0306",
  scope_also_covers_area_ids: [],
};

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

describe("an administrator cannot give more reach than their own", () => {
  it("cannot widen their own scope to every salon, and nothing is written", async () => {
    const { patchUser } = await load(self);
    await expect(patchUser("admin-1", { scope: GLOBAL }, actor())).rejects.toMatchObject({ code: "forbidden_grant" });
    expect(updates).toEqual([]);
  });

  it("cannot give a salon outside their own reach, on invite or on edit", async () => {
    const { assertScopeWithinActor } = await load(self);
    expect(() => assertScopeWithinActor(actor(), salon("loc-0394"))).toThrow(/salons your own account covers/);
    expect(() => assertScopeWithinActor(actor(), salon("loc-0306", ["loc-0468"]), ONE_SALON)).toThrow(/salons your own account covers/);
  });

  it("removing a salon, resubmitting a scope, or a global administrator's grant is never blocked", async () => {
    const { assertScopeWithinActor } = await load(self);
    const wide = salon("loc-0306", ["loc-0394", "loc-0468"]);
    expect(() => assertScopeWithinActor(actor(), wide, wide)).not.toThrow();
    expect(() => assertScopeWithinActor(actor(), salon("loc-0306", ["loc-0394"]), wide)).not.toThrow();
    expect(() => assertScopeWithinActor(actor(GLOBAL), GLOBAL)).not.toThrow();
    expect(() => assertScopeWithinActor(actor(), GLOBAL, GLOBAL)).not.toThrow();
  });
});

describe("only an owner or developer gives Owner or Developer", () => {
  it.each(["owner", "developer"])("an admin cannot promote an account to %s, and nothing is written", async (role) => {
    const { patchUser } = await load({ ...self, id: "user-1", email: "u@example.test" });
    await expect(patchUser("user-1", { role }, actor(GLOBAL))).rejects.toMatchObject({ code: "forbidden_grant" });
    expect(updates).toEqual([]);
  });

  it("an owner can, and an admin can still edit an existing owner's other details", async () => {
    const { assertMayGrantRole } = await load(self);
    expect(() => assertMayGrantRole(actor(GLOBAL, "owner"), "developer")).not.toThrow();
    expect(() => assertMayGrantRole(actor(GLOBAL), "owner", "owner")).not.toThrow();
    expect(() => assertMayGrantRole(actor(GLOBAL), "admin")).not.toThrow();
  });
});
