import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import PRODUCTION_FLAGS from "@/config/production-flags.json";
import { EDIT_FORM_TOOL_DESCRIPTION } from "@/lib/ai/form-tool-schema";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

import { CA_CHAIN, LIVE_ROSTER, OBSERVATION_AFTER } from "./replay-pack/nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * FORM_EDIT_TOOL_IN_STREAM_ENABLED (STEP 3): THE EDIT TOOL IN THE MAIN CALL
 * ============================================================================
 *
 * Ported from Ask Bubbles (c5534279). The real chat route, forms routes and
 * the REAL `callClaude` (only the Anthropic client is a double), on
 * production's flags plus FORM_EDIT_SINGLE_WRITER_ENABLED and this flag. This
 * app streams the answering call (`messages.create` with `stream: true`, read
 * by `collectModelResult`); the double streams it as the live API does — a
 * tool call opens with `content_block_start` and its input arrives as
 * input_json_delta events — and records every request, so what is asserted is
 * the request body the model would get, what was saved and what the manager
 * is told. QA's CA chat, in the tester's exact words (4 Nov 2026), in this
 * app's setting (`nov4-live-regressions-scenarios.ts`: Jane Doe at the Kearney
 * salon, invented).
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
} as unknown as FakeStore;

type MainRequest = { system: unknown; messages: { role: string; content: unknown }[]; tools?: { name: string; description: string; input_schema: unknown }[]; tool_choice?: unknown };

const model = vi.hoisted(() => ({
  /** Every answering request (the call with `thinking`), in order. */
  main: [] as unknown[],
  draftCalls: 0,
  revisionCalls: 0,
  /** What the answering model does on its next call: text, and optionally a tool call. */
  next: { text: "A grounded answer from the policy manual.", tool: null as unknown },
  /** The answering call fails (a model or configuration error) on its next request. */
  mainFails: false,
  draft: { values: {} } as Record<string, unknown>,
  revision: { values: {} } as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  assertLiveMode: () => {},
  assertNoConfigurationProblems: () => {},
  assertWithinRateLimit: () => {},
}));
vi.mock("@/lib/config/server-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/server-env")>()),
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  supabaseReadiness: () => ({ ready: true, missing: [] }),
}));
vi.mock("@/lib/auth/server", () => ({
  authorizeRequest: async (_request: Request, permission: string) => ({
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
  }),
}));
vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));
// The REAL callClaude; only the forced-tool readers are stood in for, as in the replay pack.
vi.mock("@/lib/ai/call-claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/call-claude")>()),
  callClaudeToolTimed: async () => ({ input: { employee: null, incident: null, incidentDate: null }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: unknown }) => {
    if (input.tool?.name === "extract_form_fields") return { templateKey: "dpoa", employeeName: null, observation: null, actionPlan: null };
    return null;
  },
}));

/** The answering model's reply as stream events, as the live API sends them (`stream: true`). */
async function* answerEvents() {
  yield { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 0 } } };
  let index = 0;
  if (model.next.text) {
    yield { type: "content_block_start", index, content_block: { type: "text", text: "" } };
    yield { type: "content_block_delta", index, delta: { type: "text_delta", text: model.next.text } };
    yield { type: "content_block_stop", index };
    index += 1;
  }
  if (model.next.tool) {
    const json = JSON.stringify(model.next.tool);
    yield { type: "content_block_start", index, content_block: { type: "tool_use", id: "toolu_1", name: "edit_form", input: {} } };
    for (const part of [json.slice(0, 10), json.slice(10)]) yield { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: part } };
    yield { type: "content_block_stop", index };
  }
  yield { type: "message_delta", delta: { stop_reason: model.next.tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } };
  yield { type: "message_stop" };
}

