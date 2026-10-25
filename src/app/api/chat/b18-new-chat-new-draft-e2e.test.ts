import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * B18 — A NEW CHAT'S CARD OPENED ANOTHER CHAT'S DRAFT (25 OCT 2026)
 * ============================================================================
 *
 * Ported from Ask Bubbles, where it happened on the full remap (on there). The
 * same constant was in this app's remap card; FORM_FULL_REMAP_ENABLED is off
 * here in production, so the remap cases run with it on, and the live intent
 * path runs the same turns too. The sibling's production turns:
 *
 * conv_mvnuktv82h8v0yo: "create a CA for Test Employee at Kearney for being
 * late to open on 10-20-26, verbal, no payroll", Create draft — a draft.
 *
 * conv_mvnurfc02cj2y7l, a NEW chat: "create a written CA for Test Employee at
 * Kearney for missing the 10-15-26 woven deadline", Create draft — and
 * POST /api/forms/instances answered with the late-open draft, `reused`. No
 * new form, and none of the Woven facts. Again in conv_mvo04zpj2itwby5 (B19,
 * CONVERSATION_DRAFT_REUSE_ENABLED off), where "add that she was also on her
 * phone" then rewrote the other chat's draft: the card had opened it.
 *
 * THE CAUSE. The full remap's card (`form-full-remap.ts`, `proposalFor`) had a
 * fixed proposal id, "form-remap". A proposal id names ONE card: the create
 * route's card-id match (`findRecentAssistantDraft`) returns the draft "this
 * card" already made, and `createInstance` files a card's form under an id
 * derived from the manager, the form and the card id (`cardInstanceId`). With
 * one id for every remap card, every later Corrective Action card of that
 * manager was "the same card" as the first, in any chat, for any incident.
 *
 * Every turn goes through POST /api/chat on the full remap, and on the intent
 * path (this app's live form path), with the draft flags on, the card's Create through
 * `createInlineForm` and the real create and draft routes. Faked: identity,
 * the database (in-memory), the models, analytics. "Test Employee" is the
 * production test account's own placeholder name.
 */

const store = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
  chat_conversations: [],
  chat_messages: [],
  chat_traces: [],
  chat_form_state: [],
  chat_form_incidents: [],
} as unknown as FakeStore & Record<string, Record<string, unknown>[]>;

/** Off: the stand-in extraction model leaves `observation` empty, so the card's What happened is the app's own reading. */
const model = vi.hoisted(() => ({ observation: true }));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return { ...actual, assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} };
});
vi.mock("@/lib/config/server-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/server-env")>();
  return { ...actual, liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }) };
});
vi.mock("@/lib/auth/server", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "salon_director" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: "salon_director",
          scope: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});
vi.mock("@/lib/analytics/record", () => ({
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));

/** The latest manager turn, as the stand-in extraction model reads it. */
function lastManagerTurn(input: { messages?: { content?: unknown }[] }): string {
  const text = JSON.stringify(input.messages ?? []);
  return text.split(/Manager:|User:/i).pop() ?? text;
}

/** What the stand-in extraction models read from the latest manager turn. */
function slotsOf(last: string) {
  return {
    templateKey: /\b(?:ca|corrective action)\b/i.test(last) ? "dpoa" : null,
    employeeName: /test employee/i.test(last) ? "Test Employee" : /quinn ledgertest/i.test(last) ? "Quinn Ledgertest" : null,
    jobTitle: null,
    observation: !model.observation
      ? null
      : /woven/i.test(last)
      ? "missing the 10-15-26 woven deadline"
      : /late to open/i.test(last)
        ? "being late to open"
        : null,
    actionPlan: null,
    warningLevel: /\bwritten\b/i.test(last) ? "written" : /\bverbal\b/i.test(last) ? "verbal" : null,
  };
}

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => "A grounded answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    const last = lastManagerTurn(input);
    const slots = slotsOf(last);
    if (input.tool?.name === "extract_form_fields") return slots;
    if (input.tool?.name !== "record_intent_slots") return null;
    return {
      employee: slots.employeeName,
      store: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: slots.warningLevel,
      formType: slots.templateKey ? "Corrective Action Form" : null,
      formTurn: Boolean(slots.templateKey),
    };
  },
  callClaudeToolDetailed: async (input: { messages?: { content?: unknown }[] }) => ({
    input: slotsOf(lastManagerTurn(input)),
    inputTokens: 1,
    outputTokens: 1,
  }),
}));

