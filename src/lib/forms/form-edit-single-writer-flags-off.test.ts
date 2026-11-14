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

/**
 * ============================================================================
 * FORM_EDIT_SINGLE_WRITER_ENABLED: FLAGS OFF BYTE FOR BYTE, AND ON THE ONE WRITER
 * ============================================================================
 *
 * Ported from Ask Bubbles (117e33b1, Step 2a; QA conditions 1 and 3), in this
 * app's setting: a salon director at the Kearney salon, invented people. One
 * script of turns that reaches every path the flag wraps — a correction
 * ("change the date to 10/20"), the payroll answer and its amount ("$25"
 * after the amount question), a policy change ("can you add late opening
 * policy …"), "fix her last name to …", a redraft of a Corrective Action
 * whose lines she typed, a same-form copy, openDraftTurn, and a reopen of a
 * finalized form with a change in the same sentence — is run through the
 * real chat, forms and draft routes:
 *
 *   (a) the flag unset;
 *   (b) the flag unset, the Step B flags (reducer, reply-from-diff) on: the
 *       single writer does not depend on them, and stays unloaded;
 *   (c) a control: the flag on. It must differ from (a), and load the module.
 *
 * Each on production's flags, and (a) once more with nothing set at all.
 * `form-write` is never loaded with the flag off; (a) equals what Ask Sunny's
 * main (66559725, before this flag) did with the same script, recorded in
 * `form-edit-single-writer-flags-off.main.json` (`RECORD_MAIN_FIXTURE=1` on
 * main rewrites it), and so does (b) against main with the same Step B flags.
 * Ids are numbered in order of first appearance.
 *
 * With the flag on, each path's turn reaches the one writer: the entry points
 * of `form-write` are wrapped to record the path each call names. Each entry
 * point calls `writeFormEdits` itself (`form-write.test.ts` pins that). No
 * model is called: every model module is stubbed, and the stubs count calls.
 */

const loaded = vi.hoisted(() => ({ writer: 0, paths: [] as string[], models: 0 }));
vi.mock("@/lib/forms/form-write", async (importOriginal) => {
  loaded.writer += 1;
  const actual = await importOriginal<Record<string, unknown>>();
  const record = (name: string, path: (args: unknown[]) => string | undefined) =>
    async (...args: unknown[]) => {
      loaded.paths.push(`${name}:${path(args) ?? "?"}`);
      return (actual[name] as (...inner: unknown[]) => unknown)(...args);
    };
  const pathAt = (index: number) => (args: unknown[]) => (args[index] as { path?: string } | undefined)?.path;
  return {
    ...actual,
    writeFormEdits: record("writeFormEdits", pathAt(2)),
    draftWrite: record("draftWrite", pathAt(4)),
    statedWrite: record("statedWrite", () => "stated"),
    clearWrite: record("clearWrite", pathAt(3)),
    correctionWrite: record("correctionWrite", () => "correction"),
    copyThroughWriter: record("copyThroughWriter", () => "copy"),
    syncPlan: record("syncPlan", () => "plan"),
    editSnapshot: record("editSnapshot", (args) => String(args[1])),
    realizedClaim: record("realizedClaim", () => "claim"),
  };
});

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

const state = vi.hoisted(() => ({ draft: {} as Record<string, unknown>, answer: null as string | null }));

// As production builds the role table when the ASD may create forms (NEXT_PUBLIC_, read once at load).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED = "true";
});

/** Invented people at the Kearney salon (checked against the directory fixtures: none of them is there). */
const SALON = "loc-0309";
const DIRECTORY = [
  { id: "ap-ines", firstName: "Ines", lastName: "Larkspur", preferredFirstName: null, employmentStatus: "active", salonIds: [SALON], positionName: "Tanning Consultant" },
  { id: "ap-ines-2", firstName: "Ines", lastName: "Larkhaven", preferredFirstName: null, employmentStatus: "active", salonIds: [SALON], positionName: "Tanning Consultant" },
  { id: "ap-liesl", firstName: "Liesl", lastName: "Montclair", preferredFirstName: null, employmentStatus: "active", salonIds: [SALON], positionName: "Tanning Consultant" },
  { id: "ap-nell", firstName: "Nell", lastName: "Ravensworth", preferredFirstName: null, employmentStatus: "active", salonIds: [SALON], positionName: "Tanning Consultant" },
  { id: "ap-odile", firstName: "Odile", lastName: "Ambermere", preferredFirstName: null, employmentStatus: "active", salonIds: [SALON], positionName: "Tanning Consultant" },
];