vi.mock("@/lib/ai/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/anthropic")>();
  const forced = (request: { tool_choice?: { name?: string } }) => {
    const revising = request.tool_choice?.name === "revise_form_fields";
    if (revising) model.revisionCalls += 1;
    else model.draftCalls += 1;
    return {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: revising ? "revise_form_fields" : "write_form_fields", input: revising ? model.revision : model.draft }],
    };
  };
  return {
    ...actual,
    getAnthropicClient: () => ({
      messages: {
        create: async (request: { thinking?: unknown; tool_choice?: { name?: string } }) => {
          if (!request.thinking) return forced(request);
          model.main.push(JSON.parse(JSON.stringify(request)));
          if (model.mainFails) {
            model.mainFails = false;
            throw Object.assign(new Error("overloaded"), { status: 529 });
          }
          return answerEvents();
        },
      },
    }),
  };
});
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async fetchNamedHandbook() {
      return { ok: false, reason: "offline", problem: "not_found" };
    }
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    // The progression framework, as the replay pack has it: this app's governed Corrective Action draft needs it to write.
    async fetchRoleGrounding(role: { id: string }) {
      return {
        ok: true,
        grounding: {
          role: { id: role.id },
          documentId: "doc-progression",
          documentTitle: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            {
              chunk_id: "pmf-0",
              document_id: "doc-progression",
              document_title: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
              category: "leadership_coaching",
              locator: "SECTION 2",
              page: null,
              section: null,
              content: "Solve the issue at the lowest appropriate level.",
              similarity: 0,
            },
          ],
          presentGroups: ["escalation_ladder"],
        },
      };
    }
    async fetchOfficialPolicyManual() {
      return { ok: true, documentId: "doc-manual", documentTitle: "2025 JBA Policy Manual - Edited 5-2025", documentCategory: "policies_compliance", matchedBy: "tag", chunks: JBA_MANUAL_CA_CHUNKS };
    }
  },
}));
vi.mock("@/lib/knowledge/recall-match", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge/recall-match")>()),
  matchRecallKnowledge: async () => [],
}));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATA_REASON: "no dataset",
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    readDirectoryFacts: async (scope: AccessScope | null) =>
      actual.scopeRoster(LIVE_ROSTER as never, scope).map((person) => ({ ...person, title: (person as { positionName?: string | null }).positionName ?? null, primaryLocationName: "Kearney" })),
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(LIVE_ROSTER as never, scope),
  };
});
vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const TOOL_FLAGS = ["FORM_EDIT_SINGLE_WRITER_ENABLED", "FORM_EDIT_TOOL_IN_STREAM_ENABLED"] as const;
/*
 * Changed on purpose (7 Nov 2026): QA's flip 7 turned these flags on in production (production-flags.json). This
 * file's recorded behaviour predates them (the old edit chain, Step B off, the policy line as it was), so the
 * production base leaves them off. Every assertion is unchanged.
 */
const FLIPPED_IN_FLIP_7: readonly string[] = [
  "AS_YOU_SAID_MANAGER_WORDS_ENABLED",
  "AS_YOU_SAID_APP_READ_ENABLED",
  "CLEANING_OTHER_EVERY_WORDING_ENABLED",
  "UNDER_PERFORMANCE_EXPLAINED_ENABLED",
  "OWN_BRAND_ONLY_ENABLED",
  "TWO_FORMS_OWN_PERSON_ENABLED",
  "NO_NOTICE_NO_DATE_ENABLED",
  "COACHING_OBSERVED_KEPT_ENABLED",
  "POLITE_REQUEST_OWN_TURNS_ENABLED",
  "MSB_PHRASE_SOC_ENABLED",
  "PRIOR_STEP_PREVIOUSLY_ENABLED",
  "REMOVE_POLICY_NOT_NAMED_ENABLED",
  "FORM_PATCH_REDUCER_ENABLED",
  "FORM_REPLY_FROM_DIFF_ENABLED",
  "FORM_EDIT_SINGLE_WRITER_ENABLED",
  "FORM_EDIT_SAID_REPLACEMENT_ENABLED",
  "FORM_PATCH_READER_FIXES_ENABLED",
];
const PRODUCTION = [...PRODUCTION_FLAGS.on, ...PRODUCTION_FLAGS.assumedOn].filter((name) => !FLIPPED_IN_FLIP_7.includes(name));
const TOUCHED = [...new Set([...TOOL_FLAGS, ...PRODUCTION, ...PRODUCTION_FLAGS.off, "FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED", "FORM_EDIT_NOOP_GUARD_ENABLED"])];
const saved = new Map<string, string | undefined>();

function setFlags(on: readonly string[]) {
  for (const name of TOUCHED) delete process.env[name];
  for (const name of [...PRODUCTION, ...on]) process.env[name] = "true";
}

