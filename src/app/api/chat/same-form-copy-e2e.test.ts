import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "DO THE SAME COACHING FORM FOR <ANOTHER PERSON>" — SAME_FORM_COPY_ENABLED
 * ============================================================================
 *
 * PORTED FROM ASK BUBBLES (QA, 30 Oct 2026: production there, a location
 * manager; same code here). After a Coaching Form for one employee had its
 * Details, "Do the same coaching form for remy calder" gave a blank card, and
 * "can you create the same draft that we did with marnie holloway by changing
 * the name and position?" printed the content in the reply. The managers'
 * request wording, through POST /api/chat and the card's Create; the coaching
 * content is this app's, invented; the models mocked. Names are invented.
 */

const store: FakeStore = {
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

const revisionAsked = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({
  slotReading: "none" as "none" | "ca" | "copy",
  remapObservation: null as string | null,
  /** What the form-reading model returns for this turn (extract_form_fields). */
  reading: {} as Record<string, unknown>,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  draftCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
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
  return {
    ...actual,
    liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
    supabaseReadiness: () => ({ ready: true, missing: [] }),
  };
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
          scope: (state as { scope?: unknown }).scope ?? { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
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
/** What the answering model says this turn, when a case sets it. */
const said = { answer: null as string | null };

vi.mock("@/lib/ai/call-claude", () => ({
  /*
   * The AI reader (AI_READS_CODE_CHECKS_ENABLED), as the live model reads a
   * lone first name: the name exactly as typed, with its sentence as evidence.
   */
  callClaudeToolTimed: async (input: { messages?: { content?: unknown }[] }) => {
    const text = JSON.stringify(input.messages ?? []);
    const manager = (text.split("Manager: ").pop() ?? "").split("\n")[0]!.replace(/\\"/g, '"').replace(/"\}.*$/, "");
    const named = String(state.reading.employeeName ?? "");
    const name = /\b(katrin)\b/i.exec(manager)?.[1] ?? (named && manager.toLowerCase().includes(named.toLowerCase()) ? named : null);
    return {
      input: {
        employee: name ? { value: name, evidence: manager } : null,
        incident: /late/.test(manager) ? { value: "late", evidence: manager } : null,
        incidentDate: /10\/20/.test(manager) ? { value: "2026-10-20", evidence: "10/20" } : null,
      },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  },
  callClaude: async () => {
    state.chatModelCalls += 1;
    return said.answer ?? ANSWER;
  },
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "extract_form_fields") {
      const text = JSON.stringify(input.messages ?? []);
      return {
        templateKey: /follow-?up coaching/i.test(text) ? "follow-up-coaching" : /\b(?:ca|corrective action)\b/i.test(text) ? "dpoa" : null,
        employeeName: null,
        observation: state.remapObservation,
        actionPlan: null,
        ...state.reading,
      };
    }
    if (input.tool?.name !== "record_intent_slots") return null;
    if (state.slotReading === "copy") {
      const text = JSON.stringify(input.messages ?? []);
      // The model reads the whole conversation; the warning level only from an answer to its question.
      const manager = (text.split("Manager:").pop() ?? text).replace(/\n/g, "\n");
      const all = text.split("Manager:").slice(1).map((turn) => turn.split("Assistant:")[0]!).join("\n");
      const dates = all.match(/\b\d{1,2}-\d{1,2}\b/g) ?? [];
      return {
        employee: /quinn marlowe/i.test(all) ? "Quinn Marlowe" : null,
        salon: /kearney/i.test(all) ? "Kearney" : null,
        title: null,
        incidentType: /\blate\b/i.test(all) ? "late" : null,
        incidentDate: dates[0] ?? null,
        payrollAmount: null,
        warningLevel: /^\s*(verbal|written)\W*$/i.exec(manager)?.[1]?.toLowerCase() ?? null,
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
        const revising = request.tool_choice?.name === "revise_form_fields";
        if (!revising) state.draftCalls += 1;
        if (revising) {
          state.revisionCalls += 1;
          revisionAsked.push(JSON.stringify((request as { messages?: unknown }).messages ?? []));
        }
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
    // A seed names the handbook; offline there is none, as a failed lookup.
    async fetchNamedHandbook() {
      return { ok: false, reason: "offline", problem: "not_found" };
    }
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

/** A question that is not a form request searches the manual; nothing to embed offline. */
vi.mock("@/lib/knowledge/recall-match", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge/recall-match")>()),
  matchRecallKnowledge: async () => [],
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
    readDirectoryFacts: async (scope: AccessScope | null) =>
      // No position on record unless the case gives one: the title is the manager's or asked.
      actual.scopeRoster(state.directory as never, scope).map((person) => ({ ...person, title: (person as { positionName?: string | null }).positionName ?? null, primaryLocationName: "Kearney" })),
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

/** This app's production env, as the sibling e2e tests pin it (see `job-title-from-words-e2e.test.ts`). */
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
  formOpened?: { instanceId: string; revisesInstanceId?: string | null };
  formUpdate?: { instanceId: string; updated: string[] };
};

/** The thread as the browser holds it: a card the answer carried stays open. */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;
  // A well-formed client id, so the route keeps the intake state between turns (`isClientConversationId`).
  private readonly conversationId = createId("conv");

  async say(question: string, reading: Record<string, unknown> = {}): Promise<Answer> {
    state.reading = reading;
    const history = this.messages.map(({ id, role, content, formProposal }) => ({ id, role, content, ...(formProposal ? { formProposal } : {}) }));
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
          // As the browser does: the card on screen, or the intake still asking (`continuationFor`).
          ...(!this.instanceId && continuationFor(this.messages) ? { continueProposalTemplateKey: continuationFor(this.messages)!.templateKey } : {}),
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
    if (payload.formOpened) this.instanceId = toUuid(payload.formOpened.instanceId);
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
  state.remapObservation = null;
  state.reading = {};
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.directory = [
    { id: "e-1", firstName: "Quinn", lastName: "Marlowe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
    { id: "e-2", firstName: "Dale", lastName: "Ferris", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
    { id: "e-3", firstName: "Ivy", lastName: "Hollis", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
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





const JT = "JOB_TITLE_FROM_WORDS_ENABLED";

function setProduction(on: boolean) {
  for (const name of [...ALL_FLAGS, JT]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of PRODUCTION) process.env[name] = "true";
  // Live in this app.
  for (const name of [FLAG, "POSITION_ANSWER_GUARD_ENABLED", "PRIOR_STEP_SENTENCE_ENABLED", "DATE_ANSWER_APPLIED_ENABLED", "DATE_ANSWER_KEEPS_OPEN_ENABLED", "NAME_QUESTION_ONLY_ENABLED"]) process.env[name] = "true";
  process.env.REMAP_DRAFT_SOURCES_ENABLED = "true";
  process.env.NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED = "true";
  if (on) process.env[JT] = "true";
}



const COPY = "SAME_FORM_COPY_ENABLED";

const DETAILS =
  "Observed: Marnie Holloway takes the next guest back before the room is reset.\nExpectation: Marnie wipes the bed with the approved cleaner, uses a fresh towel and checks the room before every guest.";

function directory() {
  state.directory = [
    { id: "e-1", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
    { id: "e-2", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
  ];
}

function flags(copy: boolean) {
  setProduction(false);
  if (!saved.has(COPY)) saved.set(COPY, process.env[COPY]);
  delete process.env[COPY];
  if (copy) process.env[COPY] = "true";
  // On in this app's production (#393): "… for <another person>" with a card open is that person's card.
  if (!saved.has("NEW_PERSON_REQUEST_ENABLED")) saved.set("NEW_PERSON_REQUEST_ENABLED", process.env.NEW_PERSON_REQUEST_ENABLED);
  process.env.NEW_PERSON_REQUEST_ENABLED = "true";
}

const detailsOf = (id: string) =>
  store.form_instance_values.find((row) => row.instance_id === id && row.field_key === "coaching_details")?.value;

/** Marnie's coaching form, created from the card and drafted with the Details. */
async function marnieForm(thread: Thread): Promise<string> {
  state.draft = { values: { coaching_details: DETAILS } };
  const card = await thread.say("create a coaching form for Marnie Holloway at Kearney", { templateKey: "coaching", employeeName: "Marnie Holloway" });
  expect(card.formProposal?.templateKey).toBe("coaching");
  const id = await thread.create();
  expect(detailsOf(id)).toContain("approved cleaner");
  return id;
}

/** "Do the same coaching form for remy calder" → the card → Create. */
async function remyForm(thread: Thread): Promise<string> {
  // What the drafting model writes from this conversation: nothing about the process.
  state.draft = { values: { coaching_details: "Observed:\nCoaching for Remy Calder." } };
  thread.instanceId = null;
  const card = await thread.say("Do the same coaching form for remy calder", { templateKey: "coaching", employeeName: "Remy Calder" });
  expect(card.formProposal?.templateKey).toBe("coaching");
  expect(card.formProposal?.employeeName ?? "").toMatch(/remy calder/i);
  state.draftCalls = 0;
  return thread.create();
}

describe('"Do the same coaching form for remy calder"', () => {
  it("off (production today): Remy's card has none of Marnie's details", async () => {
    flags(false);
    directory();
    const thread = new Thread();
    await marnieForm(thread);
    const remy = await remyForm(thread);
    expect(detailsOf(remy)).not.toContain("approved cleaner");
  });

  it("SAME_FORM_COPY: Remy's draft carries Marnie's Details, her name swapped for his, with no model call", async () => {
    flags(true);
    directory();
    const thread = new Thread();
    const marnie = await marnieForm(thread);
    const remy = await remyForm(thread);
    const details = detailsOf(remy) ?? "";
    expect(details).toContain("wipes the bed with the approved cleaner, uses a fresh towel");
    expect(details).toContain("Remy Calder takes the next guest back");
    expect(details).not.toMatch(/marnie|holloway/i);
    expect(state.draftCalls).toBe(0);
    // Who it is for stays Remy's; Marnie's form is untouched.
    expect(store.form_instances.find((row) => row.id === remy)?.employee_name).toMatch(/remy calder/i);
    expect(detailsOf(marnie)).toContain("Marnie Holloway takes the next guest back");
    expect(detailsOf(marnie)).not.toMatch(/remy/i);
  });

  it("SAME_FORM_COPY: another account's form is never the source", async () => {
    flags(true);
    directory();
    const thread = new Thread();
    const marnie = await marnieForm(thread);
    // The same form, but created by somebody else (a shared browser, another manager).
    for (const row of store.form_instances) if (row.id === marnie) row.created_by = "another-manager";
    const remy = await remyForm(thread);
    expect(detailsOf(remy)).not.toContain("approved cleaner");
  });
});

describe('"can you create the same draft that we did with marnie holloway by changing the name and position?" with Remy\'s blank draft open', () => {
  const ASK = "can you create the same draft that we did with marnie holloway by changing the name and position?";

  it("off: Remy's draft is left as it was", async () => {
    flags(false);
    directory();
    const thread = new Thread();
    await marnieForm(thread);
    const remy = await remyForm(thread);
    const reply = await thread.say(ASK);
    expect(reply.formUpdate).toBeUndefined();
    expect(detailsOf(remy)).not.toContain("approved cleaner");
  });

  it("SAME_FORM_COPY: Marnie's content is copied onto Remy's open draft, and the card is told", async () => {
    flags(false);
    directory();
    const thread = new Thread();
    await marnieForm(thread);
    const remy = await remyForm(thread);
    expect(detailsOf(remy)).not.toContain("approved cleaner");
    flags(true);
    // Changed on purpose (review, 31 Oct 2026): Remy's draft already has drafted Details, so it asks before replacing them.
    const asked = await thread.say(ASK);
    expect(asked.formUpdate).toBeUndefined();
    expect(asked.content).toContain("Replace them with **Marnie Holloway**'s Coaching Form content");
    expect(detailsOf(remy)).not.toContain("approved cleaner");
    const reply = await thread.say("yes, replace them");
    expect(reply.formUpdate?.instanceId).toBe(remy);
    expect(reply.formUpdate?.updated).toContain("coaching_details");
    expect(detailsOf(remy)).toContain("Remy Calder takes the next guest back");
    expect(reply.content).toMatch(/copied marnie holloway's coaching form/i);
    expect(state.revisionCalls).toBe(0);
  });

  it("SAME_FORM_COPY: with Marnie's own draft open, nothing is copied onto it", async () => {
    flags(true);
    directory();
    const thread = new Thread();
    const marnie = await marnieForm(thread);
    const reply = await thread.say(ASK);
    expect(reply.formUpdate?.instanceId ?? null).not.toBe(marnie);
    expect(detailsOf(marnie)).toContain("Marnie Holloway takes the next guest back");
    expect(detailsOf(marnie)).not.toMatch(/remy/i);
  });
});

/*
 * LIVE CHECK B2, 31 Oct 2026 (this app's production): in one chat, "Do the
 * same coaching form for remy calder" (card, not created), then "create a
 * coaching form for remy calder" -> Create. That second card cites the earlier
 * turn too, so its notes held "the same" and Marnie's content was copied.
 */
describe('"create a coaching form for remy calder" after an earlier "Do the same coaching form for remy calder"', () => {
  it("SAME_FORM_COPY: a plain request copies nothing — only the card's own request can ask for a copy", async () => {
    // Remy's draft, created with the flag off so nothing is copied at creation.
    flags(false);
    directory();
    const thread = new Thread();
    await marnieForm(thread);
    const remy = await remyForm(thread);
    expect(detailsOf(remy)).not.toContain("approved cleaner");
    flags(true);
    state.draft = { values: { coaching_details: "Observed:\nCoaching for Remy Calder." } };
    // The Create notes the live card sent: the earlier "Do the same …" turn, then this card's own request.
    await call(`/api/forms/instances/${remy}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Do the same coaching form for remy calder\n\ncreate a coaching form for remy calder" }),
    });
    expect(detailsOf(remy)).not.toContain("approved cleaner");
    expect(detailsOf(remy)).toContain("Coaching for Remy Calder.");
  });
});

/*
 * INDEPENDENT REVIEW, 31 Oct 2026: the copy read "same thing", "same one",
 * "same details" anywhere, so the manager's own account of what happened
 * skipped the drafting model and filled the form from another person's.
 */
describe('Create notes ending "She was late again today, same thing as last week"', () => {
  it("SAME_FORM_COPY: drafted from the manager's account, never copied", async () => {
    flags(false);
    directory();
    const thread = new Thread();
    await marnieForm(thread);
    const remy = await remyForm(thread);
    flags(true);
    state.draft = { values: { coaching_details: "Observed:\nRemy was late again today." } };
    state.draftCalls = 0;
    await call(`/api/forms/instances/${remy}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "create a coaching form for remy calder\n\nShe was late again today, same thing as last week" }),
    });
    expect(detailsOf(remy)).not.toContain("approved cleaner");
    expect(detailsOf(remy)).toContain("Remy was late again today.");
    expect(state.draftCalls).toBeGreaterThan(0);
  });
});

/*
 * INDEPENDENT REVIEW, 31 Oct 2026: with Remy's draft open, "Add that she did
 * the same thing as Remy Calder last week" (here: as Marnie Holloway) was read
 * as a copy and overwrote the draft.
 */
describe('"Add that she did the same thing as Marnie Holloway last week" with Remy\'s draft open', () => {
  it("SAME_FORM_COPY: never a copy — the open draft is not overwritten", async () => {
    flags(false);
    directory();
    const thread = new Thread();
    await marnieForm(thread);
    const remy = await remyForm(thread);
    flags(true);
    const reply = await thread.say("Add that she did the same thing as Marnie Holloway last week");
    expect(reply.content).not.toMatch(/copied marnie holloway/i);
    expect(detailsOf(remy)).not.toContain("approved cleaner");
  });
});

afterEach(() => {
  said.answer = null;
});

/*
 * QA, live retest, 31 Oct 2026 (C6, a Salon Director): after "Do the same
 * coaching form for remy calder" with Remy's draft open, "for whole staff"
 * made ANOTHER Coaching Form card for Remy, its Observation of Offense the
 * earlier details sentence. With STAFF_PICKER_BARE_ANSWER_ENABLED a turn that
 * is only the whole staff is the staff list, and Remy's draft is left as it is.
 */
describe('"for whole staff" with Remy\'s draft open (after "Do the same coaching form for remy calder")', () => {
  const BARE = "STAFF_PICKER_BARE_ANSWER_ENABLED";
  async function ask(bare: boolean) {
    flags(true);
    for (const name of ["STAFF_PICKER_ENABLED", BARE]) if (!saved.has(name)) saved.set(name, process.env[name]);
    process.env.STAFF_PICKER_ENABLED = "true";
    delete process.env[BARE];
    if (bare) process.env[BARE] = "true";
    directory();
    const thread = new Thread();
    await marnieForm(thread);
    const remy = await remyForm(thread);
    const before = JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === remy));
    const forms = store.form_instances.length;
    state.reading = { employeeName: "Remy Calder" };
    const reply = await thread.say("for whole staff");
    return { reply, remy, before, forms };
  }

  it("off (production today): another card for one person", async () => {
    const { reply } = await ask(false);
    expect(reply.formProposal?.templateKey).toBe("coaching");
  });

  it("STAFF_PICKER_BARE_ANSWER: no card — one person at a time, the staff to choose from — and Remy's draft untouched", async () => {
    const { reply, remy, before, forms } = await ask(true);
    expect(reply.formProposal).toBeUndefined();
    expect(reply.content).toContain("is for one person at a time, so I won't make one card for the whole staff");
    expect(JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === remy))).toBe(before);
    expect(store.form_instances.length).toBe(forms);
  });

  it("STAFF_PICKER_BARE_ANSWER: an edit that mentions the whole team is still the draft's, never the list", async () => {
    flags(true);
    process.env.STAFF_PICKER_ENABLED = "true";
    process.env[BARE] = "true";
    directory();
    const thread = new Thread();
    await marnieForm(thread);
    await remyForm(thread);
    const reply = await thread.say("update the draft: he told the whole team he was quitting");
    expect(reply.content).not.toContain("I won't make one card for the whole staff");
  });
});

/*
 * QA, live retest, 31 Oct 2026 (a Salon Director, a brand-new chat): "create a
 * coaching form for Marnie Holloway" → Create, NO details given; then "Do the
 * same coaching form for remy calder" gave no Remy card — it copied an EARLIER
 * Remy Calder form of this account onto Marnie's draft ("Copied Remy Calder's
 * Coaching Form content onto Marnie Holloway's draft"). Remy is who the new
 * form is for, never the source.
 */
describe('"create a coaching form for Marnie Holloway" (no details) → "Do the same coaching form for remy calder"', () => {
  async function run() {
    flags(true);
    directory();
    // An earlier chat: Remy's coaching form, with content, on this account.
    const earlier = new Thread();
    await marnieForm(earlier);
    const oldRemy = await remyForm(earlier);
    expect(detailsOf(oldRemy)).toContain("approved cleaner");
    // The brand-new chat.
    const thread = new Thread();
    state.draft = { values: {} };
    const card = await thread.say("create a coaching form for Marnie Holloway", { templateKey: "coaching", employeeName: "Marnie Holloway" });
    expect(card.formProposal?.employeeName).toMatch(/marnie holloway/i);
    const marnie = await thread.create();
    // As live: Marnie's draft has no Details yet (nothing was said about what happened).
    for (const row of store.form_instance_values) if (row.instance_id === marnie) row.value = "";
    const before = JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === marnie));
    const reply = await thread.say("Do the same coaching form for remy calder", { templateKey: "coaching", employeeName: "Remy Calder" });
    return { reply, marnie, before };
  }

  it("SAME_FORM_COPY: Remy's card, and Marnie's draft is not overwritten with the earlier Remy form", async () => {
    const { reply, marnie, before } = await run();
    expect(reply.content).not.toMatch(/copied remy calder/i);
    expect(reply.formUpdate).toBeUndefined();
    expect(JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === marnie))).toBe(before);
    expect(reply.formProposal?.employeeName ?? "").toMatch(/remy calder/i);
  });
});

/*
 * QA, live retest, 31 Oct 2026 (both apps): Marnie's draft had NO details, then
 * Remy's blank draft; "can you create the same draft that we did with marnie
 * holloway by changing the name and position?" found nothing to copy and said
 * nothing — here the turn made another Remy card; in the sibling app the model
 * said no draft had been created for Marnie. Said plainly now, and Remy's
 * draft is left as it is.
 */
describe('"can you create the same draft that we did with marnie holloway by changing the name and position?" when Marnie\'s draft has no details', () => {
  const ASK = "can you create the same draft that we did with marnie holloway by changing the name and position?";
  const valuesOf = (id: string) => JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === id));

  async function emptyMarnieThenRemy() {
    flags(true);
    directory();
    const thread = new Thread();
    state.draft = { values: {} };
    await thread.say("create a coaching form for Marnie Holloway", { templateKey: "coaching", employeeName: "Marnie Holloway" });
    const marnie = await thread.create();
    // As live: nothing was said about what happened, so Marnie's draft has no details.
    for (const row of store.form_instance_values) if (row.instance_id === marnie) row.value = "";
    const remy = await remyForm(thread);
    return { thread, marnie, remy };
  }

  it("SAME_FORM_COPY: says Marnie's draft has no details yet — no copy, no card, both drafts as they were", async () => {
    const { thread, marnie, remy } = await emptyMarnieThenRemy();
    const before = { marnie: valuesOf(marnie), remy: valuesOf(remy) };
    const forms = store.form_instances.length;
    state.reading = {};
    const reply = await thread.say(ASK);
    expect(reply.content).toBe(
      "**Marnie Holloway**'s Coaching Form has no details yet, so there is nothing to copy. **Remy Calder**'s draft is as it was. Tell me what happened and I'll fill it in, or add Marnie's details first and ask again.",
    );
    expect(reply.content).not.toMatch(/no draft was (?:actually )?created/i);
    expect(reply.formProposal).toBeUndefined();
    expect(reply.formUpdate).toBeUndefined();
    expect({ marnie: valuesOf(marnie), remy: valuesOf(remy) }).toEqual(before);
    expect(store.form_instances.length).toBe(forms);
  });

  it("SAME_FORM_COPY: with no form for Marnie at all, the turn is answered as before", async () => {
    flags(true);
    directory();
    const thread = new Thread();
    state.draft = { values: { coaching_details: "Observed:\nCoaching for Remy Calder." } };
    await thread.say("create a coaching form for remy calder", { templateKey: "coaching", employeeName: "Remy Calder" });
    await thread.create();
    state.reading = {};
    const reply = await thread.say(ASK);
    expect(reply.content).not.toContain("has no details yet, so there is nothing to copy");
    expect(reply.formUpdate).toBeUndefined();
  });
});