vi.mock("@/lib/forms/form-patch-call", () => ({
  FORM_PATCH_DEFAULT_TIMEOUT_MS: 5_000,
  formPatchTimeoutMs: () => 5_000,
  callFormPatchModel: async () => ({ fallback: "error" }),
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
vi.mock("@/lib/ai/call-claude", () => ({
  // The replay pack's reader: no name is read by the model; the app's own readers find it.
  callClaudeToolTimed: async () => ({ input: { employee: null, incident: null, incidentDate: null }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
  callClaude: async () => {
    loaded.models += 1;
    return state.answer ?? "A grounded answer from the policy manual.";
  },
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: unknown }) => {
    if (input.tool?.name === "extract_form_fields") {
      const text = JSON.stringify(input.messages ?? []).toLowerCase();
      return { templateKey: text.includes("coaching") ? "coaching" : "dpoa", employeeName: null, observation: null, actionPlan: null };
    }
    return null;
  },
}));
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => ({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: request.tool_choice?.name === "revise_form_fields" ? "revise_form_fields" : "write_form_fields",
            input: request.tool_choice?.name === "revise_form_fields" ? { values: {} } : state.draft,
          },
        ],
      }),
    },
  }),
}));
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
    // The progression framework, as the replay pack has it: a governed form's draft reaches its write.
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
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: JBA_MANUAL_CA_CHUNKS,
      };
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
      actual.scopeRoster(DIRECTORY as never, scope).map((person) => ({ ...person, title: (person as { positionName?: string | null }).positionName ?? null, primaryLocationName: "Kearney" })),
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(DIRECTORY as never, scope),
  };
});
vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

const FLAG = "FORM_EDIT_SINGLE_WRITER_ENABLED";
const STEP_B = ["FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"] as const;
/*
 * Changed on purpose (7 Nov 2026): production-flags.json now lists QA's flips of 5 and 6 Nov as on. The recorded
 * fixture is main's behaviour before this flag, under production's flags as they were then, so the base leaves those seven off,
 * as it leaves this flag off. The fixture and every assertion are unchanged.
 */
