import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bulkProposalId } from "@/lib/forms/coaching-for-everyone";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "CREATE THIS COACHING FORM FOR EVERYONE ON MY TEAM" — ONE DRAFT EACH
 * ============================================================================
 *
 * Ported from Ask Bubbles. Pau, 3 Nov 2026, for a Location Manager who wrote
 * one store-wide coaching: "also having to replicate that coaching verbiage to
 * all coaching forms so she doesn't have to copy paste". Through POST
 * /api/chat with this app's salons and production flags; people invented.
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

// As production builds the role table when the ASD may create forms (NEXT_PUBLIC_, read once at load).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED = "true";
});

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
  toolCalls: 0,
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
      const role = (state as { role?: string }).role ?? "district_manager";
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role,
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
    state.toolCalls += 1;
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
    state.toolCalls += 1;
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
      // Woven's position for each person, as the directory read returns it.
      actual.scopeRoster(state.directory as never, scope).map((person) => ({
        ...person,
        title: (state.directory as { id: string; positionName?: string | null }[]).find((row) => row.id === person.id)?.positionName ?? null,
        primaryLocationName: "Kearney",
      })),
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
const ALL_FLAGS = [...PRODUCTION, ...REMAP_EXTRA, FLAG, FIO, "CODE_SLOTS_ENABLED", "POLICY_CITATION_ENABLED", "FORM_STATE_ENABLED", "REMAP_DRAFT_SOURCES_ENABLED", "NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED", "INTENT_PAYROLL_MANAGER_ONLY_ENABLED", "CHAT_DATA_TOOLS_ENABLED", "CHAT_MEMORY_ENABLED", "EDIT_SEES_SAVED_FORM_ENABLED", "CARD_CHECKED_AGAINST_WORDS_ENABLED"];

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





/** This app's production flags read on 1 Nov 2026, on top of the older production set above. */
const LIVE = [
  "AM_PRIOR_WARNINGS_ENABLED",
  "ANGLE_PLACEHOLDER_GUARD_ENABLED",
  "APIFY_SCHEDULE_ENABLED",
  "APIFY_SYNC_ENABLED",
  "CA_SHORTCUT_WORDS_ENABLED",
  "CHAT_HISTORY_STATE_CHUNKED_ENABLED",
  "CHAT_IMPORT_OWN_ONLY_ENABLED",
  "CORRECTED_EMPLOYEE_SLOT_ENABLED",
  "EXIT_SHORTCUT_WORDS_ENABLED",
  "EXIT_TERMS_NOT_NAMES_ENABLED",
  "FIRST_NAME_SUGGEST_ENABLED",
  "FOLLOWUP_NEW_TOPIC_RETRIEVAL_ENABLED",
  "FORM_EDIT_DATE_RULES_ENABLED",
  "FORM_EDIT_HONEST_REPLY_ENABLED",
  "FORM_EDIT_PLAIN_WORDS_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
  "LEVEL_REQUEST_DATE_ENABLED",
  "MANAGER_NAME_NOT_EMPLOYEE_ENABLED",
  "MANUAL_TOPIC_PIN_ENABLED",
  "NEW_PERSON_REQUEST_ENABLED",
  "NEW_REQUEST_OWN_DATE_ENABLED",
  "OTHER_WRITE_IN_GUARD_ENABLED",
  "OTHER_WRITE_IN_NOT_A_QUESTION_ENABLED",
  "PARTIAL_NAME_CARD_CURRENT_ENABLED",
  "PARTIAL_NAME_LOOSE_MATCH_ENABLED",
  "PARTIAL_SURNAME_ASK_ENABLED",
  "PREFERRED_NAME_CARD_CURRENT_ENABLED",
  "PROMPT_CACHE_ENABLED",
  "REPORT_NAME_NOT_A_PERSON_ENABLED",
  "REQUEST_LEAD_FILLER_ENABLED",
  "REVISION_SAME_VALUE_ENABLED",
  "SAME_FORM_COPY_ENABLED",
  "SEVERAL_FORMS_STAY_CURRENT_ENABLED",
  "SPEND_GUARD_ALL_CALLS_ENABLED",
  "SPOKEN_TITLE_WHOLE_ENABLED",
  "STAFF_PICKER_BARE_ANSWER_ENABLED",
  "STAFF_PICKER_ENABLED",
  "STAFF_PICKER_STORE_TITLES_ENABLED",
  "STALE_NEEDS_ROSTER_PERSON_ENABLED",
  "STREET_ADDRESS_NOT_A_NAME_ENABLED",
  "SUGGEST_ANSWER_REPLACES_TYPED_ENABLED",
  "SWITCH_KEEPS_NAMED_FORM_ENABLED",
  "THIS_PERSONS_TURNS_ENABLED",
  "TITLE_KEEPS_LABEL_WORDS_ENABLED",
  "TITLE_SPELLED_OUT_ENABLED",
  "TRUNCATION_RETRY_ENABLED",
  "UNREAD_DATE_PLAIN_ASK_ENABLED",
  "UNREAD_DAY_NOT_INCIDENT_DATE_ENABLED",
] as const;

