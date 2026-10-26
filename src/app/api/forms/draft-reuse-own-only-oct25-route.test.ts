import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * POST /api/forms/instances — DRAFT_REUSE_OWN_DRAFTS_ONLY_ENABLED (QA, 25 OCT 2026)
 * ============================================================================
 *
 * QA: a manager's create from chat could reopen an open draft for the same
 * employee, template and incident that ANOTHER manager made
 * (`findOpenIncidentDraft` read `form_instances` with no `created_by`).
 *
 * Here the real route and the real `findOpenIncidentDraft` run against a
 * small in-memory `form_instances` table. Faked: identity, the template
 * lookup, and the instance writes. Every name is invented.
 */

const ORIGINAL = { ...process.env };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const FLAG = "DRAFT_REUSE_OWN_DRAFTS_ONLY_ENABLED";
const DATE = "2026-10-20";

type Row = Record<string, unknown>;

/** One recorded read: the table, the columns selected, and every eq filter. */
interface Read {
  table: string;
  columns: string;
  eq: Record<string, unknown>;
}

/** Just enough of the Supabase query builder for `findOpenIncidentDraft`. */
function fakeAdmin(tables: Record<string, Row[]>, reads: Read[]) {
  return {
    from(table: string) {
      const read: Read = { table, columns: "", eq: {} };
      const tests: ((row: Row) => boolean)[] = [];
      const rows = () => (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
      const builder = {
        select(columns: string) {
          read.columns = columns;
          reads.push(read);
          return builder;
        },
        eq(column: string, value: unknown) {
          read.eq[column] = value;
          tests.push((row) => row[column] === value);
          return builder;
        },
        ilike(column: string, value: string) {
          tests.push((row) => String(row[column] ?? "").toLowerCase() === value.toLowerCase());
          return builder;
        },
        in(column: string, values: unknown[]) {
          tests.push((row) => values.includes(row[column]));
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function draft(id: string, createdBy: string): Row {
  return {
    id,
    template_id: "tpl-dpoa-row",
    status: "draft",
    employee_name: "Rowan Testcase",
    location_id: null,
    created_at: "2026-10-20T15:00:00Z",
    form_date: DATE,
    created_by: createdBy,
  };
}

async function load(drafts: Row[]) {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();
  const created: Row[] = [];
  const reads: Read[] = [];
  const tables: Record<string, Row[]> = {
    form_templates: [{ id: "tpl-dpoa-row", key: "dpoa" }],
    form_instances: drafts,
    form_instance_values: [],
  };

  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeAdmin(tables, reads) }));
  vi.doMock("@/lib/auth/server", async () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: "manager-b",
        email: "manager-b@example.test",
        displayName: "Manager B",
        role: "admin",
        scope: GLOBAL,
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));
  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async (key: string) =>
      key === "dpoa"
        ? { id: "tpl-dpoa", key: "dpoa", name: "Corrective Action Form", requiredPermission: "create_coaching_form", active: true }
        : null,
  }));
  vi.doMock("@/lib/forms/instances", () => ({
    DUPLICATE_DRAFT_WINDOW_HOURS: 24,
    loadInstance: async (id: string) => {
      const found = tables.form_instances!.find((row) => row.id === id);
      return found ? { instance: { id, status: "draft", formDate: found.form_date, createdBy: found.created_by } } : null;
    },
    createInstance: async (input: Row) => {
      created.push(input);
      return { id: "inst-new", ...input };
    },
    applyStatedFacts: async () => undefined,
    findRecentAssistantDraft: async () => null,
    listInstances: async () => [],
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    deleteDemoInstances: async () => ({ deleted: 0 }),
    InstanceProtectedError: class extends Error {},
  }));

  const route = await import("./instances/route");
  return { route, created, reads };
}

/**
 * The same manager turn in five registers (QA rule, 26 Oct 2026): sentence
 * case with the name Capitalized (as typed in the original report), sentence
 * case with the name typed lowercase, real register (all lowercase, no
 * punctuation or greeting, impatient, abbreviated, a typo), and, optionally,
 * all-uppercase flips. The card carries the name the way the turn wrote it.
 * Every case below runs all five and expects the same outcome: names and
 * keywords read the same whatever their case.
 */