const FLIPPED_AFTER_FIXTURE: readonly string[] = [
  "CA_SALES_POLICY_ENABLED",
  "REPLY_MATCHES_CARD_ENABLED",
  "TITLE_OF_THE_EMPLOYEE_ENABLED",
  "METRIC_GUARD_ENABLED",
  "TITLE_ENDS_AT_LINE_ENABLED",
  "BARE_NOT_DENIAL_ENABLED",
  "PLACE_FROM_CUE_ENABLED",
  // Changed on purpose (7 Nov 2026): QA's flip 7 turned these on in production; the fixture predates them.
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
  // Changed on purpose (10 Nov 2026): QA round 19 turned this on in production. The script's "Create a coaching form." -> name -> yes
  // now asks what happened (sf-s27), so the fixture, which predates it, is compared with it off.
  "COACHING_ASKS_WHAT_HAPPENED_ENABLED",
  // Changed on purpose (10 Nov 2026): QA round 23 turned this on in production. A name-only coaching ask no longer offers Create
  // beside "what happened" (the card's text changes); the fixture predates it, so it is compared with it off.
  "WHAT_HAPPENED_NO_CREATE_ENABLED",
  // Changed on purpose (11 Nov 2026): QA round 24 turned these on in production (#807). A finalize with a blank Direct
  // policy is no longer held and its event gains policyBlankAtFinalize; the fixture predates them, so it is compared with them off.
  "POLICY_GATE_NONBLOCKING_ENABLED",
  "NEXT_PUBLIC_POLICY_GATE_NONBLOCKING_ENABLED",
  // Changed on purpose (13 Nov 2026): QA round 38a turned these on in production. HUMAN_REPLIES shortens a later card
  // turn's opener ("Got it — here's the card."); the fixture predates them, so it is compared with them off.
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
  "OBSERVATION_NO_LEADING_NAME_ENABLED",
  "WORK_AREA_NOT_A_TITLE_ENABLED",
  "REASON_PLACE_NOT_SALON_ENABLED",
  "OTHER_BESIDE_DESCRIBED_ENABLED",
  "MODEL_WARNING_LEVEL_DISCARDED_ENABLED",
];
const PRODUCTION = [...PRODUCTION_FLAGS.on, ...PRODUCTION_FLAGS.assumedOn].filter((name) => !FLIPPED_AFTER_FIXTURE.includes(name));
/*
 * FORM_EDIT_TOOL_IN_STREAM_ENABLED (Step 3) is pinned off here like the Step B
 * flags: this file is about the single writer alone, and the edit tool makes
 * the answering call ahead of the old chain (its own tests:
 * form-edit-tool-in-stream-*.test.ts). Classification, 4 Nov 2026: the
 * control's model count read the shell's tool flag.
 */
const TOUCHED = [...new Set([FLAG, ...STEP_B, "FORM_EDIT_TOOL_IN_STREAM_ENABLED", ...PRODUCTION, ...PRODUCTION_FLAGS.off])];
const saved = new Map<string, string | undefined>();

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

function setFlags(base: "production" | "none", on: readonly string[]) {
  for (const name of TOUCHED) delete process.env[name];
  if (base === "production") for (const name of PRODUCTION) process.env[name] = "true";
  for (const name of on) process.env[name] = "true";
}

/* ---------------------------------------------------------- the script --- */

/** The overview view's joined columns (template key, name, version), as the replay pack keeps them. */
function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, { template_key: template?.key, template_name: template?.name, layout_family: template?.layout_family, template_version: version?.version });
  }
}
class JoiningRows extends Array<Record<string, unknown>> {
  override push(...rows: Record<string, unknown>[]) {
    const count = super.push(...rows);
    joinOverview();
    return count;
  }
}

type Answer = { content: string; formProposal?: ChatFormProposal; formOpened?: { instanceId: string }; formUpdate?: { instanceId: string; updated: string[] } };

/** The paths each labelled turn reached (flag on). */
const reached: Record<string, string[]> = {};

