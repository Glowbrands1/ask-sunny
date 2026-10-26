import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseHistory } from "@/lib/api/validation";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE CARD'S DATE ON ASK SUNNY'S LIVE PATH — FORM_DATE_INCIDENT_ONLY, 26 OCT 2026
 * ============================================================================
 *
 * FORM_DATE_INCIDENT_ONLY_ENABLED was switched on in production at 08:45Z
 * and rolled back at 08:51Z: the live card test (tester 2, lowercase and
 * sentence case; invented names) showed
 *
 *   D1 "ca for <name>, coached her 10-16, written warning on 10-20"   Date 10/20
 *   D2 "… late on 10-5 and 10-15. i coached her on 10-16 …"           Date 10/16
 *   D3 "… for missing the woven deadline of 11-1-26"                  Date 11/1/2026
 *
 * The unit probes had passed with a narrower flag set. On production's set the
 * intake (FIELD_ACCURACY_ENABLED) adds "It happened on <the last month-day
 * date>" to the intent question, and the card dates the form by it; and the
 * slot model's "11-1-26", typed by the manager, was taken as the incident's.
 * Every case here runs `answerQuestion` with production's flag profile.
 */

const PROD_FLAGS = [
  "ACTION_PLAN_MANAGER_ONLY_ENABLED","ACTION_PLAN_SENTENCES_ENABLED","APP_PASSWORD_HELP_ENABLED","ATTENDANCE_POLICY_CITATION_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED","CHAT_STYLE_RULES_ENABLED","CHAT_TRACE_ENABLED","CROSS_CHAT_REPLY_GUARD_ENABLED","CURRENT_MANUAL_SCOPE_ENABLED",
  "DRAFT_DEDUPE_ENABLED","DRAFT_MERGE_ENABLED","DRAFT_NEVER_BLANK_ENABLED","DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED","EXIT_INTAKE_FIX_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED","FOLLOW_UP_NOT_PRIOR_ENABLED","FORM_CHOICE_STATED_ENABLED","FULL_MANUAL_CONTEXT_ENABLED","GLOBAL_SALON_ASK_ENABLED",
  "GROUNDED_ENTITIES_ENABLED","HYBRID_SEARCH_ENABLED","INTENT_EXTRACTION_ENABLED","KEEP_FORM_EMPLOYEE_ENABLED","LATE_OPEN_DATE_ENABLED",
  "LONG_CONTEXT_ENABLED","MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED","MANAGER_WORDS_ONLY_ENABLED","MANUAL_NEGATED_LIST_NOTE_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED","NAME_BEFORE_TITLE_ENABLED","NOT_A_NAME_GUARD_ENABLED","PAYROLL_AMOUNT_FIELD_ENABLED","PLACE_SPAN_GUARD_ENABLED",
  "POLICY_CITATION_ENABLED","POLICY_PAGE_REQUIRED_ENABLED","PRINTED_PAGE_CITATION_ENABLED","PRIOR_ACTIONS_PARSE_ENABLED",
  "PRIOR_COACHING_OPTIONAL_ENABLED","QUERY_REWRITE_ENABLED","REOPEN_VERB_GUARD_ENABLED","RETRIEVAL_RECALL_ENABLED","SELF_CHECK_ENABLED",
  "SEND_AFTER_HYDRATE_ENABLED","SENSITIVE_DEFAULTS_REDACT_ENABLED","STATE_CODE_NOT_A_PERSON_ENABLED","TITLE_WHOLE_WORD_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED","WARNING_LEVEL_MANAGER_ONLY_ENABLED","SLOT_RETENTION_ENABLED","FIELD_ACCURACY_ENABLED","SECOND_FORM_ENABLED",
] as const;
const FLAG = "FORM_DATE_INCIDENT_ONLY_ENABLED";
const PAYROLL_FLAG = "TERSE_SLOT_READ_ENABLED";
const TODAY = "2026-10-26";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /** What the slot model returns for warningLevel — production's reading was not recorded. */
  modelLevel: null as "verbal" | "written" | null,
  modelDate: null as string | null,
}));

const LIBRARY = TEMPLATE_SEEDS.map((seed, index) => ({
  id: `tpl-${seed.key}`,
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder ?? index,
  currentVersion: { id: `v-${seed.key}`, status: "published", document: seed.document, variants: seed.variants ?? [] },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));
vi.mock("@/lib/forms/employee-roster", () => ({
  readDirectoryFacts: async () => [],
  loadScopedRoster: async () => [],
  withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
}));
vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => LIBRARY }));
vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));
vi.mock("./form-state-store", () => ({
  loadFormState: async (userId: string, conversationId: string) => bag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    bag.forms.set(`${userId}:${conversationId}`, state);
  },
}));
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "replay";
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true as const,
        documentId: JBA_MANUAL_DOCUMENT.id,
        documentTitle: JBA_MANUAL_DOCUMENT.title,
        documentCategory: "policies_compliance" as const,
        matchedBy: "fallback" as const,
        chunks: JBA_MANUAL_CHUNKS,
      };
    }
  },
}));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));
vi.mock("@/lib/reviews/overview-block-read", () => ({
  loadReviewsOverviewBlock: async () => ({ status: "ready", totalReviews: 0, averageRating: 0, salonCount: 0 }),
}));
vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    if (input.tool?.name !== "record_intent_slots") return null;
    // The form the manager names in this turn, as the slot model copies it.
    const manager = JSON.stringify(input.messages ?? []).split("Manager:").pop() ?? "";
    const formType = "Corrective Action Form";
    const named = /(lysander pembrook|thessaly ironwood)/i.exec(manager)?.[1] ?? null;
    return {
      formType,
      employee: named,
      salon: /kearney/i.test(manager) ? "Kearney" : null,
      title: null,
      incidentType: /late/i.test(manager) ? "Attendance" : "Standards of Conduct",
      incidentDate: bag.modelDate,
      payrollAmount: null,
      warningLevel: bag.modelLevel,
      formTurn: true,
      policyHeading: null,
    };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const query: Record<string, unknown> = {};
      for (const name of ["select", "eq", "neq", "is", "in", "gte", "ilike", "order", "limit", "insert", "update", "upsert"]) {
        query[name] = () => query;
      }
      query.maybeSingle = () => Promise.resolve({ data: null, error: null });
      query.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(resolve({ data: [], error: null }));
      return query;
    },
  }),
}));