/** The drafting model: it writes the incident the conversation describes. */
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        if (request.tool_choice?.name === "revise_form_fields") {
          return {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                name: "revise_form_fields",
                input: { values: { observation: "Observed:\nTest Employee missed the 10-15-26 Woven deadline. She was also on her phone." } },
              },
            ],
          };
        }
        const woven = /woven/i.test(JSON.stringify(request));
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: "write_form_fields",
              input: {
                values: {
                  observation: woven
                    ? "Observed:\nTest Employee missed the 10-15-26 Woven deadline.\n\nExpectation:\nWoven courses are completed by the deadline.\n\nGoing Forward:\nComplete Woven courses on time."
                    : "Observed:\nTest Employee was late to open on 10-20-26.\n\nExpectation:\nThe salon opens on time.\n\nGoing Forward:\nArrive in time to open.",
                },
                checked: {},
              },
            },
          ],
        };
      },
    },
  }),
}));
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
    }
  },
}));
vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("not on the server");
  },
}));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATA_REASON: "no dataset",
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

/* Each case loads the template library and runs several routes; a shared machine needs more than 5s. */
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  joinOverview();
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  joinOverview();
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

/*
 * The cross-chat guard reads `employee_name` with `ilike`, which the shared
 * fake does not model. Modelled here only, on `form_instances` only, as
 * case-insensitive equality (see `qa-f8-draft-actions-e2e.test.ts`).
 */
{
  const proto = Object.getPrototypeOf(fakeSupabase(store).from("form_instances")) as Record<string, unknown>;
  proto.ilike = function (
    this: { table: string; filters: ((row: Record<string, unknown>) => boolean)[] },
    column: string,
    pattern: string,
  ) {
    if (this.table !== "form_instances") throw new TypeError(`fake-supabase: ilike is not modelled for ${this.table}`);
    this.filters.push((row) => String(row[column] ?? "").toLowerCase() === pattern.toLowerCase());
    return this;
  };
}

let sequence = 0;

type Reply = { content: string; formProposal?: ChatFormProposal; formUpdate?: { instanceId: string; updated: string[] } };

/** One turn through POST /api/chat, the browser's whole messages as history. */
async function say(
  chat: { id: string; messages: ChatMessage[]; proposal: ChatFormProposal | null; instanceId: string | null },
  question: string,
): Promise<Reply> {
  const index = chat.messages.length;
  const id = `msg_${chat.id}u${index}`;
  const response = await chatRoute.POST(
    new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        mode: "standard",
        history: chat.messages.map(({ id: messageId, role, content }) => ({ id: messageId, role, content })),
        questionMessageId: id,
        ...(chat.proposal && !chat.instanceId ? { continueProposalTemplateKey: chat.proposal.templateKey } : {}),
        ...(chat.instanceId ? { activeFormInstanceId: chat.instanceId } : {}),
      }),
    }),
  );
  const payload = (await response.json()) as Reply & { error?: string };
  expect(response.status, JSON.stringify(payload)).toBe(200);
  if (payload.formProposal) chat.proposal = payload.formProposal;
  chat.messages.push(
    { id, role: "user", content: question, createdAt: "2026-10-25T13:12:24Z" } as ChatMessage,
    {
      id: `msg_${chat.id}a${index}`,
      role: "assistant",
      content: payload.content,
      createdAt: "2026-10-25T13:12:28Z",
      ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
    } as ChatMessage,
  );
  return payload;
}

/** One chat: each turn through POST /api/chat, then Create draft on the last card. */
async function chatThenCreate(turns: readonly string[]) {
  sequence += 1;
  const chat = { id: `b18c${sequence}`, messages: [] as ChatMessage[], proposal: null as ChatFormProposal | null, instanceId: null as string | null };
  for (const question of turns) await say(chat, question);
  expect(chat.proposal, "no card to create from").not.toBeNull();
  const result = await createInlineForm({ proposal: chat.proposal!, messages: chat.messages, call, onCreated: () => {} });
  chat.instanceId = result.reference.instanceId;
  return { chat, proposal: chat.proposal!, id: result.reference.instanceId, reused: Boolean(result.reused) };
}

