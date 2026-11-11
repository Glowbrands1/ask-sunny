import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * POST /api/forms/instances — DRAFT_REUSE_OWN_ONLY_ENABLED (QA, 25 OCT 2026)
 * ============================================================================
 *
 * QA: a manager's create from chat could reopen an open draft for the same
 * employee, template and incident that ANOTHER manager made
 * (`findOpenIncidentDraft` read `form_instances` with no `created_by`; the
 * route passed `createdBy` and the query ignored it). It runs on every chat
 * create, with no flag. Rebuilt on 6 Nov 2026 from the old pull request's
 * route test: manager A has an open draft; manager B, at the same salon, asks
 * for the same employee and form in a chat of their own.
 *
 * Production today (QA's Vercel read): DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED on.
 * One flag away from the leak, and the same-chat key is whatever the browser
 * sends. So every combination of the draft-reuse flags runs here, with B's own
 * chat key and with A's chat key forged into B's request.
 *
 * The real route and the real finders run against a small in-memory
 * database. Faked: identity, the template lookup, and the instance writes.
 * Every name is invented.
 */

// The first test imports the whole route; on a loaded machine that alone can take longer than 5 s.
vi.setConfig({ testTimeout: 30_000 });

const ORIGINAL = { ...process.env };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const FLAG = "DRAFT_REUSE_OWN_ONLY_ENABLED";
const DATE = "2026-10-20";
/** The chat manager A made the draft in, and manager B's own new chat. */
const CHAT_A = "chat-a-m1";
const CHAT_B = "chat-b-m1";

type Row = Record<string, unknown>;

/** One recorded read: the table, the columns selected, and every eq filter. */
interface Read {
  table: string;
  columns: string;
  eq: Record<string, unknown>;
}

/** Just enough of the Supabase query builder for the draft finders. */
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
        gte(column: string, value: string) {
          tests.push((row) => String(row[column] ?? "") >= value);
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
        update() {
          return builder;
        },
        upsert: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function draft(id: string, createdBy: string, chat: string): { row: Row; event: Row } {
  return {
    row: {
      id,
      template_id: "tpl-dpoa-row",
      status: "draft",
      source: "ask_sunny",
      employee_name: "Rowan Testcase",
      location_id: null,
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
      form_date: DATE,
      created_by: createdBy,
    },
    event: { instance_id: id, kind: "created", detail: { draftConversation: chat } },
  };
}

async function load(drafts: { row: Row; event: Row }[], subject = "manager-b") {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();
  const created: Row[] = [];
  const reads: Read[] = [];
  const tables: Record<string, Row[]> = {
    form_templates: [{ id: "tpl-dpoa-row", key: "dpoa" }],
    form_instances: drafts.map((entry) => entry.row),
    form_instance_values: [],
    form_instance_events: drafts.map((entry) => entry.event),
    chat_form_incidents: [],
  };

  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeAdmin(tables, reads) }));
  vi.doMock("@/lib/auth/server", async () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject,
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
 * Manager B's turn, as the old pull request's test had it: sentence case
 * with the name Capitalized (as reported), and the real register (all
 * lowercase, abbreviated, a typo). The card carries the name as typed.
 */
const TURNS = [
  {
    register: "sentence case (as reported)",
    employeeName: "Rowan Testcase",
    content: "create a CA for Rowan Testcase, she opened 40 minutes late on 10-20-26",
  },
  {
    register: "lowercase, abbreviated, typo",
    employeeName: "rowan testcase",
    content: "ca for rowan testcase she opend 40 min late 10 20 26 just do it already",
  },
] as const;

type Turn = (typeof TURNS)[number];

function post(turn: Turn, chatKey: string): Request {
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
      conversation: [{ id: chatKey, role: "user", content: turn.content }],
    }),
  });
}

/** Every other flag that decides whether a create reuses a draft. */
const REUSE_FLAGS = [
  "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "DRAFT_DEDUPE_ENABLED",
  "CONVERSATION_DRAFT_REUSE_ENABLED",
] as const;

type Combo = { name: string; on: readonly string[]; chatKey: string; forged: boolean };