const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

let answerQuestion: typeof import("./server-ask").answerQuestion;
beforeAll(async () => {
  // probe: the first import is slow under load
  ({ answerQuestion } = await import("./server-ask"));
}, 120_000);

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...PROD_FLAGS, FLAG, PAYROLL_FLAG]) saved.set(name, process.env[name]);
  for (const name of PROD_FLAGS) process.env[name] = "true";
  delete process.env[FLAG];
  delete process.env[PAYROLL_FLAG];
  bag.forms.clear();
  bag.modelLevel = null;
  bag.modelDate = null;
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

interface Turn {
  readonly user: string;
  /** Ask Sunny's reply in the live chat, put into history in place of this harness's. */
  readonly recordedReply?: string;
}

/** Each turn as the browser sends it: history through `parseHistory`, continuation from the full messages. */
async function replay(conversationId: string, turns: readonly (Turn | string)[]) {
  const messages: ChatMessage[] = [];
  const replies: { content: string; formProposal?: ChatFormProposal }[] = [];
  for (const [index, step] of turns.entries()) {
    const turn = typeof step === "string" ? { user: step } : step;
    const continuation = continuationFor(messages);
    const response = await answerQuestion(
      {
        question: turn.user,
        mode: "standard",
        history: parseHistory(messages) as ChatMessage[],
        scopeId: "stc-core",
        questionMessageId: `u${index}`,
        conversationId,
        continueProposalTemplateKey: continuation?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "district_manager", scope: SCOPE, subject: "manager-replay", verified: true },
      { memoryOwnerId: "manager-replay" },
    );
    replies.push(response);
    messages.push(
      { id: `u${index}`, role: "user", content: turn.user, createdAt: "2026-10-26T15:00:00Z" } as ChatMessage,
      {
        id: `a${index}`,
        role: "assistant",
        content: turn.recordedReply ?? response.content,
        createdAt: "2026-10-26T15:00:01Z",
        formProposal: response.formProposal,
      } as ChatMessage,
    );
  }
  return replies;
}


const SENTENCES = {
  D1: "ca for lysander pembrook, coached her 10-16, written warning on 10-20",
  D2: "create a ca for thessaly ironwood at kearney, she was late on 10-5 and 10-15. i coached her on 10-16 about being late",
  D3: "create a ca for lysander pembrook at kearney for missing the woven deadline of 11-1-26",
} as const;

const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  [
    "sentence case",
    (text) => {
      const named = text
        .toLowerCase()
        .split("lysander pembrook").join("Lysander Pembrook")
        .split("thessaly ironwood").join("Thessaly Ironwood")
        .split("kearney").join("Kearney");
      return named.charAt(0).toUpperCase() + named.slice(1);
    },
  ],
  ["ALL CAPS", (text) => text.toUpperCase()],
];

/* What the slot model read in production (chat_traces, 26 Oct 2026): nothing for D1/D2, the deadline for D3. */
const MODEL_READ: Record<keyof typeof SENTENCES, string | null> = { D1: null, D2: null, D3: "11-1-26" };

async function cardDate(key: keyof typeof SENTENCES, as: (text: string) => string, id: string) {
  bag.modelDate = MODEL_READ[key];
  const replies = await replay(id, [as(SENTENCES[key])]);
  return replies.at(-1)!.formProposal?.formDate ?? null;
}

describe.each(REGISTERS)("the card's Date on the live path (%s)", (register, as) => {
  it("flag off: today's dates, pinned (D1 10/20, D2 10/05, D3 11/01)", async () => {
    delete process.env[FLAG];
    expect(await cardDate("D1", as, `off-d1-${register}`)).toBe("2026-10-20");
    expect(await cardDate("D2", as, `off-d2-${register}`)).toBe("2026-10-05");
    expect(await cardDate("D3", as, `off-d3-${register}`)).toBe("2026-11-01");
  }, 120_000);

  it("flag on: no earlier step, coaching or deadline dates the card", async () => {
    process.env[FLAG] = "true";
    // D1: both dates are earlier steps; D2: two incident dates and a coaching; D3: a deadline.
    // None is the form's date, which is then the day the form is created.
    expect(await cardDate("D1", as, `on-d1-${register}`)).toBeNull();
    expect(await cardDate("D2", as, `on-d2-${register}`)).toBeNull();
    expect(await cardDate("D3", as, `on-d3-${register}`)).toBeNull();
  }, 120_000);

  it("flag on, NEVER-BREAK: one stated incident date still dates the card", async () => {
    process.env[FLAG] = "true";
    bag.modelDate = null;
    for (const [index, text] of [
      "create a ca for thessaly ironwood at kearney, she was late on 10-22",
      "create a ca for thessaly ironwood at kearney, she was late on 10-22, coached her on 10-1",
      "create a ca for thessaly ironwood at kearney, she was late on 10-22-26 and missed the 11-1-26 deadline",
    ].entries()) {
      const replies = await replay(`on-keep-${index}-${register}`, [as(text)]);
      expect(replies.at(-1)!.formProposal?.formDate ?? null, text).toBe("2026-10-22");
    }
  }, 120_000);
});