const TURNS = [
  {
    register: "sentence case, name Capitalized (as reported)",
    employeeName: "Rowan Testcase",
    content: "create a CA for Rowan Testcase, she opened 40 minutes late on 10-20-26",
  },
  {
    register: "sentence case, name typed lowercase",
    employeeName: "rowan testcase",
    content: "Create a CA for rowan testcase, she opened 40 minutes late on 10-20-26.",
  },
  {
    register: "ALL UPPERCASE",
    employeeName: "ROWAN TESTCASE",
    content: "CREATE A CA FOR ROWAN TESTCASE, SHE OPENED 40 MINUTES LATE ON 10-20-26",
  },
  {
    register: "lowercase, no punctuation, abbreviated, typo",
    employeeName: "rowan testcase",
    content: "ca for rowan testcase she opend 40 min late 10 20 26 just do it already",
  },
  {
    register: "lowercase turn flipped to ALL UPPERCASE",
    employeeName: "ROWAN TESTCASE",
    content: "CA FOR ROWAN TESTCASE SHE OPEND 40 MIN LATE 10 20 26 JUST DO IT ALREADY",
  },
] as const;

type Turn = (typeof TURNS)[number];

function post(turn: Turn): Request {
  return new Request("https://app.test/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      templateKey: "dpoa",
      employeeName: turn.employeeName,
      variantKey: null,
      employeeRole: null,
      locationId: null,
      source: "ask_sunny",
      formDate: DATE,
      conversation: [{ id: "m1", role: "user", content: turn.content }],
    }),
  });
}

function instanceReads(reads: Read[]): Read[] {
  return reads.filter((read) => read.table === "form_instances");
}

beforeEach(() => {
  vi.resetModules();
  delete process.env[FLAG];
  delete process.env.DRAFT_DEDUPE_ENABLED;
  delete process.env.CONVERSATION_DRAFT_REUSE_ENABLED;
  delete process.env.DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED;
  delete process.env.DRAFT_ACTIONS_ENABLED;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/supabase/server", "@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) {
    vi.doUnmock(mod);
  }
  vi.resetModules();
});

describe.each(TURNS)("DRAFT_REUSE_OWN_DRAFTS_ONLY_ENABLED on, manager turn $register", (turn) => {
  it("files a new draft instead of handing manager B manager A's open draft", async () => {
    process.env[FLAG] = "1";
    const { route, created, reads } = await load([draft("draft-manager-a", "manager-a")]);
    const response = await route.POST(post(turn));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { instance: { id: string }; reused?: boolean };
    expect(body.reused).toBeUndefined();
    expect(body.instance.id).toBe("inst-new");
    expect(created).toHaveLength(1);
    expect(created[0]!.createdBy).toBe("manager-b");
    expect(instanceReads(reads)[0]!.eq.created_by).toBe("manager-b");
  });

  it("still reopens manager B's own matching open draft", async () => {
    process.env[FLAG] = "1";
    const { route, created } = await load([
      draft("draft-manager-a", "manager-a"),
      draft("draft-manager-b", "manager-b"),
    ]);
    const response = await route.POST(post(turn));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { instance: { id: string }; reused?: boolean };
    expect(body.reused).toBe(true);
    expect(body.instance.id).toBe("draft-manager-b");
    expect(created).toEqual([]);
  });
});

describe.each(TURNS)("DRAFT_REUSE_OWN_DRAFTS_ONLY_ENABLED off (the default), manager turn $register", (turn) => {
  it("reopens another manager's matching open draft, as today, with the query unchanged", async () => {
    const { route, created, reads } = await load([draft("draft-manager-a", "manager-a")]);
    const response = await route.POST(post(turn));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { instance: { id: string }; reused?: boolean };
    expect(body.reused).toBe(true);
    expect(body.instance.id).toBe("draft-manager-a");
    expect(created).toEqual([]);
    const [read] = instanceReads(reads);
    expect(read!.columns).toBe("id, employee_name, location_id, created_at, form_date");
    expect(read!.eq).toEqual({ template_id: "tpl-dpoa-row", status: "draft", form_date: DATE });
  });
});
