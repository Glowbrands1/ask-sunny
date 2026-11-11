import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { continuationFor } from "@/lib/forms/proposal-continuation";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * LIVE, 26 OCT 2026 (#309 DEPLOYED): A BARE "YES", "NO" OR "$25" WAS STORED AS
 * PAYROLL DEDUCT ON AN EXIT FORM, AND "NO PAYROLL DEDUCT" FLIPPED TO YES
 * ============================================================================
 *
 * Sunny production, main 9c6d05bc, LATE_OPEN_PAYROLL_FROM_FORM_ENABLED on:
 * "create an exit form for <name> at kearney, she resigned, last day 10-24"
 * then "yes" printed "Payroll deduction is applicable." on the exit form, "no"
 * stored No and "$25" stored Yes (conv_mvp27adt766w7y and five more); a CA
 * with "no payroll deduct" flipped to Yes on a later bare "yes"
 * (conv_mvp28t3dyoeqwi, conv_mvp290uuh7a91l). The stand-in tests had dropped
 * the production bundle: WARNING_LEVEL_MANAGER_ONLY_ENABLED's
 * `payrollAnsweredNow` stored a bare reply on every form, taking the exit
 * card's "Payroll Deduction" box for the question, and an amount alone made
 * payroll deduct Yes.
 *
 * Every turn goes through POST /api/chat with Sunny's production env as read
 * on Vercel (09:44Z), INTENT_PAYROLL_MANAGER_ONLY both unset and set, and the
 * draft through the create and draft routes. The intent stand-in types the
 * payroll amount from the manager's words, as the real model does. Names are
 * synthetic.
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
  role: "district_manager",
  /** The intent model's reading for the turn being asked. Production's readings were not recorded. */
  raw: {} as Record<string, unknown>,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, state.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: state.role,
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

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => "A grounded answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: unknown }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    if (input.tool?.name !== "record_intent_slots") return null;
    /* The real model copies a stated amount ("$25") into payrollAmount. */
    const manager = (JSON.stringify(input.messages ?? "").split("Manager:").pop() ?? "").replace(/\\n/g, "\n");
    const amount = /\$\s*(\d+(?:\.\d{2})?)/.exec(manager)?.[1] ?? null;
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: amount,
      warningLevel: null,
      formType: null,
      formTurn: true,
      policyHeading: null,
      ...state.raw,
    };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        const revising = request.tool_choice?.name === "revise_form_fields";
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
const PEOPLE = vi.hoisted(() => [
  {
    id: "jordan-hale",
    firstName: "Jordan",
    lastName: "Hale",
    preferredFirstName: null,
    salonIds: ["loc-0462"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0462",
    primaryLocationName: "KS Manhattan",
  },
]);
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    readDirectoryFacts: async () => PEOPLE,
    loadScopedRoster: async () => PEOPLE,
    withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
  };
});
vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

/* Each case loads the template library and runs several routes; a shared machine needs more than 5s. */
vi.setConfig({ hookTimeout: 30_000, testTimeout: 60_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

/**
 * Sunny production, exactly as read on Vercel at 09:44Z, 26 Oct 2026, with
 * the coordinator's correction (FIELD_ACCURACY, SLOT_RETENTION, DRAFT_DEDUPE
 * and SECOND_FORM are on too): these on, every other *_ENABLED flag off.
 * LATE_OPEN_PAYROLL_FROM_FORM_ENABLED (on in production) is `FLAG`.
 */
const SUNNY_PROD = [
  "FIELD_ACCURACY_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "DRAFT_DEDUPE_ENABLED",
  "SECOND_FORM_ENABLED",
  "APP_PASSWORD_HELP_ENABLED",
  "DRAFT_NEVER_BLANK_ENABLED",
  "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED",
  "EXIT_INTAKE_FIX_ENABLED",
  "FOLLOW_UP_NOT_PRIOR_ENABLED",
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
] as const;
const FLAG = "LATE_OPEN_PAYROLL_FROM_FORM_ENABLED";

/** The drafting model's fields for the earlier form on file (S21). */
const LATE_OPENING_MODEL = {
  values: {
    observation:
      "Observed:\nTest was scheduled to open at 8:30am on October 17, 2026 and did not arrive until 11:06, so the salon opened late.\n\nExpectation:\nAn employee assigned to open is expected to open on time.\n\nGoing Forward:\nTest should arrive in time to open.",
  },
  checked: { offense_type: ["tardiness"] },
};
const TODAY = "2026-10-25";

const saved = new Map<string, string | undefined>();

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? TODAY,
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
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
  const others = Object.keys(process.env).filter((name) => name.endsWith("_ENABLED"));
  for (const name of new Set([...SUNNY_PROD, ...others, FLAG, "INTENT_PAYROLL_MANAGER_ONLY_ENABLED"])) saved.set(name, process.env[name]);
  for (const name of others) delete process.env[name];
  for (const name of SUNNY_PROD) process.env[name] = "true";
  process.env[FLAG] = "true";
  state.role = "district_manager";
  state.raw = {};
  state.draft = LATE_OPENING_MODEL;
  state.revision = { values: {} };
  state.forms.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  joinOverview();
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
      if (row.revises_instance_id === id) row.revises_instance_id = uuid;
    }
  }
  return uuid;
}

