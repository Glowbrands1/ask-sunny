import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "Can we add myself, and any other DM or higher role as a drop down option to add to-do's and issues?" (17 Nov 2026).
 * The owner menus add every DM-or-higher person from Woven. Invented people only: the real list is read at run time.
 */
const tables: Record<string, Record<string, unknown>[]> = {};
const calls: { table: string; or?: string; inIds?: unknown[] }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const call: { table: string; or?: string; inIds?: unknown[] } = { table };
      calls.push(call);
      const q = {
        select: () => q,
        or: (f: string) => ((call.or = f), q),
        in: (_c: string, ids: unknown[]) => ((call.inIds = ids), q),
        limit: async () => {
          const rows = tables[table] ?? [];
          return { data: call.inIds ? rows.filter((r) => call.inIds!.includes(r.id)) : rows, error: null };
        },
      };
      return q;
    },
  }),
}));

import { leadershipOwnerNames, qualifiesForOwnerMenu } from "./owners.server";
import { ownerMenu } from "./lib/ownerMenu";

const row = (id: string, effective: string | null, app: string | null, appStatus = "active", status = "active") => ({ employee_id: id, email_address: `${id}@example.test`, employment_status: status, effective_role: effective, app_user_role: app, app_user_status: appStatus });
const person = (id: string, first: string, last: string, extra: Record<string, unknown> = {}) => ({ id, first_name: first, last_name: last, preferred_first_name: null, termination_date: null, ...extra });

beforeEach(() => {
  calls.length = 0;
  tables.employee_access_preview = [
    row("e1", "district_manager", "district_manager"), // a DM by Woven position
    row("e2", null, "regional_manager"), // an unmapped Woven position (e.g. Operations), RM in Ask Sunny
    row("e3", "admin", "admin"), // a protected override
    row("e4", null, "district_manager", "disabled"), // a disabled account and no Woven role: not listed
    row("e5", "district_manager", null, "active", "terminated"), // terminated in Woven: not listed
    row("e6", "salon_director", "salon_director"), // below DM: not listed
    row("e7", "district_manager", null), // a DM with no account yet
  ];
  tables.employee_access_directory = [
    person("e1", "Avery", "Quill"),
    person("e2", "Bo", "Lark", { preferred_first_name: "Bobby" }),
    person("e3", "Cy", "Marlow"),
    person("e4", "Dee", "Wren"),
    person("e5", "Eli", "Sorrel"),
    person("e6", "Fay", "Linden"),
    person("e7", "Gus", "Hollow", { termination_date: "2026-11-01" }), // the directory says terminated: not listed
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DM-or-higher people from Woven for the L10 owner menus", () => {
  it('"add them in the drop down except" the people named in L10_OWNER_MENU_EXCLUDE_EMAILS (the owner, 18 Nov 2026)', async () => {
    vi.stubEnv("L10_OWNER_MENU_EXCLUDE_EMAILS", " E3@Example.test , e7@example.test,not-an-email");
    expect(await leadershipOwnerNames()).toEqual(["Avery Quill", "Bobby Lark"]);
  });

  it("lists active Woven employees who are DM or higher by Woven's role or by their active Ask Sunny account, with Woven full names", async () => {
    expect(await leadershipOwnerNames()).toEqual(["Avery Quill", "Bobby Lark", "Cy Marlow"]);
    // Only the rows that can qualify are read, then only those people's names.
    expect(calls[0].or).toBe("effective_role.in.(district_manager,regional_manager,admin,owner),app_user_role.in.(district_manager,regional_manager,admin,owner)");
    expect(calls[1].inIds).toEqual(["e1", "e2", "e3", "e7"]);
  });

  it("a salon director, a disabled account with no Woven role and a terminated employee do not qualify", () => {
    expect(qualifiesForOwnerMenu(row("x", "salon_director", "salon_director"))).toBe(false);
    expect(qualifiesForOwnerMenu(row("x", null, "district_manager", "disabled"))).toBe(false);
    expect(qualifiesForOwnerMenu(row("x", "district_manager", "district_manager", "active", "terminated"))).toBe(false);
  });

  it("a failed read gives an empty list (the menus keep the meeting's own people)", async () => {
    tables.employee_access_preview = undefined as unknown as Record<string, unknown>[];
    expect(await leadershipOwnerNames()).toEqual([]);
  });

  it("the menu: the meeting's people first, then the others, nobody twice", () => {
    expect(ownerMenu(["Avery Quill", "Hal Brook"], ["avery  quill", "Bobby Lark", "Cy Marlow", "Bobby Lark"])).toEqual(["Avery Quill", "Hal Brook", "Bobby Lark", "Cy Marlow"]);
  });
});
