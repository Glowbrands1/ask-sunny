import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * B21-4 — "NOW ONE FOR <ANOTHER EMPLOYEE>" REDREW THE FIRST EMPLOYEE'S FORM
 * ============================================================================
 *
 * Ported from Ask Bubbles. The sibling's QA on production, 25 Oct 2026: after
 * Create for Test Employee, "now one for Test Employee Two at <location> for
 * being late on 10-20-26" answered "Redrafted the Corrective Action Form for
 * Test Employee from what you described." No card for Test Employee Two, and
 * the first form was drafted again. The chat redraft (`chat-redraft.ts`) read
 * the turn's employee as "Test" (the name reader drops "Employee"), the same
 * first name as "Test Employee". With DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED on, a
 * turn that asks for a form for somebody else gets its own card.
 *
 * The same turns at one of this app's salons, through POST /api/chat on the
 * live intent path, the full remap and the proposal flow, `createInlineForm`
 * and the real create and draft routes. Faked: identity, the database
 * (in-memory), the models, analytics.
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
          scope: { level: "salon", primaryAreaId: "loc-0468", alsoCoversAreaIds: [] },
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
    employeeName: /test employee two/i.test(last)
      ? "Test Employee Two"
      : /test employee/i.test(last)
        ? "Test Employee"
        : /casey linetest/i.test(last)
          ? "Casey Linetest"
          : /dana rowtest/i.test(last)
            ? "Dana Rowtest"
            : null,
    jobTitle: null,
    observation: !model.observation ? null : /being late/i.test(last) ? "being late" : null,
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
      formTurn: Boolean(slots.templateKey) || /\bone for\b/i.test(last),
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


/*
 * The sibling's B19 set: the full remap and DRAFT_ACTIONS_ENABLED on,
 * CONVERSATION_DRAFT_REUSE_ENABLED off. Every other draft guard is tried on as
 * well. This app has no CROSS_CHAT_DRAFT_DEDUPE_ENABLED: its any-chat reopen
 * (`findOpenIncidentDraft`) is always on, and runs in every case here.
 */
const FLAG = "DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED";
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

/* The sibling's QA turns, at one of this app's salons. */
const FIRST = "create a verbal CA for Test Employee at Lawrence for being late on 10-20-26";
const SECOND = "now one for Test Employee Two at Lawrence for being late on 10-20-26";

const byEmployee = (name: string) => (store.form_instances ?? []).filter((entry) => entry.employee_name === name);

function path(label: string) {
  if (label.startsWith("intent")) {
    process.env.FORM_FULL_REMAP_ENABLED = "off";
    process.env.INTENT_EXTRACTION_ENABLED = "on";
  } else if (label.startsWith("proposal")) {
    process.env.FORM_FULL_REMAP_ENABLED = "off";
    delete process.env.INTENT_EXTRACTION_ENABLED;
  }
}

describe("B21-4: a form for another employee is its own card, never a redraft of the open form", () => {
  /*
   * The proposal flow reads "Test Employee" as "Test" (its name reader drops
   * "Employee"), so that run uses two synthetic two-word names in the same
   * sentences.
   */
  it.each([
    ["intent extraction (live)", FIRST, SECOND, "Test Employee", "Test Employee Two"],
    ["full remap", FIRST, SECOND, "Test Employee", "Test Employee Two"],
    [
      "proposal flow",
      FIRST.replace("Test Employee", "Dana Rowtest"),
      SECOND.replace("Test Employee Two", "Casey Linetest"),
      "Dana Rowtest",
      "Casey Linetest",
    ],
  ])(
    '"now one for <another employee> at Lawrence for being late on 10-20-26" after Create (%s)',
    async (label, firstTurn, secondTurn, firstName, secondName) => {
      process.env[FLAG] = "on";
      path(label);
      const first = await chatThenCreate([firstTurn]);
      expect(first.proposal.employeeName).toBe(firstName);
      const before = fieldsOf(first.id);
      const eventsBefore = (store.form_instance_events ?? []).filter((event) => event.instance_id === first.id).length;

      const reply = await say(first.chat, secondTurn);
      expect(reply.content).not.toMatch(/Redrafted the/);
      expect(reply.formUpdate).toBeUndefined();
      expect(reply.formProposal?.employeeName).toBe(secondName);
      expect(fieldsOf(first.id)).toBe(before);
      expect((store.form_instance_events ?? []).filter((event) => event.instance_id === first.id)).toHaveLength(eventsBefore);

      first.chat.instanceId = null;
      const result = await createInlineForm({ proposal: reply.formProposal!, messages: first.chat.messages, call, onCreated: () => {} });
      expect(result.reference.instanceId).not.toBe(first.id);
      expect(byEmployee(secondName)).toHaveLength(1);
      expect(byEmployee(firstName)).toHaveLength(1);
    },
  );

  it("flag off: the turn never makes a form for the second employee, as in production", async () => {
    path("intent extraction (live)");
    const first = await chatThenCreate([FIRST]);
    await say(first.chat, SECOND);
    expect(byEmployee("Test Employee Two")).toHaveLength(0);
  });
});