beforeAll(() => {
  for (const name of TOUCHED) saved.set(name, process.env[name]);
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:30:00Z"));
});
afterAll(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

class JoiningRows extends Array<Record<string, unknown>> {
  override push(...rows: Record<string, unknown>[]) {
    const count = super.push(...rows);
    for (const row of store.form_instances ?? []) {
      const template = store.form_templates!.find((entry) => entry.id === row.template_id);
      const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
      Object.assign(row, { template_key: template?.key, template_name: template?.name, layout_family: template?.layout_family, template_version: version?.version });
    }
    return count;
  }
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  model.main.length = 0;
  model.draftCalls = 0;
  model.revisionCalls = 0;
  model.next = { text: "A grounded answer from the policy manual.", tool: null };
  model.mainFails = false;
  model.draft = { values: {} };
  model.revision = { values: {} };
  setFlags(TOOL_FLAGS);
  await (await import("@/lib/forms/repository")).ensureTemplateLibrary("system");
});

type Answer = { content: string; formProposal?: ChatFormProposal; formOpened?: { instanceId: string }; formUpdate?: { instanceId: string; updated: string[] } };

async function chat() {
  const chatRoute = await import("@/app/api/chat/route");
  const instancesRoute = await import("@/app/api/forms/instances/route");
  const draftRoute = await import("@/app/api/forms/instances/[id]/draft/route");
  const { createInlineForm } = await import("@/features/chat/create-inline-form");
  const messages: ChatMessage[] = [];
  let proposal: ChatFormProposal | null = null;
  let instanceId: string | null = null;
  const conversationId = createId("conv");
  const call = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const request = new Request(`https://app.test${url}`, init);
    const id = url.startsWith("/api/forms/instances/") ? url.split("/")[4]! : null;
    const response = id ? await draftRoute.POST(request, { params: Promise.resolve({ id }) }) : await instancesRoute.POST(request);
    const body = (await response.json()) as T & Record<string, unknown>;
    if (!response.ok) throw new Error(String(body.error ?? response.status));
    return body;
  };
  return {
    get id() {
      return instanceId!;
    },
    async say(question: string): Promise<Answer> {
      const response = await chatRoute.POST(
        new Request("https://app.test/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question,
            mode: "standard",
            history: messages.map(({ id, role, content, formProposal }) => ({ id, role, content, ...(formProposal ? { formProposal } : {}) })),
            questionMessageId: `m${messages.length}`,
            conversationId,
            ...(!instanceId && continuationFor(messages) ? { continueProposalTemplateKey: continuationFor(messages)!.templateKey } : {}),
            ...(instanceId ? { activeFormInstanceId: instanceId } : {}),
          }),
        }),
      );
      const raw = (await response.json()) as Answer;
      expect(response.status, JSON.stringify(raw)).toBe(200);
      const payload = response.headers.get("x-chat-stream") ? (raw as unknown as { body: Answer }).body : raw;
      messages.push(
        { id: `m${messages.length}`, role: "user", content: question, createdAt: "2026-10-26T12:00:00Z" } as ChatMessage,
        { id: `a${messages.length}`, role: "assistant", content: payload.content, createdAt: "2026-10-26T12:00:01Z", ...(payload.formProposal ? { formProposal: payload.formProposal } : {}) } as ChatMessage,
      );
      if (payload.formProposal) proposal = payload.formProposal;
      return payload;
    },
    async create(): Promise<string> {
      const created = await createInlineForm({ proposal: proposal!, messages, call, onCreated: () => {} });
      const uuid = randomUUID();
      for (const table of ["form_instances", "form_instance_values", "form_instance_events"] as const) {
        for (const row of store[table]) {
          if (row.id === created.reference.instanceId) row.id = uuid;
          if (row.instance_id === created.reference.instanceId) row.instance_id = uuid;
        }
      }
      instanceId = uuid;
      return uuid;
    },
  };
}

function values(instanceId: string): Record<string, string> {
  return Object.fromEntries(store.form_instance_values.filter((row) => row.instance_id === instanceId).map((row) => [String(row.field_key), String(row.value ?? "")]));
}

/** QA's T1 and Create: Jane Doe's Corrective Action draft, with the drafting model's baseline Observation. */
async function janeDraft() {
  const thread = await chat();
  await thread.say(CA_CHAIN[0]);
  model.draft = { values: { observation: OBSERVATION_AFTER[0]! } };
  await thread.create();
  model.main.length = 0;
  model.draftCalls = 0;
  model.revisionCalls = 0;
  return thread;
}

function lastMain(): MainRequest {
  return model.main.at(-1) as MainRequest;
}

