import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "COACHING FORM FOR ALL TEAM MEMBERS" — THE SAME ANSWER IN EVERY CHAT
 * ============================================================================
 *
 * Ported from Ask Bubbles: a Location Manager covering two stores, 2 Nov 2026
 * (production, rated 1 star): "earlier bubbles made a coaching form for all
 * team members. Now it is struggling to do that, it says it cannot make a
 * coaching form for all team members, but it just did it for me earlier". Six
 * turns got the same staff-picker refusal, the short store name was asked for
 * again, and a shared "<Store> Account" login was listed as a team member.
 * Pau, 3 Nov: "I need all managers to have it". Her wording, through POST
 * /api/chat with this app's salons and production flags; people and the
 * shared login are invented.
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

/** The fixes in this file, each default off. */
const FIXES = ["WHOLE_TEAM_COACHING_ENABLED", "STAFF_PICKER_REMEMBER_LOCATION_ENABLED", "SHARED_LOGIN_NOT_STAFF_ENABLED", "STAFF_PICKER_NO_REPEAT_ENABLED"] as const;

/** Production, plus the named fixes. */
function production(fixes: readonly (typeof FIXES)[number][] = []) {
  for (const name of [...ALL_FLAGS, ...LIVE, ...FIXES, "INTENT_EXTRACTION_ENABLED", "SLOT_RETENTION_ENABLED", "JOB_TITLE_FROM_WORDS_ENABLED"]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE]) process.env[name] = "true";
  for (const name of [FLAG, "POSITION_ANSWER_GUARD_ENABLED", "PRIOR_STEP_SENTENCE_ENABLED", "DATE_ANSWER_APPLIED_ENABLED", "DATE_ANSWER_KEEPS_OPEN_ENABLED", "NAME_QUESTION_ONLY_ENABLED"]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    process.env[name] = "true";
  }
  for (const name of fixes) process.env[name] = "true";
}

/** A Salon Director whose scope is one salon and also covers the other. */
const HER_SCOPE = { level: "salon", primaryAreaId: "loc-0307", alsoCoversAreaIds: ["loc-0309"] };
const ONE_SALON = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };

/** The Kearney staff (invented), with the salon's shared login as the directory would hold it. */
function kearney() {
  state.directory = [
    { id: "e-1", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
    { id: "e-2", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
    { id: "e-3", firstName: "Juno", lastName: "Paxton", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Assistant Salon Director" },
    { id: "e-4", firstName: "Kearney", lastName: "Account", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
    { id: "e-5", firstName: "Tobin", lastName: "Areli", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307"], positionName: "Tanning Consultant" },
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

const REFUSAL = /won't make one card for the whole staff/;
const WHICH = "Which salon's staff should I list?";
const TEAM = { templateKey: "coaching", subject: "team", employeeName: "All team members" };

async function her(thread: Thread, turns: readonly string[]) {
  let reply: Answer | null = null;
  for (const turn of turns) reply = await thread.say(turn);
  return reply!;
}

describe("her six turns, with this app's production flags", () => {
  const TURNS = [
    "coaching form for all team members",
    "make a coaching form for all team members",
    "kearney",
    "make a coaching form for all team members at kearney",
    "earlier you made a caoching form for all team members for me",
    "kearney",
  ];

  it("today (fixes off): refused, the salon asked again, and a card for somebody she never named", async () => {
    production();
    kearney();
    setRole("salon_director");
    setScope(HER_SCOPE);
    const thread = new Thread();
    const replies: Answer[] = [];
    for (const turn of TURNS) replies.push(await thread.say(turn));
    for (const index of [0, 1, 3, 4]) expect(replies[index]!.content).toMatch(REFUSAL);
    expect(replies[3]!.content).toContain("Kearney Account");
    expect(replies[4]!.content).toContain(WHICH);
    // The last "kearney" made a card for the first person on the list above — nobody she named.
    expect(replies[5]!.formProposal?.employeeName).toBe("Marnie Holloway");
  });

  it("with the fixes: the team card, the salon from \"kearney\", never refused", async () => {
    production([...FIXES]);
    kearney();
    setRole("salon_director");
    setScope(HER_SCOPE);
    const thread = new Thread();
    for (const turn of TURNS) {
      const reply = await thread.say(turn);
      expect(reply.content).not.toMatch(REFUSAL);
    }
    expect(thread.proposal).toMatchObject({ ...TEAM, locationId: "loc-0309", status: "ready" });
  });
});

describe("WHOLE_TEAM_COACHING_ENABLED: the team card for every wording", () => {
  const OPENERS: [string, string[]][] = [
    ["her first turn", ["coaching form for all team members"]],
    ["with the salon in it", ["make a coaching form for all team members at kearney"]],
    ["the 30 Oct wording", ["Create a coaching form.", "for whole staff - associates"]],
    ["another manager's", ["can you create a coaching form for my whole staff?"]],
    ["an answer to who", ["Create a coaching form.", "whole staff"]],
    ["the whole salon", ["Create a coaching form.", "for the whole salon"]],
    ["inside an answer", ["we do not accept $100 bills, this coaching form is for all team members"]],
  ];
  for (const [label, turns] of OPENERS) {
    it(`${label}: ${JSON.stringify(turns.at(-1))} → the team card`, async () => {
      production([...FIXES]);
      kearney();
      setRole("salon_director");
      setScope(HER_SCOPE);
      const thread = new Thread();
      const reply = await her(thread, turns);
      expect(reply.content).not.toMatch(REFUSAL);
      expect(thread.proposal).toMatchObject(TEAM);
      if (thread.proposal!.status !== "ready") await thread.say("kearney");
      expect(thread.proposal).toMatchObject({ ...TEAM, locationId: "loc-0309", status: "ready" });
    });
  }

  it("Create makes one Coaching Form for \"All team members\" at the salon", async () => {
    production([...FIXES]);
    kearney();
    setRole("salon_director");
    setScope(HER_SCOPE);
    const thread = new Thread();
    await her(thread, ["coaching form for all team members", "kearney"]);
    const id = await thread.create();
    expect(store.form_instances.find((entry) => entry.id === id)).toMatchObject({ employee_name: "All team members", location_id: "loc-0309" });
  });

  for (const role of ["salon_director", "assistant_salon_director", "district_manager"]) {
    it(`${role}: the team card`, async () => {
      production([...FIXES]);
      kearney();
      setRole(role);
      setScope(role === "district_manager" ? { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } : ONE_SALON);
      const thread = new Thread();
      const reply = await thread.say("coaching form for all team members");
      expect(reply.content).not.toMatch(REFUSAL);
      expect(thread.proposal).toMatchObject(TEAM);
    });
  }

  it("an employee still gets no card and no staff list", async () => {
    production([...FIXES]);
    kearney();
    setRole("employee");
    setScope(ONE_SALON);
    const reply = await new Thread().say("coaching form for all team members");
    expect(reply.formProposal).toBeUndefined();
    expect(reply.content).not.toContain("Marnie Holloway");
  });

  it("a Corrective Action Form for the whole staff is still one person at a time", async () => {
    production([...FIXES]);
    kearney();
    setRole("salon_director");
    setScope(ONE_SALON);
    const reply = await new Thread().say("a corrective action form for all team members");
    expect(reply.formProposal).toBeUndefined();
    expect(reply.content).toContain("Marnie Holloway");
  });
});

describe("the staff picker for one-person forms", () => {
  it("STAFF_PICKER_REMEMBER_LOCATION_ENABLED: \"kearney\" answers the salon question, and it is not asked again", async () => {
    production(["STAFF_PICKER_REMEMBER_LOCATION_ENABLED"]);
    kearney();
    setRole("salon_director");
    setScope(HER_SCOPE);
    const thread = new Thread();
    expect((await thread.say("make a corrective action form for all team members")).content).toContain(WHICH);
    expect((await thread.say("kearney")).content).toContain("Marnie Holloway");
    expect((await thread.say("make a corrective action form for all team members")).content).not.toContain(WHICH);
  });

  it("off: a bare \"kearney\" does not answer it", async () => {
    production();
    kearney();
    setRole("salon_director");
    setScope(HER_SCOPE);
    const thread = new Thread();
    await thread.say("make a corrective action form for all team members");
    expect((await thread.say("kearney")).content).not.toContain("Marnie Holloway");
  });

  it("SHARED_LOGIN_NOT_STAFF_ENABLED: the salon's shared login is not listed; off, it is", async () => {
    production(["SHARED_LOGIN_NOT_STAFF_ENABLED"]);
    kearney();
    setRole("salon_director");
    setScope(ONE_SALON);
    const on = await new Thread().say("make a corrective action form for all team members");
    expect(on.content).toContain("Marnie Holloway");
    expect(on.content).not.toContain("Kearney Account");
    production();
    expect((await new Thread().say("make a corrective action form for all team members")).content).toContain("Kearney Account");
  });

  it("STAFF_PICKER_NO_REPEAT_ENABLED: after the list, another whole-staff turn says what to do next", async () => {
    production(["STAFF_PICKER_NO_REPEAT_ENABLED", "STAFF_PICKER_REMEMBER_LOCATION_ENABLED"]);
    kearney();
    setRole("salon_director");
    setScope(HER_SCOPE);
    const thread = new Thread();
    await thread.say("make a corrective action form for all team members");
    expect((await thread.say("kearney")).content).toMatch(REFUSAL);
    for (const turn of ["make a corrective action form for all team members at kearney", "earlier you made a corrective action form for all team members for me"]) {
      const reply = await thread.say(turn);
      expect(reply.content).not.toMatch(REFUSAL);
      expect(reply.content).toMatch(/name one person from that list/);
    }
  });
});
