import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * AN EXIT REQUEST'S OWN WORDS ARE NOT PEOPLE (ported from Ask Bubbles)
 * ============================================================================
 *
 * A manager's Resignation/Exit card in the sibling app was right in every
 * field, and Create answered "This proposal is out of date: the conversation
 * now names more than one person (<the person>, drop wage, forfeit bonus)".
 * The creation check read lowercase two-word phrases as names. The same
 * request in this app's words (salon, not store; the person and address
 * invented), through the chat route and Create with the production flags.
 * Harness from first-name-suggest-e2e.test.ts.
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
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
  /** What the AI reader reads as the employee, as typed: a roster name it fills, or a phrase it is refused. */
  readerName: null as string | null,
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
      title: null,
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

describe("the exit wording, chat → Create (STALE_NEEDS_ROSTER_PERSON_ENABLED)", () => {
  it("the person on the roster, the reader filling the name: Create makes the form", async () => {
    live(true, MARNIE, "marnie holloway");
    const { thread, card } = await exitCard(WORDS);
    expect(card.employeeName?.toLowerCase()).toBe("marnie holloway");
    await thread.create();
    expect(store.form_instances).toHaveLength(1);
    expect(String(store.form_instances[0]!.employee_name).toLowerCase()).toBe("marnie holloway");
  });

  it("the reader's name refused (it read \"drop wage\"): Create makes the form", async () => {
    live(true, MARNIE, "drop wage");
    const { thread } = await exitCard(WORDS);
    await thread.create();
    expect(store.form_instances).toHaveLength(1);
  });

  it("off: refused — the form's own words read as more people", async () => {
    live(false, MARNIE, "marnie holloway");
    const { thread } = await exitCard(WORDS);
    await expect(thread.create()).rejects.toThrow(/names more than one person \(.*drop wage.*forfeit bonus/);
  });
});

describe("the exit form's shortcut terms are never people", () => {
  for (const phrase of [
    "drop wage",
    "forfeit bonus",
    "drop wage and forfeit bonus",
    "immediate voluntary term",
    "no notice given",
    "not eligible for rehire",
    "salon key not returned",
    "salon items not returned",
    "payroll deduct applies",
  ]) {
    it(`"${phrase}"`, async () => {
      live(true, MARNIE, "marnie holloway");
      const { thread } = await exitCard(`create an exit for marnie holloway, assistant salon manager at kearney, ne. last day worked 10-26-26. ${phrase}.`);
      await thread.create();
      expect(store.form_instances).toHaveLength(1);
    });
  }
});

describe("real staleness is still refused", () => {
  for (const correction of ["actually it's for rowan kestrel", "no, rowan kestrel", "this is for rowan kestrel"]) {
    it(`"${correction}" after the exit card`, async () => {
      live(true, MARNIE, "marnie holloway");
      const { thread } = await exitCard(WORDS);
      const old = thread.proposal!;
      await thread.say(correction);
      thread.proposal = old;
      await expect(thread.create()).rejects.toThrow(/out of date/);
    });
  }
});

/*
 * QA live, 29 Oct 2026 (this app; the person invented): after the exit card,
 * "actually this is for jordan testperson" left the new card on the first
 * person, and so did "actually it's for rowan kestrel" (on the roster) —
 * Create would have filed the exit for the wrong person.
 * CORRECTED_EMPLOYEE_SLOT_ENABLED: the card becomes the person the
 * correction names. With and without the intake state kept between turns.
 */
describe("a correction on the exit card (CORRECTED_EMPLOYEE_SLOT_ENABLED)", () => {
  const FIXED = "CORRECTED_EMPLOYEE_SLOT_ENABLED";
  const corrected = async (on: boolean, stateful: boolean, correction: string) => {
    if (!saved.has(FIXED)) saved.set(FIXED, process.env[FIXED]);
    live(true, MARNIE, "marnie holloway");
    delete process.env[FIXED];
    if (on) process.env[FIXED] = "true";
    const thread = stateful ? new Thread(createId("conv")) : new Thread();
    const first = (await thread.say(WORDS)) as { formProposal?: Card };
    expect(first.formProposal?.employeeName?.toLowerCase()).toBe("marnie holloway");
    // The intake state is kept between turns only for a client chat id.
    expect(((store as unknown as { chat_form_state: unknown[] }).chat_form_state ?? []).length > 0).toBe(stateful);
    const answer = (await thread.say(correction)) as { content: string; formProposal?: Card };
    return { thread, answer };
  };

  for (const stateful of [false, true]) {
    const label = stateful ? "with the intake state" : "without it";
    it(`"actually it's for rowan kestrel" (on the roster) → the card is Rowan Kestrel → Create saves him (${label})`, async () => {
      const { thread, answer } = await corrected(true, stateful, "actually it's for rowan kestrel");
      expect(answer.formProposal?.employeeName).toBe("Rowan Kestrel");
      await thread.create();
      expect(String(store.form_instances.at(-1)!.employee_name)).toBe("Rowan Kestrel");
    });

    it(`"actually this is for jordan testperson" (not on the roster) → the card is that person (${label})`, async () => {
      const { answer } = await corrected(true, stateful, "actually this is for jordan testperson");
      expect(answer.formProposal?.employeeName?.toLowerCase()).toBe("jordan testperson");
    });

    it(`off: the card stays on the first person, as live (${label})`, async () => {
      const { answer } = await corrected(false, stateful, "actually it's for rowan kestrel");
      expect(answer.formProposal?.employeeName?.toLowerCase()).toBe("marnie holloway");
    });
  }
});

/*
 * The sibling app live, 29 Oct 2026 (QA; the manager's words, the person
 * invented and not on the roster): the chat asked "Which of them is this
 * Resignation/Exit Form for — Marnie Holloway, drop wage or forfeit bonus?".
 * EXIT_TERMS_NOT_NAMES_ENABLED: the exit form's own words are never offered
 * as people.
 */
describe("the exit wording, the person not on the roster (EXIT_TERMS_NOT_NAMES_ENABLED)", () => {
  const TERMS = "EXIT_TERMS_NOT_NAMES_ENABLED";
  const unrostered = (on: boolean) => {
    // No roster person for her, as a new hire not yet in Woven.
    live(true, [], "marnie holloway");
    if (!saved.has(TERMS)) saved.set(TERMS, process.env[TERMS]);
    delete process.env[TERMS];
    if (on) process.env[TERMS] = "true";
  };

  // Here the address ("Ne Oakfield Lane") is also offered as a person, with the flag on or off: a separate
  // reading this flag does not change (reported to QA, 29 Oct 2026). This flag takes out the exit form's words.
  it("on: drop wage and forfeit bonus are not offered as people", async () => {
    unrostered(true);
    const answer = (await new Thread().say(WORDS)) as { content: string };
    expect(answer.content).toMatch(/\*\*marnie holloway\*\*/i);
    expect(answer.content).not.toMatch(/\*\*(?:drop wage|forfeit bonus)\*\*/i);
  });

  it("off: as live, the question lists the form's words as people", async () => {
    unrostered(false);
    const answer = (await new Thread().say(WORDS)) as { content: string };
    expect(answer.content).toMatch(/which of them[\s\S]*\*\*drop wage\*\*[\s\S]*\*\*forfeit bonus\*\*/i);
  });

  it("two real people: the reply is the same with the flag on as off", async () => {
    const words = "create an exit for marnie holloway and rowan kestrel";
    unrostered(false);
    const off = ((await new Thread().say(words)) as { content: string }).content;
    unrostered(true);
    const on = ((await new Thread().say(words)) as { content: string }).content;
    expect(on).toBe(off);
  });
});