function lastUserText(request: MainRequest): string {
  const content = request.messages.at(-1)!.content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

async function lastTrace(): Promise<Record<string, unknown> | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const row = (store as unknown as { chat_traces: unknown[] }).chat_traces.at(-1) as { slots?: Record<string, unknown> } | undefined;
  return row?.slots?.form_edit as Record<string, unknown> | undefined;
}

const CLAIM = /\b(?:updated|changed)\b/i;

describe("FORM_EDIT_TOOL_IN_STREAM_ENABLED: when the tool is offered", () => {
  it("no draft open (T1): the main call has no tool and no data block", async () => {
    const thread = await chat();
    await thread.say(CA_CHAIN[0]);
    for (const request of model.main as MainRequest[]) {
      expect(request.tools).toBeUndefined();
      expect(lastUserText(request)).not.toContain("OPEN FORM DATA");
    }
  });

  it('a question with the draft open — "what policy does that fall under?" — is offered the tool (Pau\'s ruling A3); answered in text, the text is the reply and nothing is written', async () => {
    const thread = await janeDraft();
    const before = JSON.stringify(values(thread.id));
    model.next = { text: "That falls under the attendance section of the policy manual.", tool: null };
    const reply = await thread.say("what policy does that fall under?");
    expect(model.main.length, "the question was answered by the main call").toBe(1);
    // Changed on purpose (Pau's ruling A3, 4 Nov 2026): a question-phrased turn is offered edit_form too; the gate is in the trace only.
    expect(lastMain().tools?.map((tool) => tool.name)).toEqual(["edit_form"]);
    expect(lastMain().tool_choice).toEqual({ type: "auto" });
    expect(reply.content).toBe("That falls under the attendance section of the policy manual.");
    expect(reply.formUpdate).toBeUndefined();
    expect(JSON.stringify(values(thread.id))).toBe(before);
    expect(await lastTrace()).toMatchObject({ offered: true, offer_reason: "draft_open", gate: "ASKS", called: false, handoff: "not_called" });
  });

  // OPEN production defect: fails with production's real flags (QA Vercel read 5 Nov); tracked: POLICY_CITATION_ENABLED (on in
  // production) — its pinned manual block (server-ask.ts citedManualGrounding) moves the OPEN FORM DATA after QUESTION. This
  // flag (FORM_EDIT_TOOL_IN_STREAM) is not on in production. Assertions unchanged: it.fails flips to a reported pass when fixed.
  it.fails("an edit turn with the draft open: one tool, edit_form, tool_choice auto, its description verbatim, the open form as JSON before QUESTION, the system prompt unchanged", async () => {
    const thread = await janeDraft();
    // The question turn's system prompt, for comparison.
    model.next = { text: "That falls under the attendance section.", tool: null };
    await thread.say("what policy does that fall under?");
    const questionSystem = JSON.stringify(lastMain().system);
    model.next = { text: "A grounded answer from the policy manual.", tool: null };
    await thread.say(CA_CHAIN[5]);
    const request = lastMain();
    expect(request.tools?.map((tool) => tool.name)).toEqual(["edit_form"]);
    expect(request.tools![0]!.description).toBe(EDIT_FORM_TOOL_DESCRIPTION);
    expect(request.tool_choice).toEqual({ type: "auto" });
    const text = lastUserText(request);
    const data = text.indexOf("OPEN FORM DATA");
    expect(data).toBeGreaterThan(-1);
    expect(data).toBeLessThan(text.indexOf("QUESTION\n\n"));
    expect(text).toContain('"key":"observation"');
    expect(text).toContain("Jane Doe was late to open on October 20, 2026.");
    expect(text).toContain('"staff":[{"name":');
    // The system prompt is not touched by the tool (the open-form rule is the same on both turns).
    expect(JSON.stringify(request.system).includes("edit_form")).toBe(false);
    expect(questionSystem.includes("edit_form")).toBe(false);
  });
});

