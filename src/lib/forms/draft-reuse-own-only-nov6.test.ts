import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DRAFT_REUSE_OWN_ONLY_ENABLED (QA, 25 Oct 2026; rebuilt 6 Nov 2026), below
 * the route: `findOpenIncidentDraft` and `findResentDraft` with the flag on
 * read only `created_by`'s drafts in the query, check the loaded draft's
 * creator again, and a lookup with no acting user finds nothing. Off, as
 * before. Names are invented.
 */

const FLAG = "DRAFT_REUSE_OWN_ONLY_ENABLED";
const ORIGINAL = { ...process.env };
const DATE = "2026-10-20";

type Row = Record<string, unknown>;

/** A fake that reads every row whatever the filters, so only the draft check decides. */
function fakeAdmin(tables: Record<string, Row[]>, eqs: Record<string, unknown>[]) {
  return {
    from(table: string) {
      const eq: Record<string, unknown> = {};
      const builder = {
        select() {
          if (table === "form_instances") eqs.push(eq);
          return builder;
        },
        eq(column: string, value: unknown) {
          eq[column] = value;
          return builder;
        },
        gte: () => builder,
        ilike: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

async function load() {
  vi.resetModules();
  const eqs: Record<string, unknown>[] = [];
  const tables: Record<string, Row[]> = {
    form_templates: [{ id: "tpl-row", key: "dpoa" }],
    form_instances: [
      { id: "draft-manager-a", employee_name: "Rowan Testcase", location_id: null, created_at: new Date().toISOString(), form_date: DATE, created_by: "manager-a" },
    ],
  };
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeAdmin(tables, eqs) }));
  vi.doMock("./instances", () => ({
    DUPLICATE_DRAFT_WINDOW_HOURS: 24,
    loadInstance: async (id: string) => ({ instance: { id, status: "draft", createdBy: "manager-a" } }),
  }));
  return { ...(await import("./draft-reopen")), eqs };
}

const wanted = { templateKey: "dpoa", employeeName: "Rowan Testcase", createdBy: "manager-b", locationId: null, formDate: DATE };

beforeEach(() => {
  delete process.env[FLAG];
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["server-only", "@/lib/supabase/server", "./instances"]) vi.doUnmock(mod);
  vi.resetModules();
});

describe("findOpenIncidentDraft", () => {
  it("flag off: any manager's draft, and the query has no created_by, as before", async () => {
    const { findOpenIncidentDraft, eqs } = await load();
    expect((await findOpenIncidentDraft(wanted))?.id).toBe("draft-manager-a");
    expect(eqs[0]).not.toHaveProperty("created_by");
  });
  it("flag on: the query reads only manager B's drafts, and manager A's draft is never handed back", async () => {
    process.env[FLAG] = "1";
    const { findOpenIncidentDraft, eqs } = await load();
    expect(await findOpenIncidentDraft(wanted)).toBeNull();
    expect(eqs[0]!.created_by).toBe("manager-b");
  });
  it("flag on: no acting user reads nothing", async () => {
    process.env[FLAG] = "1";
    const { findOpenIncidentDraft, eqs } = await load();
    expect(await findOpenIncidentDraft({ ...wanted, createdBy: "" })).toBeNull();
    expect(eqs).toEqual([]);
  });
});

describe("findResentDraft", () => {
  it("flag on: never hands manager B a draft manager A made; no acting user reads nothing", async () => {
    process.env[FLAG] = "1";
    const { findResentDraft, eqs } = await load();
    expect(await findResentDraft(wanted)).toBeNull();
    expect(await findResentDraft({ ...wanted, createdBy: "" })).toBeNull();
    expect(eqs).toHaveLength(1);
  });
});
