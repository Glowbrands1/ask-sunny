import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * EVERY LIVE FLAG ON, AND THE AI READER ON AND OFF — THIS WEEK'S TESTER CHATS
 * ============================================================================
 *
 * QA, 27 Oct 2026: before AI_READS_CODE_CHECKS_ENABLED is switched on anywhere,
 * one test through POST /api/chat, Create and the draft with Ask Sunny's
 * production flags and this week's flags on, replaying the live testers' chats
 * word for word (names invented), the same turns with the reader off and on.
 * The two must end on the same form; a reader field never replaces a value the
 * rules settled. The model here writes what the live one wrote.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

const state = vi.hoisted(() => ({
  slotReading: "none" as "none" | "ca" | "copy",
  remapObservation: null as string | null,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
  reading: null as Record<string, unknown> | null,
  readerCalls: 0,
  stall: false,
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return {
    ...actual,
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  };
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "district_manager" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: "district_manager",
          scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));

const ANSWER = "A grounded answer from the policy manual.";

vi.mock("@/lib/ai/call-claude", async (importOriginal) => ({
  // The reader's call runs for real, against the stubbed client below.
  callClaudeToolTimed: (await importOriginal<typeof import("@/lib/ai/call-claude")>()).callClaudeToolTimed,
  callClaude: async () => {
    state.chatModelCalls += 1;
    return ANSWER;
  },
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "extract_form_fields") {
      const text = JSON.stringify(input.messages ?? []);
      return {
        templateKey: /\b(?:ca|corrective action)\b/i.test(text) ? "dpoa" : null,
        employeeName: /rory vance/i.test(text) ? "Rory Vance" : null,
        observation: state.remapObservation,
        actionPlan: null,
      };
    }
    if (input.tool?.name !== "record_intent_slots") return null;
    if (state.slotReading === "copy") {
      const text = JSON.stringify(input.messages ?? []);
      const manager = (text.split("Manager:").pop() ?? text).replace(/\\n/g, "\n");
      const dates = manager.match(/\b\d{1,2}-\d{1,2}\b/g) ?? [];
      return {
        employee: /rory vance/i.test(manager) ? "Rory Vance" : null,
        salon: /kearney/i.test(manager) ? "Kearney" : null,
        title: null,
        incidentType: /\blate\b/i.test(manager) ? "late" : null,
        incidentDate: dates[0] ?? null,
        payrollAmount: null,
        warningLevel: null,
        formType: "Corrective Action Form",
        formTurn: true,
        policyHeading: null,
      };
    }
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: state.slotReading === "ca" ? "Corrective Action Form" : null,
      formTurn: state.slotReading === "ca",
      policyHeading: null,
    };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        if (request.tool_choice?.name === "record_form_reading") {
          state.readerCalls += 1;
          if (state.stall) return new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timed out")), 3_500));
          if (!state.reading) throw new Error("the reader's model is down");
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", name: "record_form_reading", input: state.reading }],
            usage: { input_tokens: 5200, output_tokens: 380, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          };
        }
        const revising = request.tool_choice?.name === "revise_form_fields";
        if (revising) state.revisionCalls += 1;
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: revising ? "revise_form_fields" : "write_form_fields",
              input: revising ? state.revision : state.draft,
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

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
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
    readDirectoryFacts: async () => [],
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

/** The chat route only accepts a UUID for the open form; the fake numbers rows `fake-N`. */
function toUuid(id: string): string {
  if (/^[0-9a-f-]{36}$/.test(id)) return id;
  const uuid = randomUUID();
  for (const table of ["form_instances", "form_instance_values", "form_instance_events"] as const) {
    for (const row of store[table]) {
      if (row.id === id) row.id = uuid;
      if (row.instance_id === id) row.instance_id = uuid;
    }
  }
  return uuid;
}

const TODAY = "2026-10-26";

/**
 * Ask Sunny's production env, exactly (Vercel production, read 26 Oct 2026
 * 09:44Z, with the coordinator's correction; PROD-FLAGS-2026-10-26-0944Z).
 * Every other flag is off — FORM_FULL_REMAP and REMAP_INCIDENT_FIX among them.
 */
const PRODUCTION = [
  "APP_PASSWORD_HELP_ENABLED",
  "DRAFT_NEVER_BLANK_ENABLED",
  "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED",
  "EXIT_INTAKE_FIX_ENABLED",
  "FOLLOW_UP_NOT_PRIOR_ENABLED",
  "LATE_OPEN_PAYROLL_FROM_FORM_ENABLED",
  "MANUAL_NEGATED_LIST_NOTE_ENABLED",
  "NAME_BEFORE_TITLE_ENABLED",
  "POLICY_SPECIFIC_TOPICS_ENABLED",
  "REOPEN_VERB_GUARD_ENABLED",
  "SENSITIVE_DEFAULTS_REDACT_ENABLED",
  "STATE_CODE_NOT_A_PERSON_ENABLED",
  "ACTION_PLAN_MANAGER_ONLY_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED",
  "CHAT_STYLE_RULES_ENABLED",
  "CHAT_TRACE_ENABLED",
  "CROSS_CHAT_REPLY_GUARD_ENABLED",
  "CURRENT_MANUAL_SCOPE_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "HYBRID_SEARCH_ENABLED",
  "INTENT_EXTRACTION_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "PAYROLL_AMOUNT_FIELD_ENABLED",
  "PLACE_SPAN_GUARD_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "PRINTED_PAGE_CITATION_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
  "PRIOR_COACHING_OPTIONAL_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "RETRIEVAL_RECALL_ENABLED",
  "SELF_CHECK_ENABLED",
  "SEND_AFTER_HYDRATE_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "DRAFT_DEDUPE_ENABLED",
  "SECOND_FORM_ENABLED",
  "STORED_SLOTS_NOT_A_REQUEST_ENABLED",
] as const;
/** Not production here: the full remap and the flags QA-6 ran it with, as extra coverage. */
const REMAP_EXTRA = ["FORM_FULL_REMAP_ENABLED", "REMAP_INCIDENT_FIX_ENABLED"] as const;
const FLAG = "PRIOR_SENTENCE_FIX_ENABLED";
/** FORM_DATE_INCIDENT_ONLY_ENABLED (D3, =0 in production) is pinned by each case, never read from the shell. */
const FIO = "FORM_DATE_INCIDENT_ONLY_ENABLED";
const ALL_FLAGS = [...PRODUCTION, ...REMAP_EXTRA, FLAG, FIO, "CODE_SLOTS_ENABLED", "POLICY_CITATION_ENABLED", "FORM_STATE_ENABLED", "REMAP_DRAFT_SOURCES_ENABLED", "NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED", "INTENT_PAYROLL_MANAGER_ONLY_ENABLED", "CHAT_DATA_TOOLS_ENABLED", "CHAT_MEMORY_ENABLED"];

type Answer = {
  content: string;
  formProposal?: ChatFormProposal;
  formSelection?: unknown;
  formOpened?: { instanceId: string };
  formUpdate?: { instanceId: string; updated: string[] };
};

/** The thread as the browser holds it: a card the answer carried stays open. */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;
  private readonly conversationId = `conv-${randomUUID()}`;

  async say(question: string): Promise<Answer> {
    const history = this.messages.map(({ id, role, content }) => ({ id, role, content }));
    const id = `m${(this.sequence += 1)}`;
    const response = await chatRoute.POST(
      new Request("https://app.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          mode: "standard",
          history,
          questionMessageId: id,
          conversationId: this.conversationId,
          ...(this.proposal && !this.instanceId ? { continueProposalTemplateKey: this.proposal.templateKey } : {}),
          ...(this.instanceId ? { activeFormInstanceId: this.instanceId } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    expect(response.status, JSON.stringify(payload)).toBe(200);
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T12:28:00Z` } as ChatMessage,
      {
        id: `a${this.sequence}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${TODAY}T12:28:01Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formProposal) this.proposal = payload.formProposal;
    return payload;
  }

  /** The card's Create, as the browser does it. */
  async create(): Promise<string> {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({ proposal: this.proposal!, messages: this.messages, call, onCreated: () => {} });
    this.instanceId = toUuid(result.reference.instanceId);
    return this.instanceId;
  }
}


const saved = new Map<string, string | undefined>();
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
beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  state.slotReading = "none";
  state.reading = null;
  state.readerCalls = 0;
  state.remapObservation = null;
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.directory = [
    { id: "e-1", firstName: "Rory", lastName: "Vance", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"] },
  ];
  for (const name of ALL_FLAGS) saved.set(name, process.env[name]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T15:30:00Z`));
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});




const LIVE_SINCE = [
  "PRIOR_SENTENCE_FIX_ENABLED",
  "DATE_ANSWER_APPLIED_ENABLED",
  "PAYROLL_TYPO_NOT_A_NAME_ENABLED",
  "REQUEST_LINE_ACCOUNT_ENABLED",
  "ATTENDANCE_ACTION_PLAN_ENABLED",
  "HIDE_NO_POLICY_MATCH_NOTICE_ENABLED",
  "ANSWER_NOT_A_NAME_ENABLED",
  "POLICY_SPECIFIC_TOPICS_ENABLED",
] as const;

const AI = "AI_READS_CODE_CHECKS_ENABLED";
/**
 * Every flag shipped since the PRODUCTION list above (27 Oct 2026), including the
 * ones merged today and both spend-guard flags: the reader may only ADD to a
 * chat in which all of them are live. (The list is the parity test's, in order,
 * from NOT_DEDUCTIBLE_READ_ENABLED to WIDER_DATE_READER_ENABLED.)
 */
const THIS_WEEK = [
  "NOT_DEDUCTIBLE_READ_ENABLED",
  "PRIOR_STEP_SENTENCE_ENABLED",
  "EXIT_FULFILLED_IS_LAST_DAY_ENABLED",
  "FUTURE_PRIOR_ROW_DROP_ENABLED",
  "NAME_QUESTION_ONLY_ENABLED",
  "ANIMAL_ANYWHERE_ENABLED",
  "MEETING_NOT_LATENESS_PLAN_ENABLED",
  "PLAN_PAYROLL_SENTENCE_ENABLED",
  "JOB_TITLE_NOT_INCIDENT_ENABLED",
  "PRIOR_ROW_NOT_ON_INCIDENT_DATE_ENABLED",
  "PRIVATE_CREATOR_FORMS_ENABLED",
  "JOB_TITLE_FROM_WORDS_ENABLED",
  "CA_ASKS_WHAT_HAPPENED_ENABLED",
  "STEP_DATE_NOT_INCIDENT_ENABLED",
  "WARNING_LEVEL_AND_CLAUSE_ENABLED",
  "JOB_TITLE_APPOSITION_ENABLED",
  "FOLLOW_UP_READBACK_CUE_ENABLED",
  "EXIT_READBACK_JOB_TITLE_ENABLED",
  "FOLLOW_UP_CITATION_FIELD_ENABLED",
  "GRAMMAR_ASK_NOT_ACCOUNT_ENABLED",
  "JOB_TITLE_CASE_ENABLED",
  "LEVEL_STEP_NOT_ACCOUNT_ENABLED",
  "JOB_TITLE_READBACK_CASE_ENABLED",
  "STEP_DATE_NO_QUESTION_ENABLED",
  "FIRST_NAME_ASK_ENABLED",
  "TYPO_READING_COPY_ENABLED",
  "DAY_WORD_TYPOS_ENABLED",
  "AMOUNT_UNKNOWN_ACK_ENABLED",
  "ACCOUNT_ONLY_POLICY_QUERY_ENABLED",
  "RELATIVE_DATE_READER_ENABLED",
  "UNREAD_DATE_ASK_ENABLED",
  "AMOUNT_ANSWER_SAVED_ENABLED",
  "AMOUNT_ANSWER_NOT_ACCOUNT_ENABLED",
  "MODEL_CALL_DAILY_CAP_ENABLED",
  "MONTHLY_BUDGET_GUARD_ENABLED",
  "ORDINAL_DATE_IN_DRAFT_ENABLED",
  "WIDER_DATE_READER_ENABLED",
] as const;

function setLive(reader: boolean) {
  for (const name of [...ALL_FLAGS, ...LIVE_SINCE, ...THIS_WEEK, AI]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE_SINCE, ...THIS_WEEK]) process.env[name] = "true";
  delete process.env.ACTION_PLAN_MANAGER_ONLY_ENABLED;
  if (reader) process.env[AI] = "true";
  state.directory = [
    { id: "e-1", firstName: "Quinn", lastName: "Marlowe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0462"] },
  ];
}

const field = (value: string | null, evidence: string | null) => ({ value, evidence });
/** What a faithful reader returns for the testers' first turn (the manager's own words, copied). */
const reading = (extra: Record<string, unknown> = {}) => ({
  employee: field("quinn marlowe", "quinn marlowe"),
  location: field("kearney", "kearney"),
  incident: field("late", "she was late"),
  ...extra,
});

interface Outcome {
  readonly answers: string[];
  readonly card: string;
  readonly formDate: unknown;
  readonly observation: string;
  readonly values: Record<string, unknown>;
}

async function chat(turns: string[], written: string | null, readerOn: boolean, read: Record<string, unknown> | null): Promise<Outcome & { readerCalls: number }> {
  setLive(readerOn);
  state.slotReading = "ca";
  state.reading = read;
  state.readerCalls = 0;
  const thread = new Thread();
  const answers: string[] = [];
  for (const turn of turns) answers.push((await thread.say(turn)).content);
  state.draft = { values: { observation: `Observed:\nQuinn arrived late for the scheduled shift on ${written ?? "the scheduled day"}.\n\nExpectation:\nQuinn is expected to arrive on time.` } };
  const card = JSON.stringify(thread.proposal ? { ...thread.proposal, proposalId: undefined } : null);
  const id = await thread.create();
  const rows = store.form_instance_values.filter((row) => row.instance_id === id);
  const values = Object.fromEntries(rows.map((row) => [String(row.field_key), row.value]));
  return { answers, card, formDate: values.form_date, observation: String(values.observation ?? ""), values, readerCalls: state.readerCalls };
}

async function fresh() {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  await ensureTemplateLibrary("system");
}

/** The same turns, reader off and on. */
async function bothWays(turns: string[], written: string | null, read: Record<string, unknown> | null) {
  const off = await chat(turns, written, false, read);
  await fresh();
  const on = await chat(turns, written, true, read);
  return { off, on };
}

/** Off and on end on the same chat, card and form (the reader added nothing, changed nothing). */
function expectIdentical(off: Outcome, on: Outcome) {
  expect(on.answers).toEqual(off.answers);
  expect(on.card).toBe(off.card);
  expect(on.values).toEqual(off.values);
}

const NAME = "create a CA form for quinn marlowe at kearney";

describe("live flags on, reader off and on: this week's tester chats", () => {
  it("(a) 'she was late on the 2nd', 'yes payroll deduct', '$25' then Create", async () => {
    const turns = [`${NAME}. she was late on the 2nd`, "yes payroll deduct", "$25"];
    const { off, on } = await bothWays(turns, "December 2, 2025", reading({ incidentDate: field("2026-10-02", "the 2nd") }));
    expect(off.formDate).toBe("2026-10-02");
    expect(off.observation).toContain("October 2, 2026");
    expect(JSON.stringify(off.values)).toContain("25");
    expect(on.readerCalls).toBeGreaterThan(0);
    expectIdentical(off, on);
  });

  it("(b) 'i dont know the amount': the reader does not touch the amount or add text", async () => {
    const turns = [`${NAME}. she was late on the 2nd`, "yes payroll deduct", "i dont know the amount"];
    // The reader tries to read an amount out of the manager's "i dont know the amount".
    const { off, on } = await bothWays(turns, "October 2, 2026", reading({ payrollAmount: field("25", "i dont know the amount"), payroll: field("yes", "yes payroll deduct") }));
    expect(on.readerCalls).toBeGreaterThan(0);
    expectIdentical(off, on);
    expect(JSON.stringify(on.values)).not.toContain('"25"');
    expect(on.observation).toBe(off.observation);
  });

  it("(c) 'she was late yesturday': the day-word fix wins, the reader sets no other date", async () => {
    const turns = [`${NAME}. she was late yesturday`];
    const faithful = await bothWays(turns, "October 25, 2026", reading({ incidentDate: field("2026-10-25", "yesturday") }));
    expect(faithful.off.formDate).toBe("2026-10-25");
    expect(faithful.on.readerCalls).toBeGreaterThan(0);
    expectIdentical(faithful.off, faithful.on);
    await fresh();
    const wrong = await bothWays(turns, "October 25, 2026", reading({ incidentDate: field("2026-10-24", "yesturday") }));
    expect(wrong.on.formDate).toBe("2026-10-25");
    expectIdentical(wrong.off, wrong.on);
  });

  it("(d) 'yes payroll dedcut' (typo) is still the payroll answer", async () => {
    const turns = [`${NAME}. she was late on the 2nd`, "yes payroll dedcut"];
    const { off, on } = await bothWays(turns, "October 2, 2026", reading({ payroll: field("no", "yes payroll dedcut") }));
    expect(on.readerCalls).toBeGreaterThan(0);
    expectIdentical(off, on);
  });

  it("(e) invented details: the model's 'opened' stays out of the narrative the same way with the reader on", async () => {
    const turns = [`${NAME}. she was late on the 2nd`];
    const invented = "October 2, 2026, and the salon was opened late";
    const { off, on } = await bothWays(turns, invented, reading({ incident: field("opened late", "she was late") }));
    expect(on.readerCalls).toBeGreaterThan(0);
    expectIdentical(off, on);
    // The model's invented "opened" is not in the saved narrative, reader off or on.
    expect(off.observation.toLowerCase()).not.toContain("open");
    expect(on.observation.toLowerCase()).not.toContain("open");
  });

  it("(f) a reader field that disagrees with a rule: the rule wins", async () => {
    const turns = [`${NAME}. she was late on the 2nd`, "yes payroll deduct", "$25"];
    const { off, on } = await bothWays(
      turns,
      "October 2, 2026",
      reading({ incidentDate: field("2026-10-03", "the 2nd"), payrollAmount: field("20", "$25"), warningLevel: field("written", "late"), location: field("lincoln", "kearney") }),
    );
    expect(off.formDate).toBe("2026-10-02");
    expect(on.formDate).toBe("2026-10-02");
    expect(on.readerCalls).toBeGreaterThan(0);
    expectIdentical(off, on);
  });

  it("(g) the reader's model down: the same chat as reader off", async () => {
    const turns = [`${NAME}. she was late on the 2nd`, "yes payroll deduct", "$25"];
    const { off, on } = await bothWays(turns, "December 2, 2025", null);
    expect(on.readerCalls).toBeGreaterThan(0);
    expectIdentical(off, on);
  });

  it("(g) the reader timing out: the same chat as reader off", async () => {
    const turns = [`${NAME}. she was late on the 2nd`, "yes payroll deduct", "$25"];
    const off = await chat(turns, "December 2, 2025", false, null);
    await fresh();
    state.stall = true;
    try {
      const on = await chat(turns, "December 2, 2025", true, reading());
      expect(on.readerCalls).toBeGreaterThan(0);
      expectIdentical(off, on);
    } finally {
      state.stall = false;
    }
  }, 30_000);

  it("where the reader fills a field the rules left open, that is the only difference", async () => {
    // "Marlowe, Quinn": today's reader keeps "Marlowe"; the reader fills the employee.
    const turns = ["My employee Marlowe, Quinn was late on the 2nd at Kearney. Please create a CA form"];
    const { off, on } = await bothWays(turns, "October 2, 2026", reading({ employee: field("Marlowe, Quinn", "Marlowe, Quinn"), incidentDate: field("2026-10-02", "the 2nd") }));
    expect(on.formDate).toBe(off.formDate);
    expect(on.values.employee_name).toBe("Quinn Marlowe");
  });
});