/** Every stored field of one form, in a stable order, to compare before and after. */
const fieldsOf = (id: string) =>
  JSON.stringify(
    (store.form_instance_values ?? [])
      .filter((entry) => entry.instance_id === id)
      .map((entry) => [entry.field_key, entry.value ?? null, entry.checked ?? []])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
const eventsOf = (id: string) => (store.form_instance_events ?? []).filter((entry) => entry.instance_id === id).length;
const row = (id: string) => (store.form_instances ?? []).find((entry) => entry.id === id) ?? null;
const valueOf = (id: string, key: string) =>
  (store.form_instance_values ?? []).find((entry) => entry.instance_id === id && entry.field_key === key);

/* Production, conv_mvnuktv82h8v0yo then conv_mvnurfc02cj2y7l, 25 Oct 2026. */
const LATE_OPEN = "create a CA for Test Employee at Kearney for being late to open on 10-20-26, verbal, no payroll";
const WOVEN = "create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline";

/*
 * The sibling's B19 set: the full remap and DRAFT_ACTIONS_ENABLED on,
 * CONVERSATION_DRAFT_REUSE_ENABLED off. Every other draft guard is tried on as
 * well. This app has no CROSS_CHAT_DRAFT_DEDUPE_ENABLED: its any-chat reopen
 * (`findOpenIncidentDraft`) is always on, and runs in every case here.
 */
const PRODUCTION_FLAGS = ["FORM_FULL_REMAP_ENABLED", "DRAFT_ACTIONS_ENABLED"] as const;
const DEDUPE_FLAGS = ["CONVERSATION_DRAFT_REUSE_ENABLED", "CONVERSATION_PROPOSAL_DEDUPE_ENABLED", "DRAFT_DEDUPE_ENABLED"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(async () => {
  for (const key of Object.keys(store)) store[key] = [];
  model.observation = true;
  for (const name of [...PRODUCTION_FLAGS, ...DEDUPE_FLAGS, "INTENT_EXTRACTION_ENABLED", "REMAP_INCIDENT_FIX_ENABLED"]) saved.set(name, process.env[name]);
  for (const name of PRODUCTION_FLAGS) process.env[name] = "on";
  for (const name of DEDUPE_FLAGS) delete process.env[name];
  delete process.env.INTENT_EXTRACTION_ENABLED;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T13:12:24Z"));
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  vi.useRealTimers();
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("B18: a new chat about a different incident files a new draft (full remap)", () => {
  it.each([["production flags"], ...DEDUPE_FLAGS.map((name) => [`production flags + ${name}`]), ["every draft guard on"]])(
    '"create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline" in a new chat is a new form with the Woven facts (%s)',
    async (label) => {
      for (const name of DEDUPE_FLAGS) {
        if (label.endsWith(name) || label === "every draft guard on") process.env[name] = "on";
      }
      const late = await chatThenCreate([LATE_OPEN]);
      expect(late.reused).toBe(false);
      expect(row(late.id)?.form_date).toBe("2026-10-20");

      const woven = await chatThenCreate([WOVEN]);
      expect(woven.proposal.formDate).toBe("2026-10-15");
      expect(woven.proposal.warningLevel).toBe("written");
      // Before the fix: the late-open draft came back, `reused`.
      expect(woven.id).not.toBe(late.id);
      expect(woven.reused).toBe(false);
      expect(woven.proposal.proposalId).not.toBe(late.proposal.proposalId);

      // The Woven card's facts are on the new form; the late-open draft is as it was.
      expect(row(woven.id)?.status).toBe("draft");
      expect(row(woven.id)?.form_date).toBe("2026-10-15");
      expect(valueOf(woven.id, "form_date")?.value).toBe("2026-10-15");
      expect(valueOf(woven.id, "warning_type")?.checked).toEqual(["written"]);
      expect(valueOf(woven.id, "payroll_deduct")?.checked ?? []).toEqual([]);
      expect(row(late.id)?.form_date).toBe("2026-10-20");
      expect(valueOf(late.id, "warning_type")?.checked).toEqual(["verbal"]);
      expect(valueOf(late.id, "payroll_deduct")?.checked).toEqual(["no"]);
      expect((store.form_instances ?? []).filter((entry) => entry.status === "draft")).toHaveLength(2);
    },
  );

  it.each([["B19 flags"], ["every draft guard on"]])(
    '"add that she was also on her phone" in the new chat changes the new form, never the other chat\'s draft (%s)',
    async (label) => {
      if (label === "every draft guard on") for (const name of DEDUPE_FLAGS) process.env[name] = "on";
      const late = await chatThenCreate([LATE_OPEN]);
      const lateBefore = fieldsOf(late.id);
      const lateEvents = eventsOf(late.id);
      const woven = await chatThenCreate([WOVEN]);
      expect(woven.id).not.toBe(late.id);

      // Before the fix the card had opened the late-open draft, and this turn rewrote it (B19).
      const update = await say(woven.chat, "add that she was also on her phone");
      expect(update.formUpdate?.instanceId).toBe(woven.id);
      expect(fieldsOf(late.id)).toBe(lateBefore);
      expect(eventsOf(late.id)).toBe(lateEvents);
      expect(row(late.id)?.form_date).toBe("2026-10-20");
    },
  );

  it("two remap cards for DIFFERENT employees by the same manager are two forms", async () => {
    const first = await chatThenCreate([LATE_OPEN]);
    // Synthetic second employee, the same manager, form and words.
    const second = await chatThenCreate([LATE_OPEN.replace("Test Employee", "Quinn Ledgertest")]);
    expect(second.proposal.employeeName).toBe("Quinn Ledgertest");
    expect(second.id).not.toBe(first.id);
    expect(second.reused).toBe(false);
    expect(row(first.id)?.employee_name).toBe("Test Employee");
    expect(row(second.id)?.employee_name).toBe("Quinn Ledgertest");
  });

  it("a second press of the same card still opens the draft that card made", async () => {
    const first = await chatThenCreate([WOVEN]);
    const again = await createInlineForm({
      proposal: first.proposal,
      messages: [
        { id: "msg_b18again", role: "user", content: WOVEN, createdAt: "2026-10-25T13:17:32Z" } as ChatMessage,
        {
          id: "msg_b18againa",
          role: "assistant",
          content: "Here is the Corrective Action Form.",
          createdAt: "2026-10-25T13:17:35Z",
          formProposal: first.proposal,
        } as ChatMessage,
      ],
      call,
      onCreated: () => {},
    });
    expect(again.reference.instanceId).toBe(first.id);
    expect(again.reused).toBe(true);
  });
});

describe("B18 on this app's live form path (intent extraction, full remap off)", () => {
  it('"create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline" in a new chat is a new form', async () => {
    process.env.FORM_FULL_REMAP_ENABLED = "off";
    process.env.INTENT_EXTRACTION_ENABLED = "on";
    const late = await chatThenCreate([LATE_OPEN]);
    const lateBefore = fieldsOf(late.id);
    const woven = await chatThenCreate([WOVEN]);
    expect(woven.proposal.formDate).toBe("2026-10-15");
    expect(woven.id).not.toBe(late.id);
    expect(woven.reused).toBe(false);
    expect(row(woven.id)?.form_date).toBe("2026-10-15");
    const update = await say(woven.chat, "add that she was also on her phone");
    if (update.formUpdate) expect(update.formUpdate.instanceId).toBe(woven.id);
    expect(fieldsOf(late.id)).toBe(lateBefore);
  });
});

/* With REMAP_INCIDENT_FIX_ENABLED on, as in the sibling app's test. */
describe("the new remap card's What happened is the manager's incident (REMAP_INCIDENT_FIX_ENABLED on)", () => {
  it("no call no show, and the Woven deadline", async () => {
    process.env.REMAP_INCIDENT_FIX_ENABLED = "on";
    model.observation = false;
    const noCall = await chatThenCreate(["create a written CA for Test Employee at Kearney for a no call no show on 10-22-26"]);
    expect(noCall.proposal.issue).toBe("no call no show");
    const woven = await chatThenCreate([WOVEN]);
    expect(woven.proposal.issue).toBe("missing the 10-15-26 woven deadline");
    expect(woven.id).not.toBe(noCall.id);
  });
});
