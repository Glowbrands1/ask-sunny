import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import PRODUCTION_FLAGS from "@/config/production-flags.json";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

import { CA_CHAIN, LIVE_ROSTER, OBSERVATION_AFTER } from "./replay-pack/nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * FORM_EDIT_NOOP_GUARD_ENABLED OFF: THE SAME CHATS, BYTE FOR BYTE (STEP 4)
 * ============================================================================
 *
 * Ported from Ask Bubbles (bdabffbe). One script of edit turns on an open
 * Corrective Action (Jane Doe at the Kearney salon, invented), through the
 * real chat, forms and draft routes and the REAL `callClaude` (only the
 * Anthropic client is a double, streamed as this app's answering call is and
 * scripted per turn as in `form-edit-tool-in-stream-e2e.test.ts`): a tool append, a tool set to the
 * value already there, a tool append that copies the whole message (the
 * overnight scan's sf-s11), a tool clear, a tool tick, the tool not called and
 * the revision answering, the tool not called and nothing answering, and a
 * correction to the date the form already has. Recorded:
 *
 *   (a) production's flags with FORM_EDIT_SINGLE_WRITER_ENABLED and
 *       FORM_EDIT_TOOL_IN_STREAM_ENABLED on;
 *   (b) production's flags alone;
 *   (c) production's flags with FORM_EDIT_NOOP_GUARD_ENABLED on alone (it
 *       needs the single writer, so it is off).
 *
 * (a) and (b) equal Ask Sunny's main before this flag, recorded in
 * `form-edit-noop-guard-flags-off.main.json` (`RECORD_MAIN_FIXTURE=1` on that
 * commit rewrites it); (c) equals (b).
 *
 * Re-recorded on purpose (Port from Ask Bubbles 50eb26da, #429) on 7db7bf66:
 * Corrective Action revision 8 (#512) before this flag (#511). First recorded
 * on 7cd59a77 (revision 6 in the database). The ONLY difference, in (a) and in
 * (b) alike, is the first draft's Type of Offense: the drafting model's
 * "tardiness" is ticked as the box that replaced it, `attendance_policy`, and
 * Policy Violated reads "Attendance Policy — Late Opening" (was
 * "Tardiness/Leaving Early — Late Opening"): revision 8's intended rename of
 * the box, not the guard (accepted by QA, 4 Nov 2026). Every reply, every other row and
 * every event is byte-identical, the scripted "tardiness" tick included (it
 * saved nothing before, on a form that already had it, and saves nothing now,
 * on a form with no such box). Replies, rows and events; ids numbered in order
 * of first appearance.
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

vi.setConfig({ testTimeout: 300_000, hookTimeout: 60_000 });

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
  /*
   * Changed on purpose (10 Nov 2026): QA round 22 turned the roster-name set on in production. Of its nine flags only
   * FORM_NAME_FROM_ROSTER changes this recording, and only in one field: the open Corrective Action's sourceMessageIds
   * gains m0, m2 and m4, the earlier turns naming the same employee (`turnsAboutThisForm` reads them with the roster's
   * spelling of the name). Every reply, every other row and every event is unchanged; the other eight flags change
   * nothing here, so they stay in the production base.
   */
  "FORM_NAME_FROM_ROSTER_ENABLED",
  // Changed on purpose (11 Nov 2026): QA round 25 turned SAME_REQUEST_OFF_ROSTER on in production. sf-s11's "Can you do
  // the same thing for Perrin Haldane …" (Perrin on no directory) is then the same request for another person, not an
  // edit of the open draft; the recording predates it, so it is compared with it off.
  "SAME_REQUEST_OFF_ROSTER_ENABLED",
  // Changed on purpose (13 Nov 2026): QA round 38a turned these on in production. HUMAN_REPLIES shortens a later card
  // turn's opener; the fixture predates them, so it is compared with them off.
  "HUMAN_REPLIES_ENABLED",
  "OFF_ROSTER_PLACE_ANSWER_ENABLED",
  "OFFERED_NAME_ACCEPTED_ENABLED",
  "SAME_NAME_ASKS_WHICH_ENABLED",
  "FORM_DATE_BUSINESS_TODAY_ENABLED",
  "CLOSE_SPELLING_MATCH_ENABLED",
  "SHARED_CITY_ASKS_SALON_ENABLED",
  "OTHER_POLICY_AGREES_ENABLED",
  "OTHER_NOT_A_POLICY_NAME_ENABLED",
  "EDIT_SEES_SAVED_FORM_ENABLED",
  "CARD_CHECKED_AGAINST_WORDS_ENABLED",
  "CARD_ADDED_FACT_IN_OBSERVATION_ENABLED",
  "PLACE_STRIP_WHOLE_PHRASE_ONLY_ENABLED",
  "ON_FILE_LINE_NOT_THE_POLICY_ENABLED",
];
const PRODUCTION = [...PRODUCTION_FLAGS.on, ...PRODUCTION_FLAGS.assumedOn].filter((name) => !FLIPPED_IN_FLIP_7.includes(name));
const TOOL_FLAGS = ["FORM_EDIT_SINGLE_WRITER_ENABLED", "FORM_EDIT_TOOL_IN_STREAM_ENABLED"] as const;
const NOOP = "FORM_EDIT_NOOP_GUARD_ENABLED";
const TOUCHED = [...new Set([NOOP, ...TOOL_FLAGS, ...PRODUCTION, ...PRODUCTION_FLAGS.off, "FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"])];
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

type Answer = { content: string; formProposal?: ChatFormProposal; formOpened?: { instanceId: string }; formUpdate?: { instanceId: string; updated: string[] } };

/** The overnight scan's sf-s11 request, the manager's words. */
const SF_S11_REQUEST = "Can you do the same thing for Perrin Haldane but switch it to a written";

async function script(): Promise<string> {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  model.main.length = 0;
  model.draftCalls = 0;
  model.revisionCalls = 0;
  model.next = { text: "A grounded answer from the policy manual.", tool: null };
  model.draft = { values: {} };
  model.revision = { values: {} };
  await (await import("@/lib/forms/repository")).ensureTemplateLibrary("system");
  const chatRoute = await import("@/app/api/chat/route");
  const instancesRoute = await import("@/app/api/forms/instances/route");
  const draftRoute = await import("@/app/api/forms/instances/[id]/draft/route");
  const { createInlineForm } = await import("@/features/chat/create-inline-form");
  const messages: ChatMessage[] = [];
  let proposal: ChatFormProposal | null = null;
  let instanceId: string | null = null;
  const conversationId = createId("conv");
  const replies: unknown[] = [];
  const call = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const request = new Request(`https://app.test${url}`, init);
    const id = url.startsWith("/api/forms/instances/") ? url.split("/")[4]! : null;
    const response = id ? await draftRoute.POST(request, { params: Promise.resolve({ id }) }) : await instancesRoute.POST(request);
    const body = (await response.json()) as T & Record<string, unknown>;
    if (!response.ok) throw new Error(String(body.error ?? response.status));
    return body;
  };
  const say = async (question: string, next: { text: string; tool: unknown }, revision: Record<string, unknown> = { values: {} }): Promise<Answer> => {
    model.next = next;
    model.revision = revision;
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
    const payload = response.headers.get("x-chat-stream") ? (raw as unknown as { body: Answer }).body : raw;
    replies.push({ question, status: response.status, payload });
    messages.push(
      { id: `m${messages.length}`, role: "user", content: question, createdAt: "2026-10-26T12:00:00Z" } as ChatMessage,
      { id: `a${messages.length}`, role: "assistant", content: payload.content, createdAt: "2026-10-26T12:00:01Z", ...(payload.formProposal ? { formProposal: payload.formProposal } : {}) } as ChatMessage,
    );
    if (payload.formProposal) proposal = payload.formProposal;
    return payload;
  };
  const text = (value: string) => ({ text: value, tool: null });

  await say(CA_CHAIN[0], text("A grounded answer from the policy manual."));
  model.draft = { values: { observation: OBSERVATION_AFTER[0]! } };
  const created = await createInlineForm({ proposal: proposal!, messages, call, onCreated: () => {} });
  instanceId = randomUUID();
  for (const table of ["form_instances", "form_instance_values", "form_instance_events"] as const) {
    for (const row of store[table]) {
      if (row.id === created.reference.instanceId) row.id = instanceId;
      if (row.instance_id === created.reference.instanceId) row.instance_id = instanceId;
    }
  }
  const observation = () => String(store.form_instance_values.find((row) => row.instance_id === instanceId && row.field_key === "observation")?.value ?? "");

  // 1. A tool append (a real change).
  await say(CA_CHAIN[5], { text: "I've updated the form with the sanitizing checklist.", tool: { ops: [{ op: "append", field: "observation", value: "she Must Practice the sanitizing checklist every shift." }] } });
  // 2. A tool set to the value the field already has.
  await say("set the observation to what it says now", { text: "Updated the Observation.", tool: { ops: [{ op: "set", field: "observation", value: observation() }] } });
  // 3. sf-s11: the manager's whole request appended to the Observation.
  await say(SF_S11_REQUEST, { text: "Updated the form.", tool: { ops: [{ op: "append", field: "observation", value: SF_S11_REQUEST }] } });
  // 4. A tool tick on the offense type.
  await say("mark the offense type as tardiness", { text: "Ticked it.", tool: { ops: [{ op: "set", field: "offense_type", value: ["tardiness"] }] } });
  // 5. Wording only: the tool not called, the revision rewrites.
  await say("make it sound more professional", text("A grounded answer from the policy manual."), { values: { observation: observation().replace("was late to open", "arrived late to open") } });
  // 6. The tool not called, and the revision writes nothing.
  await say("can you make it more professional", text("I updated the draft with those details."));
  // 7. A tool clear.
  await say("clear the observation of offense", { text: "Cleared it.", tool: { ops: [{ op: "clear", field: "observation" }] } });
  // 7. A correction to the date the form already has (twice: the second is the same value).
  await say("change the date to 10/20", text("A grounded answer from the policy manual."));
  await say("change the date to 10/20", text("A grounded answer from the policy manual."));

  const rows = store.form_instance_values
    .map((row) => ({ key: row.field_key, value: row.value ?? null, checked: row.checked ?? [], filledBy: row.filled_by, source: (row.provenance as { source?: unknown } | null)?.source ?? null }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const forms = store.form_instances.map((row) => ({ id: row.id, employee: row.employee_name, date: row.form_date, status: row.status }));
  const events = store.form_instance_events.map((row) => ({ kind: row.kind ?? row.event_type ?? null, detail: row.detail ?? null }));
  return numbered({ replies, forms, rows, events, models: { main: model.main.length, draft: model.draftCalls, revision: model.revisionCalls } });
}

/** Every generated id (UUIDs, the fake's `fake-N`) numbered in order of first appearance, so two runs compare byte for byte. */
function numbered(value: unknown): string {
  const text = JSON.stringify(value, null, 1);
  const ids = new Map<string, string>();
  let out = "";
  let at = 0;
  const hex = "0123456789abcdef";
  const isUuid = (from: number) => {
    if (from + 36 > text.length) return false;
    for (let index = 0; index < 36; index += 1) {
      const char = text[from + index]!;
      const dash = index === 8 || index === 13 || index === 18 || index === 23;
      if (dash ? char !== "-" : !hex.includes(char)) return false;
    }
    return true;
  };
  while (at < text.length) {
    let length = 0;
    if (isUuid(at)) length = 36;
    else if (text.startsWith("fake-", at)) {
      length = 5;
      while ("0123456789".includes(text[at + length] ?? "x")) length += 1;
      if (length === 5) length = 0;
    }
    if (length === 0) {
      out += text[at];
      at += 1;
      continue;
    }
    const id = text.slice(at, at + length);
    if (!ids.has(id)) ids.set(id, `#${ids.size + 1}`);
    out += ids.get(id);
    at += length;
  }
  return out;
}

const FIXTURE = join("src", "app", "api", "chat", "form-edit-noop-guard-flags-off.main.json");
const RECORDING = process.env.RECORD_MAIN_FIXTURE === "1";

describe("FORM_EDIT_NOOP_GUARD_ENABLED off: the same chats, byte for byte", () => {
  const runs: Record<string, string> = {};

  it("(a) the tool flags on, (b) production's flags, (c) the guard alone — equal to main before the flag", async () => {
    setFlags(TOOL_FLAGS);
    runs.toolFlags = await script();
    setFlags([]);
    runs.production = await script();
    if (RECORDING) {
      writeFileSync(FIXTURE, `${JSON.stringify(runs, null, 1)}\n`);
      return;
    }
    setFlags([NOOP]);
    runs.guardAlone = await script();
    expect(existsSync(FIXTURE), `${FIXTURE} is missing`).toBe(true);
    const main = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;
    expect(runs.toolFlags).toBe(main.toolFlags);
    expect(runs.production).toBe(main.production);
    expect(runs.guardAlone).toBe(main.production);
  });

  it.skipIf(RECORDING)("the script reaches the tool path, the handoff and the correction (so the comparison compares something)", () => {
    for (const text of ["Changed Observation of Offense to", "I didn't change anything on the form.", "Perrin Haldane"]) expect(runs.toolFlags, text).toContain(text);
  });

  it.skipIf(RECORDING)("(d) control: the guard on (with the tool flags) differs", async () => {
    setFlags([...TOOL_FLAGS, NOOP]);
    const on = await script();
    expect(on).not.toBe(runs.toolFlags);
  });

  it.runIf(process.env.DUMP_RUNS)("dump", () => {
    for (const [name, text] of Object.entries(runs)) writeFileSync(`${process.env.DUMP_RUNS}/${name}.json`, text);
  });
});
