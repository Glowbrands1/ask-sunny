import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { continuationFor } from "@/lib/forms/proposal-continuation";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { DateMatrixCase } from "@/test/date-matrix/cases";
import { cardLine, dateQuestionsIn } from "@/test/date-matrix/run";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * DATE_READER_WIDE_ENABLED THROUGH POST /api/chat, WITH PRODUCTION'S FLAGS
 * ============================================================================
 *
 * QA-6 and QA's live date run (26 Oct 2026), invented names: "2 october",
 * "10.2" and "the 2nd" gave no Date row and nothing was asked; two dates were
 * not asked about; an unreadable date vanished; "late on oct. 5" lost its
 * date from the Observation. Each turn goes through the chat route with Ask
 * Sunny's exact production flags (PRODUCTION_FLAGS below) plus
 * DATE_READER_WIDE_ENABLED, in lowercase and Sentence case; a card is created
 * as a draft through the forms routes and its date read back. Every pin fails
 * on main with the flag set (the flag does not exist there) and passes here;
 * "10-2-26", which main already reads, is pinned as NEVER-BREAK.
 */

/**
 * Ask Sunny's production flags: Vercel production read 26 Oct 2026 09:44Z
 * ("Authoritative production flag lists"), with the correction sent after it
 * (FIELD_ACCURACY, SLOT_RETENTION, DRAFT_DEDUPE, SECOND_FORM on) and
 * STORED_SLOTS_NOT_A_REQUEST on. Any flag not listed stays at its default (off).
 */
const PRODUCTION_FLAGS = [
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

/** 0 or not set in production, and the fixes in progress. */
const PRODUCTION_OFF = [
  "FORM_DATE_INCIDENT_ONLY_ENABLED",
  "TERSE_SLOT_READ_ENABLED",
  "FORM_FULL_REMAP_ENABLED",
  "REMAP_INCIDENT_FIX_ENABLED",
  "FORM_TOOLS_ENABLED",
  "CHAT_UPSTREAM_RETRY_ENABLED",
  "MODEL_RETRY_ENABLED",
  "GOOGLE_REVIEWS_IN_CHAT_ENABLED",
  "POLICY_CLEANING_INCIDENT_ENABLED",
  "NEGATED_LATE_SHIFT_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
  "PRIOR_SENTENCE_FIX_ENABLED",
  "LATE_OPEN_DATE_FIX_ENABLED",
  "FORM_EDIT_DATE_RULES_ENABLED",
] as const;

const FLAG = "DATE_READER_WIDE_ENABLED";

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
  /** The intent model's reading for the turn being asked: a copy of the manager's words. */
  raw: {} as Record<string, unknown>,
  forms: new Map<string, unknown>(),
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "salon_director" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: "salon_director",
          // One salon, so every card resolves its salon and a draft can be created.
          scope: { level: "location", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] },
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

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => "A grounded answer.",
  callClaudeTool: async (input: { tool?: { name?: string } }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    if (input.tool?.name !== "record_intent_slots") return null;
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: null,
      formTurn: true,
      policyHeading: null,
      ...state.raw,
    };
  },
}));

/** The drafting model: a one-line account, no date (the exit dates are read by code). */
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => ({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: request.tool_choice?.name === "revise_form_fields" ? "revise_form_fields" : "write_form_fields",
            input: { values: {} },
          },
        ],
      }),
    },
  }),
}));

vi.mock("@/lib/ai/form-state-store", () => ({
  loadFormState: async (userId: string, conversationId: string) => state.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, saved: unknown) => {
    state.forms.set(`${userId}:${conversationId}`, saved);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true,
        documentId: JBA_MANUAL_DOCUMENT.id,
        documentTitle: JBA_MANUAL_DOCUMENT.title,
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: JBA_MANUAL_CHUNKS,
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
vi.mock("@/lib/reviews/overview-block-read", () => ({
  loadReviewsOverviewBlock: async () => ({ status: "ready", totalReviews: 0, averageRating: 0, salonCount: 0 }),
}));
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    readDirectoryFacts: async () => [],
    loadScopedRoster: async () => [],
    withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
  };
});
vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

