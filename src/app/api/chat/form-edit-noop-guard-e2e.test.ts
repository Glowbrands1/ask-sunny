import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import PRODUCTION_FLAGS from "@/config/production-flags.json";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

import { CA_CHAIN, LIVE_ROSTER, OBSERVATION_AFTER } from "./replay-pack/nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * FORM_EDIT_NOOP_GUARD_ENABLED (STEP 4): NO FALSE "UPDATED", THROUGH THE CHAT
 * ============================================================================
 *
 * Ported from Ask Bubbles (bdabffbe). The real chat route, forms routes and
 * the REAL `callClaude` (only the Anthropic client is a double, streamed as
 * this app's answering call is, as in `form-edit-tool-in-stream-e2e.test.ts`),
 * on production's flags plus the single writer, the edit tool and this flag.
 * Jane Doe's Corrective Action at the Kearney salon (QA's CA chat, invented),
 * and the
 * overnight scan's sf-s11 request in the manager's words. Each rule is
 * asserted on the saved form and on the exact reply; the flag-off replies of
 * the same turns are pinned byte for byte by
 * `form-edit-noop-guard-flags-off.test.ts`.
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


const model = vi.hoisted(() => ({
  /** Every answering request (the call with `thinking`), in order. */
  main: [] as unknown[],
  draftCalls: 0,
  revisionCalls: 0,
  /** What the answering model does on its next call: text, and optionally a tool call. */
  next: { text: "A grounded answer from the policy manual.", tool: null as unknown },
  draft: { values: {} } as Record<string, unknown>,
  revision: { values: {} } as Record<string, unknown>,
  /** The answering call fails (a model or configuration error) on its next request. */
  mainFails: false,
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
const NOOP = "FORM_EDIT_NOOP_GUARD_ENABLED";
const GUARD_FLAGS = [...TOOL_FLAGS, NOOP] as const;
const PRODUCTION = [...PRODUCTION_FLAGS.on, ...PRODUCTION_FLAGS.assumedOn];
const TOUCHED = [...new Set([...GUARD_FLAGS, ...PRODUCTION, ...PRODUCTION_FLAGS.off, "FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"])];
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
  model.draft = { values: {} };
  model.revision = { values: {} };
  model.mainFails = false;
  setFlags(GUARD_FLAGS);
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

async function lastTrace(): Promise<Record<string, unknown> | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const row = (store as unknown as { chat_traces: unknown[] }).chat_traces.at(-1) as { slots?: Record<string, unknown> } | undefined;
  return row?.slots?.form_edit as Record<string, unknown> | undefined;
}


/** The overnight scan's sf-s11 request, the manager's words (`nov4-overnight-scan-cases.ts`). */
const SF_S11_REQUEST = "Can you do the same thing for Perrin Haldane but switch it to a written";
const NOTHING = "I didn't change anything on the form. Tell me which part to change and what it should say.";
const CLAIM = /\b(?:updated|changed)\b/i;

describe("FORM_EDIT_NOOP_GUARD_ENABLED: a tool op that changes nothing", () => {
  it('"set the observation to what it says now": refused as same_value, nothing written, and the reply is exactly the new sentence', async () => {
    const thread = await janeDraft();
    const before = JSON.stringify(values(thread.id));
    model.next = { text: "Updated the Observation.", tool: { ops: [{ op: "set", field: "observation", value: values(thread.id).observation! }] } };
    const reply = await thread.say("set the observation to what it says now");
    expect(JSON.stringify(values(thread.id))).toBe(before);
    expect(reply.content).toBe(NOTHING);
    expect(reply.formUpdate).toBeUndefined();
    expect(await lastTrace()).toMatchObject({ called: true, handoff: "refused", refused: [{ key: "observation", reason: "same_value" }], applied: [] });
    // Handed off: the revision ran, and wrote nothing.
    expect(model.revisionCalls).toBe(1);
  });

  it("a same-value tick beside a real append: refused whole, the old chain's revision answers from the saved diff", async () => {
    const thread = await janeDraft();
    model.next = {
      text: "Done.",
      tool: { ops: [{ op: "set", field: "warning_type", value: [] }, { op: "append", field: "observation", value: "she Must Practice the sanitizing checklist every shift." }] },
    };
    model.revision = { values: { observation: OBSERVATION_AFTER[0]!.replace("was late to open", "arrived late to open") } };
    const reply = await thread.say(CA_CHAIN[5]);
    expect(await lastTrace()).toMatchObject({ handoff: "refused", refused: [{ key: "warning_type", reason: "same_value" }] });
    expect(values(thread.id).observation).not.toContain("sanitizing");
    expect(reply.content).toBe("Updated: Observation of Offense: Observed: Jane Doe arrived late to open on October 20, 2026. Expectation: Jane…");
    expect(reply.formUpdate).toEqual({ instanceId: thread.id, updated: ["observation"] });
  });
});

/*
 * Changed on purpose (11 Nov 2026, QA round 25): SAME_REQUEST_OFF_ROSTER is on in production, and it reads sf-s11's
 * "Can you do the same thing for Perrin Haldane …" (Perrin on no directory) as the same request for another person,
 * so the turn never reaches the open-form guard these tests cover. Putting Perrin on the directory does not keep it
 * there either: SAME_REQUEST_OTHER_PERSON (on) then reads it the same way. These three tests turn that one flag off,
 * so the guard path they pin stays covered; the same-request reading is covered by its own replay cases.
 */
const GUARD_PATH_OFF = ["SAME_REQUEST_OFF_ROSTER_ENABLED"] as const;
function onTheGuardPath() {
  for (const name of GUARD_PATH_OFF) delete process.env[name];
}

describe(`FORM_EDIT_NOOP_GUARD_ENABLED: the overnight scan's sf-s11, "${SF_S11_REQUEST}"`, () => {
  beforeEach(onTheGuardPath);
  it("the request appended to the Observation is refused as copies_message; nothing written; never Updated", async () => {
    const thread = await janeDraft();
    const before = JSON.stringify(values(thread.id));
    model.next = { text: "Updated the form.", tool: { ops: [{ op: "append", field: "observation", value: SF_S11_REQUEST }] } };
    const reply = await thread.say(SF_S11_REQUEST);
    expect(values(thread.id).observation).not.toMatch(/do the same thing|switch it to a written/i);
    expect(JSON.stringify(values(thread.id))).toBe(before);
    expect(await lastTrace()).toMatchObject({ called: true, handoff: "refused", refused: [{ key: "observation", reason: "copies_message" }] });
    expect(reply.formUpdate).toBeUndefined();
    expect(reply.content).toBe(NOTHING);
  });

  /*
   * Moved on purpose (Port from Ask Bubbles 50eb26da, #429): Corrective Action revision 8
   * (#512) removed the Other write-in (`other_offense`). The same proof on an empty line
   * revision 8 still has and the tool may write: Prior Actions, empty after the draft.
   */
  it("the request set into an empty line (Prior Actions) is refused the same way", async () => {
    const thread = await janeDraft();
    expect(values(thread.id).prior_actions ?? "", "Prior Actions is empty after the draft").toBe("");
    model.next = { text: "Updated the form.", tool: { ops: [{ op: "set", field: "prior_actions", value: `${SF_S11_REQUEST}.` }] } };
    await thread.say(SF_S11_REQUEST);
    expect(values(thread.id).prior_actions ?? "").toBe("");
    expect(await lastTrace()).toMatchObject({ handoff: "refused", refused: [{ key: "prior_actions", reason: "copies_message" }] });
  });
});

describe("FORM_EDIT_NOOP_GUARD_ENABLED: the reply after an edit is the saved diff", () => {
  it(`a tool append ("${CA_CHAIN[5]}"): one "Updated:" line, never the old "Changed … to" text`, async () => {
    const thread = await janeDraft();
    model.next = { text: "I've updated the form.", tool: { ops: [{ op: "append", field: "observation", value: "she Must Practice the sanitizing checklist every shift." }] } };
    const reply = await thread.say(CA_CHAIN[5]);
    expect(values(thread.id).observation).toContain("she Must Practice the sanitizing checklist every shift.");
    expect(reply.content).toBe("Updated: Observation of Offense: Observed: Jane Doe was late to open on October 20, 2026. Expectation: Jane is…");
    expect(reply.content).not.toMatch(/^Changed /);
    expect(reply.formUpdate).toEqual({ instanceId: thread.id, updated: ["observation"] });
    expect(model.revisionCalls).toBe(0);
  });

  /*
   * Moved on purpose (Port from Ask Bubbles 50eb26da, #429): revision 8 (#512) has no
   * Tardiness or Absenteeism box and no Other write-in. The same proof on revision 8's
   * fields: a tick (Other) shows its option's label, and two changes (an append and a tick)
   * are two lines. The wording names no policy and no warning level, so the turn stays on
   * the edit tool.
   */
  it("a tick shows the option's label; two changes are two lines", async () => {
    const thread = await janeDraft();
    model.next = {
      text: "Done.",
      tool: { ops: [{ op: "set", field: "offense_type", value: ["attendance_policy", "other"] }, { op: "append", field: "observation", value: "She was also late on Tuesday." }] },
    };
    // This app's draft already ticks Attendance Policy (its Late Opening reading): the tick added is Other.
    const reply = await thread.say("tick Other for the offense and add that she was also late on Tuesday");
    // In the form's order (the saved rows, then new keys).
    // Changed on purpose (12 Nov 2026, QA's ruling (b) on #662): with STEP_B_ADD_UNDER_OBSERVED on, "She was also late on
    // Tuesday." is an account, so it goes at the end of Observed and the quoted start of the field shows it.
    expect(reply.content).toMatch(
      /^Updated: Observation of Offense: Observed: Jane Doe was late to open on October 20, 2026\. (?:Expectation: Jane is|She was also late on)…\nUpdated: Type of Offense: Attendance Policy, Other$/,
    );
  });

  it('a clear shows "(cleared)"', async () => {
    const thread = await janeDraft();
    model.next = { text: "Cleared it.", tool: { ops: [{ op: "clear", field: "observation" }] } };
    const reply = await thread.say("clear the observation of offense");
    expect(values(thread.id).observation ?? "").toBe("");
    expect(reply.content).toBe("Updated: Observation of Offense: (cleared)");
  });

  it('wording only ("make it sound more professional"): the tool is not called, the revision rewrites, and the reply is the saved diff', async () => {
    const thread = await janeDraft();
    model.next = { text: "A grounded answer from the policy manual.", tool: null };
    model.revision = { values: { observation: OBSERVATION_AFTER[0]!.replace("was late to open", "arrived late to open") } };
    const reply = await thread.say("make it sound more professional");
    expect(model.revisionCalls).toBe(1);
    expect(values(thread.id).observation).toContain("Jane Doe arrived late to open");
    expect(reply.content).toBe("Updated: Observation of Offense: Observed: Jane Doe arrived late to open on October 20, 2026. Expectation: Jane…");
    expect(reply.formUpdate).toEqual({ instanceId: thread.id, updated: ["observation"] });
  });

  it("wording only, with the tool called on a rewrite that drops words: refused, handed to the revision", async () => {
    const thread = await janeDraft();
    model.next = { text: "Rewritten.", tool: { ops: [{ op: "set", field: "observation", value: "Jane Doe arrived late on October 20, 2026." }] } };
    model.revision = { values: { observation: OBSERVATION_AFTER[0]!.replace("was late to open", "arrived late to open") } };
    const reply = await thread.say("make it sound more professional");
    expect(model.revisionCalls).toBe(1);
    expect(reply.content).toMatch(/^Updated: Observation of Offense: Observed: Jane Doe arrived late to open/);
  });

  it("the revision writes nothing: exactly the new sentence, not its own wording", async () => {
    const thread = await janeDraft();
    model.next = { text: "I updated the draft with those details.", tool: null };
    const reply = await thread.say("can you make it more professional");
    expect(reply.content).toBe(NOTHING);
    expect(reply.formUpdate).toBeUndefined();
  });

  /*
   * Ask Sunny difference: the sibling's test corrects a Job Title the draft
   * already has, and the correction's writer refuses it as same_value. Here
   * the draft leaves the Job Title empty, and a Corrective Action takes only
   * its date, payroll, level and prior actions from chat (`chat-correction.ts`;
   * the level and prior-action readers already skip a value the form has), so
   * QA's own position turn is no correction: the tool is offered and not
   * called, the revision writes nothing, and the reply is the guard's line.
   * The correction preset's same_value is pinned by `form-noop-guard.test.ts`.
   */
  it(`QA's position turn ("${CA_CHAIN[4]}"), which this app's Corrective Action does not take from chat: nothing written, handed off, never Updated`, async () => {
    const thread = await janeDraft();
    const before = JSON.stringify(values(thread.id));
    model.next = { text: "I've updated her position to Tanning Consultant.", tool: null };
    const reply = await thread.say(CA_CHAIN[4]);
    expect(JSON.stringify(values(thread.id))).toBe(before);
    expect(reply.content).toBe(NOTHING);
    expect(reply.formUpdate).toBeUndefined();
    expect(model.revisionCalls, "the old chain's revision ran").toBe(1);
    expect(await lastTrace()).toMatchObject({ offered: true, handoff: "not_called" });
  });

  it('the date the form already has ("change the date to 10/20"): the correction\'s own check answers before any write, and claims nothing', async () => {
    const thread = await janeDraft();
    const before = JSON.stringify(values(thread.id));
    const reply = await thread.say("change the date to 10/20");
    expect(JSON.stringify(values(thread.id))).toBe(before);
    expect(reply.formUpdate).toBeUndefined();
    expect(reply.content.split("\n").filter((line) => CLAIM.test(line) && !/n't\b/.test(line))).toEqual([]);
  });

  it("a correction that changes the date still answers as the correction", async () => {
    const thread = await janeDraft();
    const reply = await thread.say("change the date to 10/19");
    expect(values(thread.id).form_date).toBe("2026-10-19");
    expect(reply.formUpdate?.updated).toContain("form_date");
  });
});

describe("FORM_EDIT_NOOP_GUARD_ENABLED needs FORM_EDIT_SINGLE_WRITER_ENABLED", () => {
  it("with the tool flags but not the guard, the old replies (pinned in the flags-off fixture)", async () => {
    setFlags(TOOL_FLAGS);
    onTheGuardPath();
    const thread = await janeDraft();
    model.next = { text: "Updated the form.", tool: { ops: [{ op: "append", field: "observation", value: SF_S11_REQUEST }] } };
    const reply = await thread.say(SF_S11_REQUEST);
    // Before the guard: the request reached the Observation, and the reply said so in the old words.
    expect(values(thread.id).observation).toContain(SF_S11_REQUEST);
    // Changed on purpose (12 Nov 2026, Gate-Sunny-2 on #662): with STEP_B_REPLY_KEEPS_LINES on, a field written on several
    // lines is quoted line by line ("Changed Observation of Offense to:\n> …"); either way the reply names the change.
    expect(reply.content).toMatch(/^Changed Observation of Offense to(?: "|:\n> )/);
  });
});

/*
 * Pau's ruling A3 (4 Nov 2026): edit_form is offered on question turns too,
 * and this guard is what keeps a pure question from writing. A question the
 * model answers in text keeps that text as its reply — never the guard line;
 * the guard line is only for a tool call that wrote nothing, or an edit the
 * old chain tried and that changed nothing.
 */
describe("FORM_EDIT_NOOP_GUARD_ENABLED with a pure question (Pau's ruling A3)", () => {
  for (const said of ["what policy does that fall under?", "what is the policy on being late?", "can you tell me what the expectation is?"]) {
    it(`"${said}" answered in text: offered, nothing written, the reply is the model's answer`, async () => {
      const thread = await janeDraft();
      const before = JSON.stringify(values(thread.id));
      model.next = { text: "That falls under the attendance section of the policy manual.", tool: null };
      const reply = await thread.say(said);
      expect(await lastTrace()).toMatchObject({ offered: true, called: false });
      expect(JSON.stringify(values(thread.id))).toBe(before);
      expect(reply.content).toBe("That falls under the attendance section of the policy manual.");
      expect(reply.formUpdate).toBeUndefined();
      expect(model.revisionCalls, "a question reached the revision").toBe(0);
    });

    it(`"${said}" with a no-op tool call: nothing written, the reply is the guard line`, async () => {
      const thread = await janeDraft();
      const before = JSON.stringify(values(thread.id));
      model.next = { text: "That falls under the attendance section.", tool: { ops: [{ op: "append", field: "observation", value: "Jane Doe was late to open on October 20, 2026." }] } };
      const reply = await thread.say(said);
      expect(await lastTrace()).toMatchObject({ offered: true, called: true, handoff: "refused", refused: [{ key: "observation", reason: "same_value" }] });
      expect(JSON.stringify(values(thread.id))).toBe(before);
      expect(reply.content).toBe(NOTHING);
    });
  }
});

