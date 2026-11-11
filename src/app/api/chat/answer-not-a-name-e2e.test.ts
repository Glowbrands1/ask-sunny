import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * MANAGER, 26 OCT 2026 — AN ANSWER TO THE APP'S QUESTION IS NOT AN EMPLOYEE
 * ============================================================================
 *
 * Live in this app, a manager's chat word for word, the names invented:
 *
 *   "i need to issue a ca for someone being late"
 *   "rory vance was late on 10/20 and the salon was opened late"
 *   "she was issued a verbal ca on 10.1 for this same thing"
 *   "yes payrol ldeduct"
 *   "i dont know the amount"
 *   "kearney"
 *
 * The name reader in `proposal.ts` read "payrol ldeduct" as a person, so the
 * card's sources restarted at turn 4 and the account before it never reached
 * the draft; the drafting model returned nothing and the draft was blank. The
 * same shape with "most recent" answering the date question after a turn in
 * between (see `date-answer-applied-e2e.test.ts`): the earlier turns drop.
 *
 * ANSWER_NOT_A_NAME_ENABLED (default off, same flag in both apps): a payroll
 * or date answer is not a name, so the sources keep every turn. Through POST
 * /api/chat, `createInlineForm` and the real draft route, in this app's
 * production env (26 Oct 2026, 21:40Z); lowercase and Sentence case.
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

vi.mock("@/lib/ai/call-claude", () => ({
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




/** Live since this file's base list was read (Vercel production, 26 Oct 2026 21:40Z). */
const LIVE_SINCE = [
  "PRIOR_SENTENCE_FIX_ENABLED",
  "DATE_ANSWER_APPLIED_ENABLED",
  "PAYROLL_TYPO_NOT_A_NAME_ENABLED",
  "REQUEST_LINE_ACCOUNT_ENABLED",
  "ATTENDANCE_ACTION_PLAN_ENABLED",
  "HIDE_NO_POLICY_MATCH_NOTICE_ENABLED",
] as const;
const ANA = "ANSWER_NOT_A_NAME_ENABLED";

function useProduction(on: boolean) {
  for (const name of [...ALL_FLAGS, ...LIVE_SINCE, ANA]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE_SINCE]) process.env[name] = "true";
  if (on) process.env[ANA] = "true";
}

const sentenceCase = (text: string) =>
  text.replace(/^([a-z])/, (letter) => letter.toUpperCase()).replace(/\bi\b/g, "I").replace(/\brory vance\b/g, "Rory Vance");

const PAYROLL_TURNS = [
  "i need to issue a ca for someone being late",
  "rory vance was late on 10/20 and the salon was opened late",
  "she was issued a verbal ca on 10.1 for this same thing",
  "yes payrol ldeduct",
  "i dont know the amount",
  "kearney",
];
const DATE_TURNS = [
  "My employee rory vance has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15",
  "I already told you the employee name. She is at Kearney",
  "most recent",
];
const CASINGS = [
  ["lowercase", (text: string) => text.toLowerCase()],
  ["Sentence case", sentenceCase],
] as const;

async function run(turns: readonly string[]) {
  const thread = new Thread();
  for (const turn of turns) await thread.say(turn);
  const sources = thread.proposal?.sourceMessageIds ?? [];
  // The drafting model writes nothing (production: an empty tool call).
  state.draft = { values: {} };
  let observation: string | null = null;
  let refused: string | null = null;
  try {
    const id = await thread.create();
    observation = String(store.form_instance_values.find((row) => row.instance_id === id && row.field_key === "observation")?.value ?? "");
  } catch (error) {
    refused = (error as Error).message;
  }
  return { sources, observation, refused, employee: thread.proposal?.employeeName ?? null };
}

describe(`${ANA} on: the answer keeps every turn on the card`, () => {
  beforeEach(() => useProduction(true));

  describe.each(CASINGS)("%s", (_casing, cased) => {
    it('"yes payrol ldeduct": sources keep turns 1-6 and the draft holds the account', async () => {
      const { sources, observation, refused, employee } = await run(PAYROLL_TURNS.map(cased));
      expect(refused).toBeNull();
      expect(employee?.toLowerCase()).toBe("rory vance");
      expect(sources).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
      // Not blank. Which sentence the never-blank fallback writes (here the
      // prior verbal CA, cut at "10.1") is a separate finding, reported to QA.
      expect(observation).not.toBe("");
    });

    it('"most recent" after a turn: sources keep turns 1-3 and Create is not refused', async () => {
      const { sources, refused, employee } = await run(DATE_TURNS.map(cased));
      expect(refused).toBeNull();
      expect(employee?.toLowerCase()).toBe("rory vance");
      expect(sources).toEqual(["m1", "m2", "m3"]);
    });
  });
});

describe(`${ANA} off: as main`, () => {
  beforeEach(() => useProduction(false));

  it.each(CASINGS)('%s: "yes payrol ldeduct" restarts the sources, dropping the account', async (_casing, cased) => {
    const { sources } = await run(PAYROLL_TURNS.map(cased));
    expect(sources).not.toContain("m1");
    expect(sources).not.toContain("m2");
  });

  it.each(CASINGS)('%s: "most recent" restarts the sources at turn 3', async (_casing, cased) => {
    const { sources } = await run(DATE_TURNS.map(cased));
    expect(sources[0]).toBe("m3");
  });

  it("the flag reads off by default", async () => {
    const { answerNotANameEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(answerNotANameEnabled()).toBe(false);
  });
});