/** All 16 on/off combinations of REUSE_FLAGS, each with B's own chat key and with A's forged. */
const COMBOS: Combo[] = Array.from({ length: 1 << REUSE_FLAGS.length }, (_, mask) =>
  REUSE_FLAGS.filter((_, bit) => mask & (1 << bit)),
).flatMap((on) =>
  [CHAT_B, CHAT_A].map((chatKey) => ({
    name: `${on.length ? on.map((flag) => flag.replace(/_ENABLED$/, "")).join("+") : "none"} on, ${chatKey === CHAT_A ? "A's chat key forged" : "B's own chat"}`,
    on,
    chatKey,
    forged: chatKey === CHAT_A,
  })),
);

function setFlags(on: readonly string[], ownOnly: boolean): void {
  for (const flag of [...REUSE_FLAGS, FLAG, "DRAFT_ACTIONS_ENABLED"]) delete process.env[flag];
  for (const flag of on) process.env[flag] = "1";
  if (ownOnly) process.env[FLAG] = "1";
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/supabase/server", "@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) {
    vi.doUnmock(mod);
  }
  vi.resetModules();
});

describe.each(TURNS)("DRAFT_REUSE_OWN_ONLY_ENABLED on, manager B's turn $register", (turn) => {
  it.each(COMBOS)("$name: B gets a NEW draft, never manager A's", async ({ on, chatKey }) => {
    setFlags(on, true);
    const { route, created, reads } = await load([draft("draft-manager-a", "manager-a", CHAT_A)]);
    const response = await route.POST(post(turn, chatKey));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { instance: { id: string }; reused?: boolean };
    expect(body.reused).toBeUndefined();
    expect(body.instance.id).toBe("inst-new");
    expect(created).toHaveLength(1);
    expect(created[0]!.createdBy).toBe("manager-b");
    // In the query, not only after it: every form_instances read is B's drafts only.
    for (const read of reads.filter((entry) => entry.table === "form_instances")) {
      expect(read.eq.created_by, JSON.stringify(read)).toBe("manager-b");
    }
  });

  it("with no acting user, nothing is reused, not even a draft with no creator", async () => {
    setFlags([], true);
    const { route, created, reads } = await load([draft("draft-nobody", "", CHAT_B)], "");
    const body = (await (await route.POST(post(turn, CHAT_B))).json()) as { reused?: boolean };
    expect(body.reused).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(reads.filter((entry) => entry.table === "form_instances")).toEqual([]);
  });

  it("still reopens manager B's own matching open draft (same chat only on)", async () => {
    setFlags(["DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED"], true);
    const { route, created } = await load([
      draft("draft-manager-a", "manager-a", CHAT_A),
      draft("draft-manager-b", "manager-b", CHAT_B),
    ]);
    const body = (await (await route.POST(post(turn, CHAT_B))).json()) as { instance: { id: string }; reused?: boolean };
    expect(body.reused).toBe(true);
    expect(body.instance.id).toBe("draft-manager-b");
    expect(created).toEqual([]);
  });
});

describe.each(TURNS)("DRAFT_REUSE_OWN_ONLY_ENABLED off (the default), manager B's turn $register", (turn) => {
  /*
   * Today's behaviour, unchanged: the open-incident lookup (no flag) hands
   * B manager A's draft whenever the same-chat filter does not stop it — the
   * filter off, or A's chat key forged into B's request. This is the leak the
   * flag closes; it is pinned here so the flag off stays byte-for-byte.
   */
  it.each(COMBOS)("$name: as today", async ({ on, chatKey, forged }) => {
    setFlags(on, false);
    const { route, created, reads } = await load([draft("draft-manager-a", "manager-a", CHAT_A)]);
    const body = (await (await route.POST(post(turn, chatKey))).json()) as { instance: { id: string }; reused?: boolean };
    const leaks = !on.includes("DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED") || forged;
    if (leaks) {
      expect(body.reused).toBe(true);
      expect(body.instance.id).toBe("draft-manager-a");
      expect(created).toEqual([]);
      const open = reads.find((entry) => entry.table === "form_instances" && entry.columns === "id, employee_name, location_id, created_at, form_date" && !("created_by" in entry.eq));
      expect(open!.eq).toEqual({ template_id: "tpl-dpoa-row", status: "draft", form_date: DATE });
    } else {
      expect(body.reused).toBeUndefined();
      expect(created).toHaveLength(1);
    }
  });
});