/* Several hundred cases, each through the route; the first cell of a case runs it. */
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const name of [...PRODUCTION_FLAGS, ...PRODUCTION_OFF, FLAG]) saved.set(name, process.env[name]);
  for (const name of PRODUCTION_FLAGS) process.env[name] = "true";
  for (const name of PRODUCTION_OFF) delete process.env[name];
  // DATE_PINS_FLAG_OFF=1 runs the same pins with the flag off, as main reads them: every pin but NEVER-BREAK fails.
  process.env[FLAG] = process.env.DATE_PINS_FLAG_OFF === "1" ? "" : "true";
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterAll(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

/* ------------------------------------------------------------ the route -- */

function joinOverview(today: string) {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? today,
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
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

type Answer = { content: string; formProposal?: ChatFormProposal; formOpened?: { instanceId: string } };

/** The names the matrix uses, as the intent model copies them: as typed. */
const NAMES = /\b(rowan pell|rory vance|odalys merriweather|test employee)\b/i;

/** A faithful copy of the manager's words: who, which form, which level. No date. */
function copiesTheManager(said: string): Record<string, unknown> {
  return {
    employee: NAMES.exec(said)?.[1] ?? null,
    formType: /\bexit\b/i.test(said)
      ? "Resignation/Exit Form"
      : /coaching form/i.test(said)
        ? "Coaching Form"
        : /\b(?:ca|corrective action|verbal|written)\b/i.test(said)
          ? "Corrective Action Form"
          : null,
    warningLevel: /\bwritten\b/i.test(said) && !/written warning (?:on|\d)/i.test(said) ? "written" : /\bverbal\b(?! warning)/i.test(said) ? "verbal" : null,
  };
}

let threads = 0;

async function converse(testCase: DateMatrixCase) {
  const today = testCase.today;
  const messages: ChatMessage[] = [];
  const conversationId = `conv_dm${(threads += 1).toString(36).padStart(5, "0")}`;
  let proposal: ChatFormProposal | null = null;
  let instanceId: string | null = null;
  const replies: Answer[] = [];
  for (const [index, question] of testCase.turns.entries()) {
    state.raw = copiesTheManager(testCase.turns.slice(0, index + 1).join("\n"));
    const continuation = instanceId ? null : continuationFor(messages);
    const id = `m${index + 1}`;
    const response = await chatRoute.POST(
      new Request("https://app.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          mode: "standard",
          history: messages.map(({ id: messageId, role, content, formProposal }) => ({
            id: messageId,
            role,
            content,
            ...(formProposal ? { formProposal } : {}),
          })),
          questionMessageId: id,
          conversationId,
          ...(continuation ? { continueProposalTemplateKey: continuation.templateKey } : {}),
          ...(instanceId ? { activeFormInstanceId: instanceId } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    if (response.status !== 200) throw new Error(`POST /api/chat ${response.status}: ${JSON.stringify(payload)}`);
    replies.push(payload);
    messages.push(
      { id, role: "user", content: question, createdAt: `${today}T15:00:00Z` } as ChatMessage,
      {
        id: `a${index + 1}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${today}T15:00:01Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formProposal) proposal = payload.formProposal;
    if (payload.formOpened) instanceId = toUuid(payload.formOpened.instanceId);
  }
  return { replies, messages, proposal };
}

async function call<T>(url: string, init: RequestInit | undefined, today: string): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  joinOverview(today);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}



const TODAY = "2026-10-26";

/** Lowercase, and Sentence case (the first letter of each sentence). */
const casings = (text: string) => [
  text.toLowerCase(),
  text.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_all, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`),
];

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.forms.clear();
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  await ensureTemplateLibrary("system");
});

const asCase = (turns: string[]) =>
  ({ id: "pin", baseId: "pin", casing: "lower", form: "ca", role: "incident", today: TODAY, formats: [], turns, expect: {} }) as unknown as DateMatrixCase;

/** The created draft's form date, read back from the instance. */
async function draftDate(proposal: ChatFormProposal, messages: ChatMessage[]): Promise<string | null> {
  const result = await createInlineForm({ proposal, messages, call: (url, init) => call(url, init, TODAY), onCreated: () => {} });
  const id = toUuid(result.reference.instanceId);
  const row = (store.form_instances ?? []).find((entry) => entry.id === id);
  return (row?.form_date as string | undefined) ?? null;
}

const transcript = (replies: readonly { content: string }[]) => replies.map((reply) => reply.content).join("\n\n");
const questions = (replies: readonly { content: string }[]) => replies.flatMap((reply) => dateQuestionsIn(reply.content));

describe("DATE_READER_WIDE_ENABLED: the date is on the card and on the created draft", () => {
  for (const [typed, iso] of [
    ["2 october", "2026-10-02"],
    ["10.2", "2026-10-02"],
    ["the 2nd", "2026-10-02"],
  ] as const) {
    for (const said of casings(`ca for Rowan Pell, she was late on ${typed}. verbal, no payroll`)) {
      it(`"${said}" is dated ${iso}`, async () => {
        const { replies, messages, proposal } = await converse(asCase([said]));
        expect(proposal, transcript(replies)).not.toBeNull();
        expect(proposal!.formDate, transcript(replies)).toBe(iso);
        expect(questions(replies), transcript(replies)).toEqual([]);
        expect(await draftDate(proposal!, messages)).toBe(iso);
      });
    }
  }

  for (const said of casings("ca for Rowan Pell, she was late on 10-2-26. verbal, no payroll")) {
    it(`NEVER-BREAK: "${said}" is dated 2026-10-02, as on main`, async () => {
      const { replies, messages, proposal } = await converse(asCase([said]));
      expect(proposal?.formDate, transcript(replies)).toBe("2026-10-02");
      expect(await draftDate(proposal!, messages)).toBe("2026-10-02");
    });
  }
});

describe("DATE_READER_WIDE_ENABLED: a date is never dropped silently", () => {
  for (const said of casings("ca for Rowan Pell, she was late on 2 october and 10.5. verbal, no payroll")) {
    it(`two dates ask once: "${said}"`, async () => {
      const { replies } = await converse(asCase([said]));
      expect(questions(replies), transcript(replies)).toHaveLength(1);
    });
  }

  for (const said of casings("ca for Rowan Pell, she was late on 13/45. verbal, no payroll")) {
    it(`an unreadable date asks once: "${said}"`, async () => {
      const { replies } = await converse(asCase([said]));
      expect(questions(replies), transcript(replies)).toHaveLength(1);
      expect(transcript(replies)).toContain('I couldn\'t read the date "13/45" — which date did you mean?');
    });
  }

  for (const said of casings("ca for Rowan Pell. she left the front desk unattended on oct. 5 and again on 10.9.26. verbal, no payroll")) {
    it(`the Observation keeps every date: "${said}"`, async () => {
      const { replies } = await converse(asCase([said]));
      const card = [...replies].reverse().find((reply) => reply.formProposal) ?? replies[replies.length - 1]!;
      const observation = cardLine(card.content, "Observation of Offense") ?? "";
      expect(observation, card.content).toMatch(/oct\. 5/i);
      expect(observation, card.content).toMatch(/10\.9\.26/);
    });
  }
});
