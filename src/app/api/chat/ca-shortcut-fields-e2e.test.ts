import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * AUDIT, 29 OCT 2026 — A CORRECT CARD IS NEVER REFUSED AT CREATE AS OUT OF DATE
 * ============================================================================
 *
 * Pau, via QA: "i need u to check code again and see if there is anything
 * like that blockers, 'expired' after suggestions, in location, name title or
 * whatever. i dont want that blocker and problem in both sunny and bubbles".
 * Ported from Ask Bubbles' audit (fd0ceb06). Every way a card is reached —
 * the person, the salon, the title, the date, the form, the warning level and
 * payroll, an older card, a reload — went chat → answer → Create through the
 * chat route and POST /api/forms/instances with this app's production flags.
 * Harness from first-name-suggest-e2e.test.ts; people are invented.
 *
 * The full audit (every case, every flag combination) ran once offline. Kept
 * here: the cards it found refused — a preferred name with the surname
 * (PREFERRED_NAME_CARD_CURRENT_ENABLED), "make it a follow up coaching"
 * (SWITCH_KEEPS_NAMED_FORM_ENABLED), the card picked after "a coaching form
 * for A and a CA for B" (SEVERAL_FORMS_STAY_CURRENT_ENABLED; here Sunny asks
 * which form to start with and shows one card at a time) — refused as main
 * with their flags off, a sample of the cases that were never refused, and
 * the real corrections that must stay refused.
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
    const name = /\b(katrin)\b/i.exec(manager)?.[1] ?? null;
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
  if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { status: response.status });
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
  formProposals?: ChatFormProposal[];
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
    if (payload.formProposals?.length) this.cards.push(...payload.formProposals);
    else if (payload.formProposal) this.cards.push(payload.formProposal);
    return payload;
  }

  /** Every card the thread has shown, oldest first. */
  readonly cards: ChatFormProposal[] = [];

  /** The card's Create, as the browser does it. */
  async create(card?: ChatFormProposal): Promise<string> {
    const proposal = card ?? this.proposal;
    expect(proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({ proposal: proposal!, messages: this.messages, call, onCreated: () => {} });
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




/** Live in this app since the production read above. */
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

const FLAG_ON = "FIRST_NAME_SUGGEST_ENABLED";
const KEARNEY = "loc-0309";
const person = (id: string, first: string, last: string, salon = KEARNEY) => ({
  id, firstName: first, lastName: last, preferredFirstName: null as string | null, employmentStatus: "active", salonIds: [salon],
});

/* ========================================================================== *
 * THE AUDIT
 * ========================================================================== */

const PARTIAL = "PARTIAL_NAME_CARD_CURRENT_ENABLED";
const READER = "AI_READS_CODE_CHECKS_ENABLED";
const SWITCH = "FORM_TYPE_SWITCH_ENABLED";
const PREFERRED = "PREFERRED_NAME_CARD_CURRENT_ENABLED";
const NAMED_FORM = "SWITCH_KEEPS_NAMED_FORM_ENABLED";
const SEVERAL = "SEVERAL_FORMS_STAY_CURRENT_ENABLED";
const OWNED = [FLAG_ON, PARTIAL, READER, SWITCH, PREFERRED, NAMED_FORM, SEVERAL];

type Config = { label: string; fns: boolean; partial: boolean; reader: boolean; switch?: boolean; extra?: readonly string[] };
const A: Config = { label: "FNS on, PARTIAL on, reader on", fns: true, partial: true, reader: true };

const CAST = [
  { ...person("e-7", "Katrin", "Dovetail"), preferredFirstName: "Kit" },
  person("e-3", "Rowan", "Kestrel"),
  person("e-4", "Tessaly", "Brone"),
];

function configure(config: Config, roster: unknown[] = CAST) {
  for (const name of [...ALL_FLAGS, ...LIVE_SINCE, ...OWNED]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE_SINCE]) process.env[name] = "true";
  if (config.fns) process.env[FLAG_ON] = "true";
  if (config.partial) process.env[PARTIAL] = "true";
  if (config.reader) process.env[READER] = "true";
  if (config.switch) process.env[SWITCH] = "true";
  for (const name of config.extra ?? []) process.env[name] = "true";
  (state as { scope?: unknown }).scope = undefined;
  state.directory = [...roster];
}

/** A turn, or an answer said only when the last reply asked a question and showed no card. */
type Step = string | { ifAsked: string };
const ASKED = /^(?:Is this for|Did you mean|Do you mean)\b/;


async function talk(thread: Thread, steps: readonly Step[]) {
  let last: Answer = { content: "" };
  const log: string[] = [];
  for (const step of steps) {
    let turn: string;
    if (typeof step === "string") turn = step;
    else if (!last.formProposal?.employeeName && ASKED.test(last.content)) turn = step.ifAsked;
    else continue;
    last = await thread.say(turn);
    const card = last.formProposal;
    log.push(`> ${turn} | ${last.content.split("\n")[0]!.slice(0, 90)}${card ? ` [card ${card.templateKey} ${card.employeeName}]` : ""}`);
  }
  return log;
}


/*
 * CA_SHORTCUT_WORDS_ENABLED (Pau, 29 Oct 2026: "ask code to recognize all
 * form wording please so when manager type shortcuts, it can understand it
 * for both apps"). Each shortcut is added to a Corrective Action request
 * (names invented) and read through the chat to the card.
 */
const { detectTemplateIntent } = await import("@/lib/forms/template-intent");
const SHORTCUTS = "CA_SHORTCUT_WORDS_ENABLED";
const BASE = "create a ca for katrin dovetail. she was late on 10/20.";

async function card(words: string, on: boolean) {
  if (!saved.has(SHORTCUTS)) saved.set(SHORTCUTS, process.env[SHORTCUTS]);
  delete process.env[SHORTCUTS];
  configure({ ...A, extra: on ? [SHORTCUTS] : [] });
  const thread = new Thread();
  await talk(thread, [words]);
  return thread.proposal;
}

describe("the Corrective Action form's payroll shortcuts (CA_SHORTCUT_WORDS_ENABLED)", () => {
  for (const [shortcut, answer] of [
    ["no PD", "no"],
    ["No PD.", "no"],
    ["PD applies", "yes"],
    ["pd yes", "yes"],
    ["PD: no", "no"],
    ["deduct 25", "yes"],
  ] as const) {
    it(`"${shortcut}" → payroll deduct ${answer}`, async () => {
      expect((await card(`${BASE} ${shortcut}`, true))?.payrollDeduct).toBe(answer);
    });
    it(`off: "${shortcut}" answers nothing`, async () => {
      expect((await card(`${BASE} ${shortcut}`, false))?.payrollDeduct ?? null).toBeNull();
    });
  }

  it('"No PD." is not a person the roster lacks', async () => {
    if (!saved.has(SHORTCUTS)) saved.set(SHORTCUTS, process.env[SHORTCUTS]);
    configure({ ...A, extra: [SHORTCUTS] });
    const answer = await new Thread().say(`${BASE} No PD.`);
    expect(answer.content).not.toMatch(/couldn't find \*\*PD\*\*/);
  });

  /* Not the deduction. */
  for (const words of ["late 25 min", "she updated the schedule", "she paid for her drink"]) {
    it(`"${words}" answers nothing`, async () => {
      expect((await card(`${BASE} ${words}`, true))?.payrollDeduct ?? null).toBeNull();
    });
  }
});


/*
 * A prior step's date in shorthand ("verbal on 10/1") is not an incident
 * date: it took the card's Date away (10/20 → blank). "a verbal was given on
 * 10/1" was already a step with STEP_DATE_NOT_INCIDENT_ENABLED; the shorthand
 * is CA_SHORTCUT_WORDS_ENABLED.
 */
describe("a prior step's date in shorthand keeps the card's Date (CA_SHORTCUT_WORDS_ENABLED)", () => {
  const STEP_FLAGS = ["STEP_DATE_NOT_INCIDENT_ENABLED", "STEP_DATE_NO_QUESTION_ENABLED"];
  const dated = async (words: string, on: boolean) => {
    for (const name of [SHORTCUTS, ...STEP_FLAGS]) if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[SHORTCUTS];
    configure({ ...A, extra: on ? [SHORTCUTS, ...STEP_FLAGS] : STEP_FLAGS });
    const thread = new Thread();
    await talk(thread, [words]);
    return thread.proposal?.formDate ?? null;
  };

  for (const step of ["verbal on 10/1", "verbal 10/1", "written: 10/5", "Verbal on 10/1"]) {
    it(`"${step}" → the Date stays 10/20`, async () => {
      expect(await dated(`${BASE} ${step}.`, true)).toBe("2026-10-20");
    });
    it(`off: "${step}" takes the Date away`, async () => {
      expect(await dated(`${BASE} ${step}.`, false)).toBeNull();
    });
  }

});


/*
 * The warning level's shorthand (QA, 29 Oct 2026): "1st written" / "first
 * written" is Written. "final warning" is no level the form prints (Verbal or
 * Written only); the level is asked, never left silent. Whether "final
 * written" is Written waits on Pau.
 */
describe("the warning level's shorthand (CA_SHORTCUT_WORDS_ENABLED)", () => {
  const ASKED = "You'll set the verbal/written warning level on the form — I won't guess at it.";
  const reply = async (words: string, on: boolean) => {
    if (!saved.has(SHORTCUTS)) saved.set(SHORTCUTS, process.env[SHORTCUTS]);
    delete process.env[SHORTCUTS];
    configure({ ...A, extra: on ? [SHORTCUTS] : [] });
    const thread = new Thread();
    const answer = await thread.say(words);
    return { content: answer.content, level: thread.proposal?.warningLevel ?? null };
  };

  for (const words of ["1st written", "first written", "First written"]) {
    it(`"${words}" → Written`, async () => {
      expect((await reply(`${BASE} ${words}.`, true)).level).toBe("written");
    });
    it(`off: "${words}" states no level`, async () => {
      expect((await reply(`${BASE} ${words}.`, false)).level).toBeNull();
    });
  }

  it('"final warning": no level, and the level is asked', async () => {
    const { content, level } = await reply(`${BASE} final warning.`, true);
    expect(level).toBeNull();
    // The app's own level question, in either of its wordings.
    expect(content).toMatch(/warning level on the form — I won't guess at it|\*\*Verbal Warning\*\* or a \*\*Written Warning\*\*/);
  });

  it('off: "final warning" leaves the level line out, as reported', async () => {
    expect((await reply(`${BASE} final warning.`, false)).content).not.toContain(ASKED);
  });
});

/*
 * "create a written on 10/20 for katrin dovetail, she was late again" (QA, 29
 * Oct 2026): the level named the form, but nothing read it as a request for
 * the Corrective Action form, so there was no card at all and no Date.
 */
describe("asking to create the level asks for the Corrective Action form (CA_SHORTCUT_WORDS_ENABLED)", () => {
  const ask = async (words: string, on: boolean) => {
    if (!saved.has(SHORTCUTS)) saved.set(SHORTCUTS, process.env[SHORTCUTS]);
    delete process.env[SHORTCUTS];
    configure({ ...A, extra: on ? [SHORTCUTS] : [] });
    const thread = new Thread();
    await thread.say(words);
    return thread.proposal;
  };

  for (const words of ["create a written on 10/20 for katrin dovetail, she was late again", "create a written for katrin dovetail, she was late again on 10/20", "make a verbal for katrin dovetail. she was late on 10/20"]) {
    it(`"${words}" → the Corrective Action card, dated 10/20`, async () => {
      const card = await ask(words, true);
      expect(card?.templateKey).toBe("dpoa");
      expect(card?.employeeName).toBe("Katrin Dovetail");
      expect(card?.formDate).toBe("2026-10-20");
    });
    // Off (and the question below): no card, which in this harness is the policy answer it does not run; read at the form reader.
    it(`off: "${words}" is not read as a form request`, async () => {
      vi.stubEnv(SHORTCUTS, "");
      expect(detectTemplateIntent(words)).not.toEqual({ kind: "explicit", templateKey: "dpoa" });
      vi.unstubAllEnvs();
    });
  }

  it("a question about a written is not a request", () => {
    vi.stubEnv(SHORTCUTS, "true");
    expect(detectTemplateIntent("how do i create a written for someone?")).not.toEqual({ kind: "explicit", templateKey: "dpoa" });
    vi.unstubAllEnvs();
  });
});