const EVERYONE = "COACHING_FOR_EVERYONE_ENABLED";

function production(on: boolean) {
  for (const name of [...ALL_FLAGS, ...LIVE, EVERYONE, "INTENT_EXTRACTION_ENABLED", "SLOT_RETENTION_ENABLED", "JOB_TITLE_FROM_WORDS_ENABLED"]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE]) process.env[name] = "true";
  for (const name of [FLAG, "POSITION_ANSWER_GUARD_ENABLED", "PRIOR_STEP_SENTENCE_ENABLED", "DATE_ANSWER_APPLIED_ENABLED", "DATE_ANSWER_KEEPS_OPEN_ENABLED", "NAME_QUESTION_ONLY_ENABLED"]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    process.env[name] = "true";
  }
  if (on) process.env[EVERYONE] = "true";
}

const STORE = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };

function kearney() {
  state.directory = [
    { id: "e-1", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
    { id: "e-2", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
    { id: "e-3", firstName: "Juno", lastName: "Paxton", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Assistant Salon Director" },
    // Never on the list: a former team member, the district office, another store.
    { id: "e-4", firstName: "Wren", lastName: "Galloway", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
    { id: "e-5", firstName: "Odessa", lastName: "Vance", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Regional Director" },
    { id: "e-6", firstName: "Tobin", lastName: "Areli", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307"], positionName: "Tanning Consultant" },
  ];
}

function setScope(scope: unknown) {
  (state as { scope?: unknown }).scope = scope;
}
function setRole(role: string | undefined) {
  (state as { role?: string }).role = role;
}
afterEach(() => {
  setScope(undefined);
  setRole(undefined);
});

const WORDING = "Remy Calder must check the client's skin type before every session.";
const ASK = "Create this coaching form for everyone on my team";

/**
 * One person's Coaching draft, with its Details, as the source. (The team card
 * is the other source; it can be created here once WHOLE_TEAM_COACHING_ENABLED
 * keeps its label — a separate pull request.) The source person is left out.
 */
async function teamDraft(role = "salon_director"): Promise<Thread> {
  kearney();
  setRole(role);
  setScope(STORE);
  const thread = new Thread();
  await thread.say("Create a coaching form for Remy Calder");
  state.draft = { values: { coaching_details: WORDING } };
  await thread.create();
  return thread;
}

const drafts = () => store.form_instances.filter((row) => row.status === "draft" && row.employee_name !== "Remy Calder");
const details = (id: string) => String(store.form_instance_values.find((row) => row.instance_id === id && row.field_key === "coaching_details")?.value ?? "");

describe("off: nothing of this happens", () => {
  it("the request is not a bulk create", async () => {
    production(false);
    const thread = await teamDraft();
    const reply = await thread.say(ASK);
    expect(reply.content).not.toContain("create all");
    expect(drafts()).toHaveLength(0);
  });
});

describe("COACHING_FOR_EVERYONE_ENABLED", () => {
  for (const ask of [ASK, "for the whole staff, one form each", "replicate that coaching verbiage to all coaching forms"]) {
    it(`${JSON.stringify(ask)}: one confirmation listing the store's people and the count; nothing created yet`, async () => {
      production(true);
      const thread = await teamDraft();
      const reply = await thread.say(ask);
      expect(reply.content).toContain("**2** draft Coaching Forms");
      for (const name of ["Marnie Holloway", "Juno Paxton"]) expect(reply.content).toContain(name);
      for (const name of ["Remy Calder", "Wren Galloway", "Odessa Vance", "Tobin Areli"]) expect(reply.content).not.toContain(name);
      expect(drafts()).toHaveLength(0);
    });
  }

  it("\"create all 2\": one draft each, the same Details with the person's name, no model call, nothing finalized", async () => {
    production(true);
    const thread = await teamDraft();
    await thread.say(ASK);
    const models = { chat: state.chatModelCalls, draft: state.draftCalls, tool: state.toolCalls };
    const reply = await thread.say("create all 2");
    expect(reply.content).toContain("Created **2** draft Coaching Forms");
    expect({ chat: state.chatModelCalls, draft: state.draftCalls, tool: state.toolCalls }).toEqual(models);
    const made = drafts();
    expect(made.map((row) => row.employee_name).sort()).toEqual(["Juno Paxton", "Marnie Holloway"]);
    for (const row of made) {
      expect(row).toMatchObject({ status: "draft", location_id: "loc-0309" });
      // Changed on purpose (QA's #755 gate, 10 Nov 2026): with COACHING_OBSERVED_SAVED_ENABLED on the saved Details start
      // with "Observed:" (the copies keep the first draft's Details); the wording under it is the same.
      const observed = process.env.COACHING_OBSERVED_SAVED_ENABLED === "true" ? "Observed:\n" : "";
      expect(details(String(row.id))).toBe(`${observed}${WORDING.replace("Remy Calder", String(row.employee_name))}`);
    }
    expect(made.find((row) => row.employee_name === "Juno Paxton")?.employee_role).toBe("Assistant Salon Director");
  });

  it("said twice, it makes nothing new (the same drafts)", async () => {
    production(true);
    const thread = await teamDraft();
    await thread.say(ASK);
    await thread.say("create all 2");
    await thread.say(ASK);
    const again = await thread.say("create all 2");
    expect(again.content).toContain("Nothing new was created");
    expect(drafts()).toHaveLength(2);
  });

  it("\"create all except Juno Paxton\" leaves them out; an unknown name creates nothing", async () => {
    production(true);
    let thread = await teamDraft();
    await thread.say(ASK);
    expect((await thread.say("create all except Quillon Brax")).content).toContain("couldn't find **Quillon Brax**");
    expect(drafts()).toHaveLength(0);
    thread = await teamDraft();
    await thread.say(ASK);
    await thread.say("create all except Juno Paxton");
    expect(drafts().map((row) => row.employee_name).sort()).toEqual(["Marnie Holloway"]);
  });

  it("an Assistant Manager may (their own drafts); an employee cannot", async () => {
    production(true);
    const thread = await teamDraft("assistant_salon_director");
    await thread.say(ASK);
    await thread.say("create all 2");
    expect(drafts()).toHaveLength(2);
    for (const row of drafts()) expect(row.created_by).toBe("qa-manager");
  });

  it("a draft whose Details were cleared: asked to write them first", async () => {
    production(true);
    const thread = await teamDraft();
    for (const row of store.form_instance_values) if (row.instance_id === thread.instanceId && row.field_key === "coaching_details") row.value = "";
    expect((await thread.say(ASK)).content).toContain("Write the coaching on this draft first");
  });

  it("above 40 people: nothing created, a clear message", async () => {
    production(true);
    const thread = await teamDraft();
    for (let index = 0; index < 41; index += 1) {
      state.directory.push({ id: `x-${index}`, firstName: `Person${index}`, lastName: "Testwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" });
    }
    const reply = await thread.say(ASK);
    expect(reply.content).toContain("more than 40 at once");
    expect(drafts()).toHaveLength(0);
  });

  it("each draft's id comes from the source and the person", () => {
    expect(bulkProposalId("a", "b")).toBe(bulkProposalId("a", "b"));
    expect(bulkProposalId("a", "b")).not.toBe(bulkProposalId("a", "c"));
  });
});
