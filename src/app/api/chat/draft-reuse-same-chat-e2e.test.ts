import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED — A DRAFT IS REUSED ONLY BY ITS OWN CHAT
 * ============================================================================
 *
 * Ported from Ask Bubbles (QA, 25 Oct 2026, after the sibling's B18–B20):
 * drafts from another chat were reopened and then overwritten. A duplicate
 * draft is recoverable; an overwritten one is not. With the flag on:
 *
 *   - every lookup that hands back an existing draft keeps only a draft this
 *     chat made: here the any-chat reopen (`findOpenIncidentDraft`, always on)
 *     and DRAFT_DEDUPE_ENABLED;
 *   - the chat's own draft is not reused for a card dated differently
 *     (CONVERSATION_DRAFT_REUSE_ENABLED);
 *   - a reuse tells the card the draft's date: "Updated your open draft from
 *     <date>".
 *
 * The sibling's production turns through POST /api/chat on this app's live
 * form path (intent extraction; the full remap is off here),
 * `createInlineForm` and the real create route. Faked: identity, the database
 * (in-memory), the models, analytics. "Test Employee" is a placeholder name.
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
  chat: Chat,
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

type Chat = { id: string; messages: ChatMessage[]; proposal: ChatFormProposal | null; instanceId: string | null };

function newChat(): Chat {
  sequence += 1;
  return { id: `sc${sequence}`, messages: [], proposal: null, instanceId: null };
}

/** Create draft on the chat's latest card. */
async function createIn(chat: Chat) {
  expect(chat.proposal, "no card to create from").not.toBeNull();
  const result = await createInlineForm({ proposal: chat.proposal!, messages: chat.messages, call, onCreated: () => {} });
  chat.instanceId = result.reference.instanceId;
  return { id: result.reference.instanceId, reused: Boolean(result.reused), reusedFrom: result.reusedFrom ?? null };
}

/** The manager asks again in the same chat: a new card, not an edit of the open form. */
async function askAgain(chat: Chat, question: string) {
  chat.instanceId = null;
  await say(chat, question);
  return createIn(chat);
}

/** One chat: each turn through POST /api/chat, then Create draft on the last card. */
async function chatThenCreate(turns: readonly string[]) {
  const chat = newChat();
  for (const question of turns) await say(chat, question);
  return { chat, ...(await createIn(chat)) };
}

/** Every stored field of one form, in a stable order, to compare before and after. */
const fieldsOf = (id: string) =>
  JSON.stringify(
    (store.form_instance_values ?? [])
      .filter((entry) => entry.instance_id === id)
      .map((entry) => [entry.field_key, entry.value ?? null, entry.checked ?? []])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
const row = (id: string) => (store.form_instances ?? []).find((entry) => entry.id === id) ?? null;

/* Production, conv_mvnuktv82h8v0yo then conv_mvnurfc02cj2y7l, 25 Oct 2026. */
const LATE_OPEN = "create a CA for Test Employee at Kearney for being late to open on 10-20-26, verbal, no payroll";
const WOVEN = "create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline";

/*
 * The sibling's B19 set: the full remap and DRAFT_ACTIONS_ENABLED on,
 * CONVERSATION_DRAFT_REUSE_ENABLED off. Every other draft guard is tried on as
 * well. This app has no CROSS_CHAT_DRAFT_DEDUPE_ENABLED: its any-chat reopen
 * (`findOpenIncidentDraft`) is always on, and runs in every case here.
 */
const FLAG = "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED";
const PRODUCTION_FLAGS = ["FORM_FULL_REMAP_ENABLED", "DRAFT_ACTIONS_ENABLED"] as const;
const DEDUPE_FLAGS = ["CONVERSATION_DRAFT_REUSE_ENABLED", "CONVERSATION_PROPOSAL_DEDUPE_ENABLED", "DRAFT_DEDUPE_ENABLED"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(async () => {
  for (const key of Object.keys(store)) store[key] = [];
  model.observation = true;
  for (const name of [...PRODUCTION_FLAGS, ...DEDUPE_FLAGS, "INTENT_EXTRACTION_ENABLED", "REMAP_INCIDENT_FIX_ENABLED", FLAG]) saved.set(name, process.env[name]);
  for (const name of PRODUCTION_FLAGS) process.env[name] = "on";
  for (const name of DEDUPE_FLAGS) delete process.env[name];
  delete process.env[FLAG];
  // This app's live form path.
  process.env.FORM_FULL_REMAP_ENABLED = "off";
  process.env.INTENT_EXTRACTION_ENABLED = "on";
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

const drafts = () => (store.form_instances ?? []).filter((entry) => entry.status === "draft");
const NO_CALL = "create a CA for Test Employee at Kearney for a no call no show on 10-22-26";

describe("flag on: a draft is reused only by its own chat", () => {
  beforeEach(() => {
    process.env[FLAG] = "on";
  });

  it.each([["live flags"], ...DEDUPE_FLAGS.map((name) => [`live flags + ${name}`]), ["every draft guard on"]])(
    'the sibling\'s B18/B19 turns: "create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline" in a new chat is a new draft (%s)',
    async (label) => {
      for (const name of DEDUPE_FLAGS) if (label.endsWith(name) || label === "every draft guard on") process.env[name] = "on";
      const late = await chatThenCreate([LATE_OPEN]);
      const lateBefore = fieldsOf(late.id);
      const woven = await chatThenCreate([WOVEN]);
      expect(woven.id).not.toBe(late.id);
      expect(woven.reused).toBe(false);
      expect(row(woven.id)?.form_date).toBe("2026-10-15");
      const update = await say(woven.chat, "add that she was also on her phone");
      if (update.formUpdate) expect(update.formUpdate.instanceId).toBe(woven.id);
      expect(fieldsOf(late.id)).toBe(lateBefore);
    },
  );

  it.each([["live flags"], ...DEDUPE_FLAGS.map((name) => [`live flags + ${name}`]), ["every draft guard on"]])(
    "the SAME incident and date asked in a NEW chat is a new draft; the first chat's draft is untouched (%s)",
    async (label) => {
      for (const name of DEDUPE_FLAGS) if (label.endsWith(name) || label === "every draft guard on") process.env[name] = "on";
      const first = await chatThenCreate([LATE_OPEN]);
      const before = fieldsOf(first.id);
      const second = await chatThenCreate([LATE_OPEN]);
      expect(second.id).not.toBe(first.id);
      expect(second.reused).toBe(false);
      expect(second.reusedFrom).toBeNull();
      expect(fieldsOf(first.id)).toBe(before);
      expect(drafts()).toHaveLength(2);
    },
  );

  it.each([["the any-chat reopen alone"], ["CONVERSATION_DRAFT_REUSE_ENABLED"]])(
    "the same chat, the same incident: the draft is reused and the card says so (%s)",
    async (guard) => {
      if (guard.endsWith("_ENABLED")) process.env[guard] = "on";
      const chat = newChat();
      await say(chat, LATE_OPEN);
      const first = await createIn(chat);
      const again = await askAgain(chat, LATE_OPEN);
      expect(again.id).toBe(first.id);
      expect(again.reused).toBe(true);
      expect(again.reusedFrom).toBe("2026-10-20");
      expect(drafts()).toHaveLength(1);
    },
  );

  it("the same chat, a different date: a new draft (CONVERSATION_DRAFT_REUSE_ENABLED on)", async () => {
    process.env.CONVERSATION_DRAFT_REUSE_ENABLED = "on";
    const chat = newChat();
    await say(chat, LATE_OPEN);
    const first = await createIn(chat);
    const before = fieldsOf(first.id);
    const noCall = await askAgain(chat, NO_CALL);
    expect(noCall.id).not.toBe(first.id);
    expect(noCall.reused).toBe(false);
    expect(row(noCall.id)?.form_date).toBe("2026-10-22");
    expect(fieldsOf(first.id)).toBe(before);
  });
});

describe("flag off: unchanged", () => {
  it("the chat's own draft is reused across a date change, and nothing is said on the card (CONVERSATION_DRAFT_REUSE_ENABLED on)", async () => {
    process.env.CONVERSATION_DRAFT_REUSE_ENABLED = "on";
    const chat = newChat();
    await say(chat, LATE_OPEN);
    const first = await createIn(chat);
    const noCall = await askAgain(chat, NO_CALL);
    expect(noCall.id).toBe(first.id);
    expect(noCall.reused).toBe(true);
    expect(noCall.reusedFrom).toBeNull();
  });

  it("an open draft for the same date from another chat is still reopened (the any-chat reopen)", async () => {
    const first = await chatThenCreate([LATE_OPEN]);
    const second = await chatThenCreate([LATE_OPEN]);
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
    expect(second.reusedFrom).toBeNull();
  });
});
