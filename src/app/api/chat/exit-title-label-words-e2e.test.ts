import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE TITLE THE MANAGER TYPED KEEPS ITS LABEL WORDS (TITLE_KEEPS_LABEL_WORDS_ENABLED)
 * ============================================================================
 *
 * QA, from this app's live chat (30 Oct 2026): "create an exit for marnie
 * holloway, assistant salon manager at kearney, ne. last day worked …" gave
 * the exit card Job Title "Assistant Salon". The live slot model read the
 * title right ("assistant salon manager"); the card's label reader stopped
 * at "salon" because "salon" is also a field label. The person and address
 * are invented. Harness from exit-shortcut-terms-e2e.test.ts.
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

const state = vi.hoisted(() => ({
  slotReading: "none" as "none" | "ca" | "copy",
  remapObservation: null as string | null,
  /** What the live slot model read as the title; null as before. */
  slotTitle: null as string | null,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
  /** What the AI reader reads as the employee, as typed: a roster name it fills, or a phrase it is refused. */
  readerName: null as string | null,
  /** The AI reader fails, as live (slots.reader {"fallback":"timeout"}): its reading is not used. */
  readerFails: false,
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

vi.mock("@/lib/ai/call-claude", () => ({
  /*
   * The AI reader (AI_READS_CODE_CHECKS_ENABLED), as the live model reads a
   * lone first name: the name exactly as typed, with its sentence as evidence.
   */
  callClaudeToolTimed: async (input: { messages?: { content?: unknown }[] }) => {
    if (state.readerFails) throw new Error("reader timed out");
    const text = JSON.stringify(input.messages ?? []);
    const manager = (text.split("Manager: ").pop() ?? "").split("\\n")[0]!.replace(/\\"/g, '"').replace(/"\}.*$/, "");
    const name = state.readerName && manager.toLowerCase().includes(state.readerName) ? state.readerName : null;
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
      title: state.slotTitle,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      // As the live slot model reads "create an exit for …".
      formType: /\bexit\b/i.test(JSON.stringify(input.messages ?? [])) ? "Resignation/Exit Form" : state.slotReading === "ca" ? "Corrective Action Form" : null,
      formTurn: state.slotReading === "ca" || /\bexit\b/i.test(JSON.stringify(input.messages ?? [])),
      policyHeading: null,
    };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
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
    // The directory's titles (position_name), from the people in the roster.
    readDirectoryFacts: async () =>
      (state.directory as { id: string; firstName: string; lastName: string; salonIds: string[]; positionName?: string | null }[]).map((row) => ({
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        preferredFirstName: null,
        salonIds: row.salonIds,
        title: row.positionName ?? null,
        primaryLocationName: null,
        primarySalonId: row.salonIds[0] ?? null,
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
  // A "conv_…" id keeps the intake state between turns, as the browser's does; the default keeps none.
  constructor(private readonly conversationId = `conv-${randomUUID()}`) {}

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
  state.readerName = null;
  state.readerFails = false;
  state.remapObservation = null;
  state.slotTitle = null;
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

type Card = ChatFormProposal;
const FLAG_ON = "FIRST_NAME_SUGGEST_ENABLED";
const KEARNEY = "loc-0309";
const person = (id: string, first: string, last: string, salon = KEARNEY) => ({
  id, firstName: first, lastName: last, preferredFirstName: null, employmentStatus: "active", salonIds: [salon],
});
const ROSTERS = {
  one: [person("e-1", "Quinn", "Marlowe"), person("e-3", "Rowan", "Kestrel")],
  two: [person("e-1", "Quinn", "Marlowe"), person("e-2", "Quinn", "Ashby"), person("e-3", "Rowan", "Kestrel")],
  zero: [person("e-3", "Rowan", "Kestrel")],
} as const;

function production(on: boolean, roster: keyof typeof ROSTERS | unknown[], scope?: unknown) {
  for (const name of [...ALL_FLAGS, ...LIVE_SINCE, FLAG_ON]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE_SINCE]) process.env[name] = "true";
  if (on) process.env[FLAG_ON] = "true";
  (state as { scope?: unknown }).scope = scope;
  state.directory = Array.isArray(roster) ? roster : [...ROSTERS[roster]];
}


const FIX = "STALE_NEEDS_ROSTER_PERSON_ENABLED";

function live(fix: boolean, roster: unknown[], readerName: string | null = null) {
  for (const name of [FIX, "AI_READS_CODE_CHECKS_ENABLED"]) if (!saved.has(name)) saved.set(name, process.env[name]);
  production(true, roster);
  process.env.AI_READS_CODE_CHECKS_ENABLED = "true";
  delete process.env[FIX];
  if (fix) process.env[FIX] = "true";
  state.readerName = readerName;
}

// The sibling app's request, in this app's words; the person and address invented.
const WORDS =
  "create an exit for marnie holloway, assistant salon manager at kearney, ne. last day worked 10-26-26. salon items not returned and $25 will be payroll deducted for salon key. immediate voluntary term, no notice given. payroll deduct applies. drop wage and forfeit bonus. not eligible for rehire. marnie's address is 125 Ne Oakfield Lane, kearney, NE. 68847";
const MARNIE = [person("e-21", "Marnie", "Holloway"), person("e-3", "Rowan", "Kestrel")];

async function exitCard(words: string) {
  const thread = new Thread();
  const answer = (await thread.say(words)) as { content: string; formProposal?: Card };
  expect(answer.formProposal?.templateKey, answer.content).toBe("stc-exit");
  return { thread, card: answer.formProposal! };
}


/*
 * This app's production title flags (30 Oct 2026) and what the live slot
 * model read from the request.
 */
const TITLE_FLAGS = ["JOB_TITLE_APPOSITION_ENABLED", "JOB_TITLE_CASE_ENABLED", "AI_READS_CODE_CHECKS_ENABLED"] as const;
const KEEP = "TITLE_KEEPS_LABEL_WORDS_ENABLED";

async function title(words: string, slot: string | null, on: boolean): Promise<string | null | undefined> {
  live(true, MARNIE, "marnie holloway");
  for (const name of [...TITLE_FLAGS, KEEP]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of TITLE_FLAGS) process.env[name] = "true";
  if (on) process.env[KEEP] = "true";
  state.slotTitle = slot;
  const { card } = await exitCard(words);
  return card.employeeRole;
}

describe("the job title keeps a word that is also a field label (TITLE_KEEPS_LABEL_WORDS_ENABLED)", () => {
  it("QA's live request, word for word: Job Title is Assistant Salon Manager", async () => {
    expect(await title(WORDS, "assistant salon manager", true)).toBe("Assistant Salon Manager");
  });

  // Live showed "Assistant Salon"; offline the label reader's cut reads "Assistant". Either way cut short.
  it("off, as live today: the title is cut short", async () => {
    const role = await title(WORDS, "assistant salon manager", false);
    expect(role).toMatch(/^Assistant\b/);
    expect(role).not.toBe("Assistant Salon Manager");
  });

  it("a short request reads the same", async () => {
    const words = "create an exit for marnie holloway, assistant salon manager at kearney, ne. last day worked 10-26-26.";
    expect(await title(words, "assistant salon manager", true)).toBe("Assistant Salon Manager");
  });

  it("a title with no label word is unchanged", async () => {
    const words = "create an exit for marnie holloway, assistant manager at kearney, ne. last day worked 10-26-26.";
    expect(await title(words, "assistant manager", true)).toBe(await title(words, "assistant manager", false));
  });

  it("a slot line that does not end in a job word is not taken whole", async () => {
    const words = "create an exit for marnie holloway at kearney, ne. last day worked 10-26-26.";
    expect(await title(words, "assistant salon kearney", true)).toBe(await title(words, "assistant salon kearney", false));
  });
});

/*
 * SPOKEN_TITLE_WHOLE_ENABLED (QA, this app's live chat conv_mvubbfs32obszty,
 * 30 Oct 2026, with TITLE_KEEPS_LABEL_WORDS_ENABLED on): the same request
 * without the address, for somebody not on the roster, still read back "Job
 * Title: Assistant Salon". The directory's only assistant title is "Assistant
 * Salon Director"; its first two words were matched inside "assistant salon
 * manager". The AI reader timed out on that turn.
 */
const LIVE_30_OCT =
  "create an exit for marnie holloway, assistant salon manager at kearney, ne. last day worked 10-26-26. salon items not returned and $25 will be payroll deducted for salon key. immediate voluntary term, no notice given. payroll deduct applies. drop wage and forfeit bonus. not eligible for rehire.";
const WHOLE = "SPOKEN_TITLE_WHOLE_ENABLED";
const LIVE_TITLE_FLAGS = [
  KEEP,
  "INTENT_EXTRACTION_ENABLED",
  "JOB_TITLE_READBACK_CASE_ENABLED",
  "AI_READS_CODE_CHECKS_ENABLED",
  "EXIT_TERMS_NOT_NAMES_ENABLED",
  "STREET_ADDRESS_NOT_A_NAME_ENABLED",
] as const;
// Somebody else on the roster carries the directory's assistant title; the person in the request is not on it.
const WITH_DIRECTOR = [{ ...person("e-3", "Rowan", "Kestrel"), positionName: "Assistant Salon Director" }];

async function readBack(words: string, on: boolean) {
  live(true, WITH_DIRECTOR);
  for (const name of [...LIVE_TITLE_FLAGS, WHOLE]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of LIVE_TITLE_FLAGS) process.env[name] = "true";
  if (on) process.env[WHOLE] = "true";
  state.readerFails = true;
  state.slotTitle = /assistant salon (\w+)/i.exec(words)?.[0] ?? null;
  const answer = (await new Thread().say(words)) as { content: string; formProposal?: Card };
  expect(answer.formProposal?.templateKey, answer.content).toBe("stc-exit");
  return { role: answer.formProposal?.employeeRole ?? null, line: /\*\*Job Title:\*\* ([^\n]+)/.exec(answer.content)?.[1] ?? null };
}

describe("a directory title's first words are not the title typed (SPOKEN_TITLE_WHOLE_ENABLED)", () => {
  it("QA's live request, word for word: Assistant Salon Manager on the card and in the reply", async () => {
    const { role, line } = await readBack(LIVE_30_OCT, true);
    expect(role?.toLowerCase()).toBe("assistant salon manager");
    expect(line?.toLowerCase()).toBe("assistant salon manager");
  });

  it("off, as live: Assistant Salon", async () => {
    expect(await readBack(LIVE_30_OCT, false)).toEqual({ role: "Assistant Salon", line: "Assistant Salon" });
  });

  it("the directory's own title is still read as before", async () => {
    const words = "create an exit for marnie holloway, assistant salon director at kearney, ne. last day worked 10-26-26.";
    expect(await readBack(words, true)).toEqual(await readBack(words, false));
  });

  it("its first words alone still read as before", async () => {
    const words = "create an exit for marnie holloway, assistant salon at kearney, ne. last day worked 10-26-26.";
    expect(await readBack(words, true)).toEqual(await readBack(words, false));
  });
});


/*
 * TITLE_SPELLED_OUT_ENABLED (Pau, 30 Oct 2026, via QA: "yeah i mean spell it
 * out but app must understand ASD meaning, its a shortcut for assistant salon
 * director"). The shortcut is still read as the title; the card and the reply
 * print it spelled out, the way the directory writes it. The person invented.
 */
const SPELLED = "TITLE_SPELLED_OUT_ENABLED";

async function spelled(words: string, slot: string | null, on: boolean) {
  live(true, MARNIE);
  for (const name of [...LIVE_TITLE_FLAGS, SPELLED]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of LIVE_TITLE_FLAGS) process.env[name] = "true";
  if (on) process.env[SPELLED] = "true";
  state.slotTitle = slot;
  const answer = (await new Thread().say(words)) as { content: string; formProposal?: Card };
  expect(answer.formProposal?.templateKey, answer.content).toBe("stc-exit");
  return { role: answer.formProposal?.employeeRole ?? null, line: /\*\*Job Title:\*\* ([^\n]+)/i.exec(answer.content)?.[1] ?? null };
}

describe("the ASD shortcut prints spelled out (TITLE_SPELLED_OUT_ENABLED)", () => {
  const AFTER = "last day worked 10-26-26.";
  for (const [words, slot] of [
    [`create an exit for marnie holloway, asd at kearney, ne. ${AFTER}`, "asd"],
    [`create an exit for marnie holloway, ASD at kearney, ne. ${AFTER}`, "ASD"],
    [`create an exit for marnie holloway at kearney, ne. she is an asd. ${AFTER}`, "asd"],
    [`create an exit for marnie holloway, assistant salon director at kearney, ne. ${AFTER}`, "assistant salon director"],
  ] as const) {
    it(`"${words}" → Assistant Salon Director on the card and in the reply`, async () => {
      expect(await spelled(words, slot, true)).toEqual({ role: "Assistant Salon Director", line: "Assistant Salon Director" });
    });
  }

  it("a Corrective Action card: \"create a ca for … asd …\" → Assistant Salon Director", async () => {
    live(true, MARNIE);
    for (const name of [...LIVE_TITLE_FLAGS, SPELLED]) {
      if (!saved.has(name)) saved.set(name, process.env[name]);
      delete process.env[name];
    }
    for (const name of [...LIVE_TITLE_FLAGS, SPELLED]) process.env[name] = "true";
    state.slotTitle = "asd";
    const answer = (await new Thread().say("create a ca for marnie holloway, asd at kearney, ne. she was late on 10/20.")) as { content: string; formProposal?: Card };
    expect(answer.formProposal?.employeeRole).toBe("Assistant Salon Director");
    expect(answer.content).toContain("**Job title:** Assistant Salon Director");
  });

  /*
   * The other shortcuts on the title list (Pau, 30 Oct 2026: "the app should
   * understand abbreviations of those"), lower and upper case, plural, and
   * the long forms, each in an exit request.
   */
  const WRITTEN: readonly (readonly [typed: string, full: string, acronym: string])[] = [
    ["asd", "Assistant Salon Director", "ASD"],
    ["ASD", "Assistant Salon Director", "ASD"],
    ["asds", "Assistant Salon Director", "ASD"],
    ["sdit", "Salon Director in Training", "SDIT"],
    ["SDITs", "Salon Director in Training", "SDIT"],
    ["salon director in training", "Salon Director in Training", "SDIT"],
    ["tsd", "Training Salon Director", "TSD"],
    ["TSD", "Training Salon Director", "TSD"],
    ["training salon director", "Training Salon Director", "TSD"],
    ["dmit", "District Manager in Training", "DMIT"],
    ["DMIT", "District Manager in Training", "DMIT"],
    ["district manager in training", "District Manager in Training", "DMIT"],
    ["fttc", "Full-Time Tanning Consultant", "FTTC"],
    ["FTTC", "Full-Time Tanning Consultant", "FTTC"],
    ["full-time tanning consultant", "Full-Time Tanning Consultant", "FTTC"],
    ["full time tanning consultant", "Full-Time Tanning Consultant", "FTTC"],
  ];
  for (const [typed, full, acronym] of WRITTEN) {
    const words = `create an exit for marnie holloway, ${typed} at kearney, ne. ${AFTER}`;
    it(`"${typed}" → ${full}`, async () => {
      expect(await spelled(words, typed, true)).toEqual({ role: full, line: full });
    });
    it(`off: "${typed}" → ${acronym}`, async () => {
      expect((await spelled(words, typed, false)).role).toBe(acronym);
    });
  }

  /* Already printed spelled out: the same with the flag on or off. */
  for (const [typed, full] of [["tc", "Tanning Consultant"], ["sd", "Salon Director"], ["dm", "District Manager"]] as const) {
    it(`"${typed}" stays ${full}`, async () => {
      const words = `create an exit for marnie holloway, ${typed} at kearney, ne. ${AFTER}`;
      const on = await spelled(words, typed, true);
      expect(on.role).toBe(full);
      expect(on).toEqual(await spelled(words, typed, false));
    });
  }

  it("off, as today: ASD", async () => {
    const words = `create an exit for marnie holloway, asd at kearney, ne. ${AFTER}`;
    expect((await spelled(words, "asd", false)).role).toBe("ASD");
  });

  it("a title already spelled out is left as it is", async () => {
    const words = `create an exit for marnie holloway, tanning consultant at kearney, ne. ${AFTER}`;
    expect(await spelled(words, "tanning consultant", true)).toEqual(await spelled(words, "tanning consultant", false));
  });
});