describe("FORM_EDIT_TOOL_IN_STREAM_ENABLED: a tool call", () => {
  it(`"${CA_CHAIN[5]}": applied through the one writer; the reply is the saved diff, never the model's text; one model call, no tool result sent back`, async () => {
    const thread = await janeDraft();
    const id = thread.id;
    const before = values(id).observation!;
    model.next = {
      text: "I've updated the form with the sanitizing checklist.",
      tool: { ops: [{ op: "append", field: "observation", value: "she Must Practice the sanitizing checklist every shift." }] },
    };
    const reply = await thread.say(CA_CHAIN[5]);
    const after = values(id).observation!;
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain("she Must Practice the sanitizing checklist every shift.");
    expect(reply.formUpdate).toEqual({ instanceId: id, updated: ["observation"] });
    // Changed on purpose (12 Nov 2026, Gate-Sunny-2 on #662): with STEP_B_REPLY_KEEPS_LINES on, a field written on several
    // lines is quoted line by line ("Changed Observation of Offense to:\n> …"); either way the reply names the change.
    expect(reply.content).toMatch(/^Changed Observation of Offense to(?: "|:\n> )/);
    expect(reply.content).not.toContain("I've updated the form");
    // Exactly one model call this turn: the main one. No revision, no draft, nothing sent back.
    expect(model.main.length).toBe(1);
    expect(model.revisionCalls).toBe(0);
    expect(model.draftCalls).toBe(0);
    expect(JSON.stringify(model.main)).not.toContain("tool_result");
    expect(await lastTrace()).toMatchObject({
      offered: true,
      offer_reason: "draft_open",
      called: true,
      op_kinds: ["append"],
      fields: ["observation"],
      applied: ["observation"],
      refused: [],
      handoff: null,
    });
    // Keys and reasons only: no form text in the trace.
    expect(JSON.stringify(await lastTrace())).not.toContain("sanitizing");
  });

  it(`"${CA_CHAIN[1]}": a set that drops "Jane" is refused and handed off to the old chain (the revision), and the tool's text is never shown`, async () => {
    const thread = await janeDraft();
    const id = thread.id;
    model.next = {
      text: "Updated her last name on the form.",
      tool: { ops: [{ op: "set", field: "observation", value: `Observed:\nDoe-Smith was late to open on October 20, 2026.` }] },
    };
    // The old chain's revision, scripted to QA's baseline text.
    model.revision = { values: { observation: OBSERVATION_AFTER[1]! } };
    const reply = await thread.say(CA_CHAIN[1]);
    const observation = values(id).observation!;
    expect(observation, "the tool's set reached the form").not.toMatch(/^Observed:\nDoe-Smith was late/);
    expect(observation).toMatch(/\bJane Doe-Smith\b/);
    expect(model.revisionCalls, "handed off to the revision").toBe(1);
    expect(reply.content).not.toContain("Updated her last name on the form.");
    const trace = await lastTrace();
    /*
     * The design names drops_protected_value; on the tool path the reducer's
     * dropped-words rule (keepsUnnamedWords, Step 2a) is checked first and
     * refuses the same write as drops_words. Either way nothing is written.
     */
    expect(trace).toMatchObject({ offered: true, called: true, handoff: "refused", applied: [] });
    expect(trace!.refused).toEqual([{ key: "observation", reason: "drops_words" }]);
  });

  it("a refused write with nothing on the old chain to say never says Updated", async () => {
    const thread = await janeDraft();
    const id = thread.id;
    const before = JSON.stringify(values(id));
    model.next = {
      text: "Updated the form.",
      tool: { ops: [{ op: "set", field: "observation", value: "Doe-Smith was late." }] },
    };
    model.revision = { values: {} };
    const reply = await thread.say(CA_CHAIN[1]);
    expect(JSON.stringify(values(id))).toBe(before);
    expect(reply.formUpdate).toBeUndefined();
    expect(reply.content.split("\n").filter((line) => CLAIM.test(line) && !/\bnot\b|n't\b/i.test(line))).toEqual([]);
    expect(reply.content).not.toContain("Updated the form.");
  });

  it("a no-op write (the value already on the form) never says Updated", async () => {
    const thread = await janeDraft();
    const id = thread.id;
    const before = JSON.stringify(values(id));
    model.next = { text: "Updated the Observation.", tool: { ops: [{ op: "set", field: "observation", value: values(id).observation! }] } };
    model.revision = { values: {} };
    const reply = await thread.say("set the observation to what it says now");
    expect(JSON.stringify(values(id))).toBe(before);
    expect(reply.formUpdate).toBeUndefined();
    expect(reply.content.split("\n").filter((line) => CLAIM.test(line) && !/\bnot\b|n't\b/i.test(line))).toEqual([]);
    expect(await lastTrace()).toMatchObject({ called: true, handoff: "noop", applied: [] });
  });

  it("the tool not called: the old chain runs as before (the revision answers the edit)", async () => {
    const thread = await janeDraft();
    model.next = { text: "A grounded answer from the policy manual.", tool: null };
    model.revision = { values: { observation: OBSERVATION_AFTER[2]! } };
    await thread.say(CA_CHAIN[2]);
    expect(model.main.length).toBe(1);
    expect(lastMain().tools?.map((tool) => tool.name)).toEqual(["edit_form"]);
    expect(await lastTrace()).toMatchObject({ offered: true, called: false, handoff: "not_called" });
  });
});

/*
 * Classification of this flag (4 Nov 2026), a REGRESSION fixed: with the tool
 * on, the answering call is made before the old chain. When it failed (a model
 * error, a configuration error), the whole turn failed — on a turn the old
 * chain (here the revision) answers without it. A failed main call is now no
 * offer: the chain answers as with the flag off.
 */
describe("a failed main call never costs a turn the old chain answers", () => {
  it(`"${CA_CHAIN[2]}": the answering call fails, the revision still answers and writes`, async () => {
    const thread = await janeDraft();
    const id = thread.id;
    model.mainFails = true;
    model.revision = { values: { observation: OBSERVATION_AFTER[2]! } };
    const reply = await thread.say(CA_CHAIN[2]);
    expect(model.main.length, "the main call was not made").toBe(1);
    expect(model.revisionCalls, "the old chain did not run").toBe(1);
    expect(values(id).observation).toMatch(/also late on Tuesday/);
    expect(reply.formUpdate?.updated ?? []).toContain("observation");
    expect(await lastTrace()).toMatchObject({ called: false, handoff: "error" });
  });
});

describe("FORM_EDIT_TOOL_IN_STREAM_ENABLED needs FORM_EDIT_SINGLE_WRITER_ENABLED", () => {
  it("alone it is off: no tool, and the Step B patch turn is not skipped", async () => {
    setFlags(["FORM_EDIT_TOOL_IN_STREAM_ENABLED"]);
    const flags = await import("@/lib/config/chat-quality-flags");
    expect(flags.formEditToolInStreamEnabled()).toBe(false);
    const thread = await janeDraft();
    model.revision = { values: { observation: OBSERVATION_AFTER[5]! } };
    await thread.say(CA_CHAIN[5]);
    for (const request of model.main as MainRequest[]) expect(request.tools).toBeUndefined();
  });

  it("defaults off", async () => {
    setFlags([]);
    expect((await import("@/lib/config/chat-quality-flags")).formEditToolInStreamEnabled()).toBe(false);
    process.env.FORM_EDIT_SINGLE_WRITER_ENABLED = "true";
    expect((await import("@/lib/config/chat-quality-flags")).formEditToolInStreamEnabled()).toBe(false);
    process.env.FORM_EDIT_TOOL_IN_STREAM_ENABLED = "true";
    expect((await import("@/lib/config/chat-quality-flags")).formEditToolInStreamEnabled()).toBe(true);
  });
});

/*
 * QA and Pau, 4 Nov 2026: a real edit phrased as a question reaches edit_form.
 * Since Pau's ruling A3 (4 Nov 2026) no reading of the words decides the
 * offer: every turn with a draft open is offered the tool, a pure question
 * too, and the no-op guard (FORM_EDIT_NOOP_GUARD_ENABLED) is what keeps a
 * question from writing. Their wordings, on Jane Doe's open Corrective
 * Action.
 */
export const GATE_EDITS = [
  "can you change her last name to Laine?",
  "could you add that she was also late on Tuesday?",
  "would you make it sound more professional?",
  "is it possible to change the date to 10/20?",
  "can you set the daily stats to 3 of 4 shifts on time?",
] as const;
export const GATE_QUESTIONS = ["what policy does that fall under?", "what is the policy on being late?", "can you tell me what the expectation is?"] as const;

const GUARD_LINE = "I didn't change anything on the form. Tell me which part to change and what it should say.";

describe("the offer (Pau's ruling A3): an edit asked as a question reaches edit_form, and so does a question — which writes nothing", () => {
  for (const said of GATE_EDITS) {
    it(`"${said}" — offered edit_form`, async () => {
      const thread = await janeDraft();
      await thread.say(said);
      const trace = await lastTrace();
      expect(model.main.length, "no main call").toBeGreaterThan(0);
      expect(lastMain().tools?.map((tool) => tool.name)).toEqual(["edit_form"]);
      expect(trace).toMatchObject({ offered: true, offer_reason: "draft_open" });
    });
  }
  for (const said of GATE_QUESTIONS) {
    // Changed on purpose (Pau's ruling A3, 4 Nov 2026): the question is now OFFERED edit_form; before, it was not.
    it(`"${said}" — offered edit_form; answered in text: the text is the reply, nothing written`, async () => {
      const thread = await janeDraft();
      const before = JSON.stringify(values(thread.id));
      model.next = { text: "That is in the attendance section of the policy manual.", tool: null };
      const reply = await thread.say(said);
      const trace = await lastTrace();
      process.stdout.write(`[A3] ${JSON.stringify(said)} text: ${JSON.stringify({ offered: trace?.offered, written: JSON.stringify(values(thread.id)) !== before, reply: reply.content })}\n`);
      expect(lastMain().tools?.map((tool) => tool.name)).toEqual(["edit_form"]);
      expect(trace).toMatchObject({ offered: true, offer_reason: "draft_open", gate: "ASKS", called: false });
      expect(JSON.stringify(values(thread.id))).toBe(before);
      expect(reply.formUpdate).toBeUndefined();
      expect(reply.content).toBe("That is in the attendance section of the policy manual.");
    });

    // Pau's ruling A3, 4 Nov 2026: what makes the offer safe is the no-op guard — a tool call that changes nothing writes nothing and says so.
    it(`"${said}" — the model calls the tool with a no-op: nothing written, the reply is the guard line (FORM_EDIT_NOOP_GUARD_ENABLED)`, async () => {
      setFlags([...TOOL_FLAGS, "FORM_EDIT_NOOP_GUARD_ENABLED"]);
      const thread = await janeDraft();
      const before = JSON.stringify(values(thread.id));
      model.next = { text: "That is in the attendance section of the policy manual.", tool: { ops: [{ op: "set", field: "observation", value: values(thread.id).observation! }] } };
      const reply = await thread.say(said);
      const trace = await lastTrace();
      process.stdout.write(`[A3] ${JSON.stringify(said)} no-op tool: ${JSON.stringify({ offered: trace?.offered, written: JSON.stringify(values(thread.id)) !== before, reply: reply.content })}\n`);
      expect(trace).toMatchObject({ offered: true, called: true, handoff: "refused", refused: [{ key: "observation", reason: "same_value" }], applied: [] });
      expect(JSON.stringify(values(thread.id))).toBe(before);
      expect(reply.formUpdate).toBeUndefined();
      expect(reply.content).toBe(GUARD_LINE);
    });
  }
});

/*
 * Names (coordinator, 4 Nov 2026): the employee's name is written only through
 * edit_form ops and the single writer, never from the model's text. In Step 3
 * the header name is not one of the tool's keys (Step 5 adds it with the
 * roster check), so an op on it is a bad input and nothing is written, and the
 * model's text naming someone writes nothing either.
 */
describe("the employee's name is never written from the model's text", () => {
  it('"can you change her last name to Laine?": employee_name is not a tool key; an op on it writes nothing; the text is not shown', async () => {
    const thread = await janeDraft();
    const before = JSON.stringify(values(thread.id));
    model.next = { text: "I've changed her name to Jane Laine.", tool: { ops: [{ op: "set", field: "employee_name", value: "Jane Laine" }] } };
    model.revision = { values: {} };
    const reply = await thread.say("can you change her last name to Laine?");
    const enumKeys = JSON.stringify(lastMain().tools![0]!.input_schema);
    expect(enumKeys).not.toContain('"employee_name"');
    expect(JSON.stringify(values(thread.id))).toBe(before);
    expect(values(thread.id).employee_name).toBe("Jane Doe");
    expect(reply.content).not.toContain("Jane Laine");
    expect(await lastTrace()).toMatchObject({ called: true, handoff: "invalid_input", applied: [] });
  });

  it("the model's text alone (no tool call) naming someone writes nothing", async () => {
    const thread = await janeDraft();
    const before = JSON.stringify(values(thread.id));
    model.next = { text: "Her name on the form is now Jane Laine.", tool: null };
    model.revision = { values: {} };
    await thread.say("can you change her last name to Laine?");
    expect(JSON.stringify(values(thread.id))).toBe(before);
    expect(store.form_instances.map((row) => row.employee_name)).toEqual(["Jane Doe"]);
  });
});