type Answer = {
  content: string;
  formProposal?: ChatFormProposal;
  formOpened?: { instanceId: string; templateName: string; revisesInstanceId: string | null };
  formUpdate?: { instanceId: string; updated: string[] };
};

let threads = 0;

/** The thread as the browser holds it: history, the card's continuation, and the open form. */
class Thread {
  readonly messages: ChatMessage[] = [];
  readonly conversationId = `conv_${Date.now().toString(36)}${(threads += 1).toString(36).padStart(4, "0")}`;
  instanceId: string | null = null;
  private sequence = 0;

  async say(question: string, raw: Record<string, unknown> = {}): Promise<Answer> {
    state.raw = raw;
    const history = this.messages.map(({ id, role, content, formProposal }) => ({
      id,
      role,
      content,
      ...(formProposal ? { formProposal } : {}),
    }));
    const continuation = this.instanceId ? null : continuationFor(this.messages);
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
          ...(continuation ? { continueProposalTemplateKey: continuation.templateKey } : {}),
          ...(this.instanceId ? { activeFormInstanceId: this.instanceId } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    expect(response.status, JSON.stringify(payload)).toBe(200);
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T15:00:00Z` } as ChatMessage,
      {
        id: `a${this.sequence}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${TODAY}T15:00:01Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formOpened) {
      payload.formOpened.instanceId = toUuid(payload.formOpened.instanceId);
      this.instanceId = payload.formOpened.instanceId;
    }
    return payload;
  }

  get proposal(): ChatFormProposal | null {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const proposal = this.messages[index]!.formProposal;
      if (proposal) return proposal;
    }
    return null;
  }

  async create() {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({ proposal: this.proposal!, messages: this.messages, call, onCreated: () => {} });
    this.instanceId = toUuid(result.reference.instanceId);
    return this.instanceId;
  }
}



/* ========================================================================= */


type Answer3 = "yes" | "no" | null;

/** The created form's Payroll Deduct box, where the form has one. */
function draftPayroll(id: string): Answer3 {
  const row = (store.form_instance_values ?? []).find(
    (entry) => entry.instance_id === id && (entry.field_key === "payroll_deduct" || entry.field_key === "payroll_deduction_applicable"),
  );
  const checked = (row?.checked as string[] | undefined) ?? [];
  return checked.includes("yes") ? "yes" : checked.includes("no") ? "no" : null;
}

const EXIT = ["create an exit form for Jordan Hale at Manhattan, she resigned, last day 10-24", "Create an exit form for Jordan Hale at Manhattan. She resigned, last day 10-24."] as const;
/* "HER LAST DAY WAS 10-24" in CAPS is read as a second person at Create, a separate defect (reported); this wording avoids it. */
const RESIGNATION = ["create a resignation form for Jordan Hale at Manhattan, last day 10-24", "Create a resignation form for Jordan Hale at Manhattan. Last day 10-24."] as const;
const COACHING = ["create a coaching form for Jordan Hale at Manhattan about her cell phone use", "Create a coaching form for Jordan Hale at Manhattan about her cell phone use."] as const;
const LATE_CA = ["create a verbal ca for Jordan Hale at Manhattan for being late to open on 10-20", "Create a verbal CA for Jordan Hale at Manhattan for being late to open on 10-20."] as const;
const LATE_CA_NO = ["create a verbal ca for Jordan Hale at Manhattan for being late to open on 10-20, no payroll deduct", "Create a verbal CA for Jordan Hale at Manhattan for being late to open on 10-20. No payroll deduct."] as const;