async function script(): Promise<string> {
  const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
  const { createInlineForm } = await import("@/features/chat/create-inline-form");
  const chatRoute = await import("@/app/api/chat/route");
  const instancesRoute = await import("@/app/api/forms/instances/route");
  const draftRoute = await import("@/app/api/forms/instances/[id]/draft/route");
  const instanceRoute = await import("@/app/api/forms/instances/[id]/route");
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  state.draft = { values: {} };
  state.answer = null;
  await ensureTemplateLibrary("system");

  const call = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const request = new Request(`https://app.test${url}`, init);
    const id = url.startsWith("/api/forms/instances/") ? url.split("/")[4]! : null;
    const response = id ? await draftRoute.POST(request, { params: Promise.resolve({ id }) }) : await instancesRoute.POST(request);
    const body = (await response.json()) as T & Record<string, unknown>;
    if (!response.ok) throw new Error(String(body.error ?? response.status));
    return body;
  };
  const toUuid = (id: string) => {
    const uuid = randomUUID();
    for (const table of ["form_instances", "form_instance_values", "form_instance_events"] as const) {
      for (const row of store[table]) {
        if (row.id === id) row.id = uuid;
        if (row.instance_id === id) row.instance_id = uuid;
      }
    }
    return uuid;
  };

  const replies: unknown[] = [];
  const chat = () => {
    const messages: ChatMessage[] = [];
    let proposal: ChatFormProposal | null = null;
    let instanceId: string | null = null;
    const conversationId = createId("conv");
    return {
      get id() {
        return instanceId;
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
        const payload = response.headers.get("x-chat-stream") ? (raw as unknown as { body: Answer }).body : raw;
        replies.push({ question, status: response.status, payload });
        messages.push(
          { id: `m${messages.length}`, role: "user", content: question, createdAt: "2026-10-26T12:00:00Z" } as ChatMessage,
          { id: `a${messages.length}`, role: "assistant", content: payload.content, createdAt: "2026-10-26T12:00:01Z", ...(payload.formProposal ? { formProposal: payload.formProposal } : {}) } as ChatMessage,
        );
        if (payload.formProposal) proposal = payload.formProposal;
        if (payload.formOpened && !instanceId) instanceId = payload.formOpened.instanceId;
        return payload;
      },
      async create(): Promise<string> {
        const created = await createInlineForm({ proposal: proposal!, messages, call, onCreated: () => {} });
        instanceId = toUuid(created.reference.instanceId);
        return instanceId;
      },
      type(values: Record<string, string>) {
        for (const [key, value] of Object.entries(values)) {
          const row = store.form_instance_values.find((entry) => entry.instance_id === instanceId && entry.field_key === key);
          if (row) Object.assign(row, { value, filled_by: "manager" });
          else store.form_instance_values.push({ id: `typed-${key}`, instance_id: instanceId, field_key: key, value, checked: [], filled_by: "manager", provenance: {}, updated_at: new Date().toISOString() } as never);
        }
      },
    };
  };

  const turn = async (label: string, run: () => Promise<unknown>) => {
    const from = loaded.paths.length;
    await run();
    reached[label] = [...(reached[label] ?? []), ...loaded.paths.slice(from)];
  };

  // 1. A correction: the date it already has, then another.
  const correction = chat();
  await correction.say("create ca form for ines larkspur for a register shortage on 10-20-26.");
  await correction.create();
  await turn("correction", () => correction.say("change the date to 10/20"));
  await turn("correction", () => correction.say("change the date to 10/19"));

  // 1a. The payroll answer, then the amount after the amount question (this app's own amount line).
  await turn("correction", () => correction.say("change payroll deduct to yes"));
  await turn("correction", () => correction.say("$25"));

  // 1b. A policy change on that draft, in the District Manager's words.
  await turn("policy", () => correction.say("can you add late opening policy to the direct policy section of this form"));

  // 2. "fix her last name to …" on a Coaching Form.
  const name = chat();
  for (const said of ["Create a coaching form.", "Liesl", "yes"]) await name.say(said);
  await name.create();
  await turn("correction", () => name.say("fix her last name to Ferrand"));

  // 5. An ordinary answer that claims an update, on that draft.
  state.answer = "Done — I updated the draft with those details.";
  await name.say("make that update");
  state.answer = null;

  // 3. A redraft of a blank Corrective Action whose account and plan she had typed.
  const redraft = chat();
  await redraft.say("create ca for odile ambermere");
  await redraft.create();
  redraft.type({
    observation: "Odile was short at the register by 20 dollars at close on 10-20-26.",
    action_plan: "Odile will count the drawer with a manager at every close for the next 30 days.",
  });
  // The drafting model writes the Observation from her account (so the route reaches its write).
  state.draft = { values: { observation: "Odile was short at the register by 20 dollars at close on October 20, 2026." } };
  await turn("redraft", () => redraft.say("she was short at the register by 20 dollars at close on 10-20-26"));
  state.draft = { values: {} };

  // 4. A same-form copy, asked twice.
  const nell = chat();
  for (const said of ["Create a coaching form.", "Nell", "yes"]) await nell.say(said);
  state.draft = { values: { coaching_details: "Nell was coached on salon tours: greet the guest, walk the beds in order, then book the next visit." } };
  await nell.create();
  state.draft = { values: {} };
  const odile = chat();
  for (const said of ["Create a coaching form.", "Odile", "yes"]) await odile.say(said);
  await odile.create();
  for (let round = 0; round < 2; round += 1) {
    await turn("copy", async () => {
      const reply = await odile.say("can you create the same draft that we did with nell ravensworth by changing the name and position?");
      if (reply.content.includes("Replace them with")) await odile.say("yes, replace them");
    });
  }

  // 5b. openDraftTurn: with Ines's draft open, a turn no other path reads is content for it.
  await turn("open_draft", () => correction.say("underperformance for the month of october"));

  // 6. A finalized Corrective Action reopened, with the change in the same sentence.
  const finalized = chat();
  await finalized.say("create ca form for nell ravensworth for a register shortage on 10-21-26.");
  const finalId = await finalized.create();
  const done = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${finalId}`, {
      method: "POST",
      body: JSON.stringify({ action: "finalize", followUpDate: null, acknowledgeUnverifiedPolicy: true }),
    }),
    { params: Promise.resolve({ id: finalId }) },
  );
  joinOverview();
  replies.push({ finalize: done.status });
  const reopen = chat();
  await turn("reopen", () => reopen.say("edit the corrective action for Nell Ravensworth, change the date to 10/22"));

  // 6b. This app's reopen that shows the draft with edits (DRAFT_MERGE_ENABLED): its restore is a write too.
  const shown = chat();
  await turn("reopen", () => shown.say("show the corrective action for Ines Larkspur with edits"));

  // 7. The Corrective Action's header name, from chat (CA_NAME_FROM_CHAT_ENABLED, roster-confirmed): the line and the column.
  await turn("correction", () => correction.say("change her name to Ines Larkhaven"));

  const order = (id: unknown) => store.form_instances.findIndex((row) => row.id === id);
  const rows = store.form_instance_values
    .map((row) => ({ instance: row.instance_id, key: row.field_key, value: row.value ?? null, checked: row.checked ?? [], filledBy: row.filled_by, source: (row.provenance as { source?: unknown } | null)?.source ?? null }))
    // In the order the forms were created, then by key: never by an id, which is random.
    .sort((a, b) => order(a.instance) - order(b.instance) || String(a.key).localeCompare(String(b.key)));
  const forms = store.form_instances.map((row) => ({ id: row.id, employee: row.employee_name, date: row.form_date, status: row.status }));
  const events = store.form_instance_events.map((row) => ({ instance: row.instance_id, kind: row.kind ?? row.event_type ?? null, detail: row.detail ?? null }));
  return numbered({ replies, forms, rows, events });
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

/* ---------------------------------------------------------------- tests --- */

const FIXTURE = join("src", "lib", "forms", "form-edit-single-writer-flags-off.main.json");
const RECORDING = process.env.RECORD_MAIN_FIXTURE === "1";

describe("FORM_EDIT_SINGLE_WRITER_ENABLED off: the same chats, byte for byte", () => {
  const runs: Record<string, string> = {};
  const ms: Record<string, number> = {};
  let modelsOff = 0;

  it("(a) the flag unset, (b) the flag unset with the Step B flags on — on production's flags; nothing loads form-write", async () => {
    setFlags("production", []);
    const at = performance.now();
    const models = loaded.models;
    runs.a = await script();
    ms.a = performance.now() - at;
    modelsOff = loaded.models - models;
    setFlags("production", [...STEP_B]);
    runs.b = await script();
    setFlags("none", []);
    runs.noneA = await script();
    expect(loaded.writer, "form-write was loaded with the flag off").toBe(0);
    if (RECORDING) return;
    const flags: Record<string, unknown> = await import("@/lib/config/chat-quality-flags");
    setFlags("production", []);
    expect((flags.formEditSingleWriterEnabled as () => boolean)(), "the flag defaults off").toBe(false);
  }, 300_000);

  it("the script reached each wrapped path (so the comparisons compare something)", () => {
    for (const text of SCRIPT_REACHES) expect(runs.a, text).toContain(text);
  });

  it("(a) and (b) equal main's behaviour with the same script (replies, rows, events)", () => {
    const main = { a: runs.a, b: runs.b, noneA: runs.noneA };
    if (RECORDING) writeFileSync(FIXTURE, `${JSON.stringify(main, null, 1)}\n`);
    expect(existsSync(FIXTURE), `${FIXTURE} is missing`).toBe(true);
    const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof main;
    // Changed on purpose (QA's #755 gate, 10 Nov 2026): with COACHING_OBSERVED_SAVED_ENABLED on (the gate runs every flag
    // on) the saved coaching Details start with "Observed:" — the only difference from main's run, so with that flag on
    // the comparison drops the heading on both sides. Every other byte is still main's.
    const heading = (text: string) => (process.env.COACHING_OBSERVED_SAVED_ENABLED === "true" ? text.replaceAll('"Observed:\\n', '"') : text);
    expect(heading(runs.a)).toBe(heading(recorded.a));
    expect(heading(runs.b)).toBe(heading(recorded.b));
    expect(heading(runs.noneA)).toBe(heading(recorded.noneA));
  });

  it.skipIf(RECORDING)(
    "(c) control: the flag on differs from (a), loads the module, and every path's turn reaches the one writer — with no model call",
    async () => {
      for (const key of Object.keys(reached)) delete reached[key];
      setFlags("production", [FLAG]);
      const at = performance.now();
      const models = loaded.models;
      const on = await script();
      const modelsOn = loaded.models - models;
      runs.c = on;
      ms.c = performance.now() - at;
      expect(on).not.toBe(runs.a);
      expect(loaded.writer).toBeGreaterThan(0);
      // QA condition 5: the one writer calls no model — the stubbed answering model is called as often as with the flag off.
      expect(modelsOn, "a model call added by the flag").toBe(modelsOff);
      expect(reached.correction).toEqual(expect.arrayContaining(["correctionWrite:correction"]));
      expect(reached.policy).toEqual(expect.arrayContaining(["draftWrite:policy"]));
      expect(reached.redraft).toEqual(expect.arrayContaining(["draftWrite:redraft"]));
      expect(reached.copy).toEqual(expect.arrayContaining(["copyThroughWriter:copy"]));
      // openDraftTurn reaches the one writer for its snapshot and checked claim; its write is the protected revision's until 2b.
      expect(reached.open_draft).toEqual(expect.arrayContaining(["editSnapshot:open_draft"]));
      /*
       * This app's reopen: the snapshot and the checked claim. Its correction
       * declines a sentence that names a Corrective Action
       * (`detectTemplateIntent` → "corrective_action", as on main), so the
       * date in the same sentence is not written by any path here.
       */
      expect(reached.reopen).toEqual(expect.arrayContaining(["editSnapshot:reopen"]));
      // QA condition 5: the time of the script with the flag on, against off (stubs only).
      process.stdout.write(`[single-writer] script ms: off ${ms.a?.toFixed(0)}, on ${ms.c.toFixed(0)}\n`);
    },
    300_000,
  );
  it.runIf(process.env.DUMP_RUNS)("dump", () => {
    for (const [name, text] of Object.entries(runs)) writeFileSync(`${process.env.DUMP_RUNS}/${name}.json`, text);
  });
});

/** Replies the flag-off script must contain: each wrapped path answered (read off main's run). */
const SCRIPT_REACHES: readonly string[] = [
  "Updated the **Corrective Action Form** for **Ines Larkspur**: Date → 2026-10-20",
  "Is payroll deduct applicable? → Yes",
  "Payroll deduction amount → $25",
  "Updated Direct policy from official manual on the **Corrective Action Form** for **Ines Larkspur**",
  "The name on a Coaching Form isn't changed from the chat",
  "Redrafted the **Corrective Action Form** for **Odile Ambermere**",
  "Copied Nell Ravensworth's Coaching Form content onto Odile Ambermere's draft",
  "Corrective Action Form** for **Nell Ravensworth** was finalized, so I opened a new draft",
  "Employee Name → Ines Larkhaven",
];