/*
 * [label, request (lowercase source, Sentence case), reply, the form, with the
 * fix, main with INTENT_PAYROLL_MANAGER_ONLY unset, main with it set].
 */
const PINS: readonly (readonly [string, readonly [string, string], string, string, Answer3, Answer3, Answer3])[] = [
  ["an exit form, then yes", EXIT, "Yes", "stc-exit", null, "yes", "yes"],
  ["an exit form, then no", EXIT, "No", "stc-exit", null, "no", "no"],
  ["an exit form, then $25", EXIT, "$25", "stc-exit", null, "yes", null],
  ["a resignation, then yes", RESIGNATION, "Yes", "stc-exit", null, "yes", "yes"],
  ["a Coaching Form, then yes", COACHING, "Yes", "coaching", null, null, null],
  ["a late-opening CA with \"no payroll deduct\", then yes", LATE_CA_NO, "Yes", "dpoa", "no", "yes", "yes"],
  ["a late-opening CA's payroll question, then yes", LATE_CA, "Yes", "dpoa", "yes", "yes", "yes"],
  ["a late-opening CA's payroll question, then no", LATE_CA, "No", "dpoa", "no", "no", "no"],
  ["a late-opening CA's payroll question, then \"Yes, $50\"", LATE_CA, "Yes, $50", "dpoa", "yes", "yes", "yes"],
];
const CASES = PINS.flatMap(([label, [lower, sentence], reply, form, fixed, mainOff, mainOn]) => [
  [`${label} (lowercase)`, lower.toLowerCase(), reply.toLowerCase(), form, fixed, mainOff, mainOn] as const,
  [`${label} (Sentence case)`, sentence, reply, form, fixed, mainOff, mainOn] as const,
  [`${label} (CAPS)`, lower.toUpperCase(), reply.toUpperCase(), form, fixed, mainOff, mainOn] as const,
]);

async function payrollAfter(request: string, reply: string, form: string) {
  const thread = new Thread();
  const first = await thread.say(request);
  const second = await thread.say(reply);
  expect(thread.proposal?.templateKey).toBe(form);
  const card = (thread.proposal?.payrollDeduct ?? null) as Answer3;
  const id = await thread.create();
  return { first, second, card, draft: draftPayroll(id) };
}

describe.each([
  ["INTENT_PAYROLL_MANAGER_ONLY unset", false],
  ["INTENT_PAYROLL_MANAGER_ONLY set", true],
] as const)("Sunny production env, %s", (_label, ipmo) => {
  beforeEach(() => {
    if (ipmo) process.env.INTENT_PAYROLL_MANAGER_ONLY_ENABLED = "true";
  });

  it.each(CASES)("fix on: %s", async (_case, request, reply, form, fixed) => {
    const { second, card, draft } = await payrollAfter(request, reply, form);
    expect(card).toBe(fixed);
    if (form === "dpoa") expect(draft).toBe(fixed);
    else {
      expect(draft).toBeNull();
      expect(second.content).not.toMatch(/Payroll deduction is (?:not )?applicable/);
    }
    if (form === "dpoa" && fixed === "no") expect(second.content).toMatch(/Is payroll deduct applicable\? \*\*No\*\*/);
  });

  it.each(CASES)("fix off reads it as main: %s", async (_case, request, reply, form, _fixed, mainOff, mainOn) => {
    delete process.env[FLAG];
    const { card } = await payrollAfter(request, reply, form);
    expect(card).toBe(ipmo ? mainOn : mainOff);
  });

  it.each([
    ["lowercase", LATE_CA_NO[0].toLowerCase()],
    ["Sentence case", LATE_CA_NO[1]],
    ["CAPS", LATE_CA_NO[0].toUpperCase()],
  ])("\"no payroll deduct\" in the CA request is No, fix on or off (%s)", async (_case, request) => {
    for (const fix of [true, false]) {
      if (fix) process.env[FLAG] = "true";
      else delete process.env[FLAG];
      const thread = new Thread();
      await thread.say(request);
      expect(thread.proposal?.payrollDeduct ?? null, `fix ${fix}`).toBe("no");
    }
  });
});
