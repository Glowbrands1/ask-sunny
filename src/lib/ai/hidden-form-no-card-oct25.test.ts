import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseHistory } from "@/lib/api/validation";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * A FORM THAT IS NOT PUBLISHED OPENS NO CARD — ASK SUNNY'S LIVE PATH, 25 OCT 2026
 * ============================================================================
 *
 * Ported from Ask Bubbles (QA, 25 Oct 2026). There, after the Tanning
 * Consultant Interview and both Management Interview Forms were hidden, the
 * full remap answered "create a tanning consultant interview form for Test
 * Employee" with a Coaching Form card and "create a first round management
 * interview form for Test Employee" with a Corrective Action Form: a model
 * reading of the form stood in for the one the manager named.
 *
 * Ask Sunny publishes those interviews and has no hidden-template list, so the
 * same turns are run here against a template the library lists as inactive,
 * and against interview forms this library does not have. The path is
 * production's (intent extraction on, the full remap off), through
 * `answerQuestion` with the history `/api/chat` builds, and
 * NAMED_FORM_EXACT_ENABLED on. Where the slot model
 * copies the manager's words the proposal flow already says the form is not
 * published; where it names one of the everyday forms instead (Bubbles' model
 * did exactly that), the saved form used to follow the model. The manager's
 * own latest naming now bounds it. Names are synthetic.
 */

const PROD_FLAGS = [
  "INTENT_EXTRACTION_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "POLICY_CITATION_ENABLED",
  "SECOND_FORM_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "DRAFT_MERGE_ENABLED",
] as const;
/** The check under test. Ask Bubbles ships it unflagged; Ask Sunny stages it. */
const FLAG = "NAMED_FORM_EXACT_ENABLED";
const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /** What the slot model returns for warningLevel — production's reading was not recorded. */
  modelLevel: null as "verbal" | "written" | null,
  /** The slot model's formType: the manager's words, or a guess at one of the everyday forms. */
  formType: null as string | null,
  /** Templates this test lists as inactive (not published). */
  unpublished: [] as string[],
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
vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => LIBRARY.map((row) => (bag.unpublished.includes(row.key) ? { ...row, active: false } : row)),
}));
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
    const formType = bag.formType;
    return {
      formType,
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
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
  ({ answerQuestion } = await import("./server-ask"));
});

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...PROD_FLAGS, FLAG]) saved.set(name, process.env[name]);
  for (const name of [...PROD_FLAGS, FLAG]) process.env[name] = "true";
  bag.forms.clear();
  bag.modelLevel = null;
  bag.formType = null;
  bag.unpublished = [];
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
      { id: `u${index}`, role: "user", content: turn.user, createdAt: "2026-10-24T20:00:00Z" } as ChatMessage,
      {
        id: `a${index}`,
        role: "assistant",
        content: turn.recordedReply ?? response.content,
        createdAt: "2026-10-24T20:00:01Z",
        formProposal: response.formProposal,
      } as ChatMessage,
    );
  }
  return replies;
}


const TANNING_INTERVIEW = "create a tanning consultant interview form for Test Employee";
const FIRST_ROUND_INTERVIEW = "create a first round management interview form for Test Employee";
const NOT_PUBLISHED = /not published/i;
const A_CARD = /what I would put on a \*\*(?:Coaching|Corrective Action|Follow-Up Coaching) Form\*\*|draft a \*\*Corrective Action Form\*\*|create a \*\*Corrective Action Form\*\*/i;

let sequence = 0;
const conversation = () => `conv_hidden_${++sequence}`;

describe("acceptance: a template that is not published opens no card (Bubbles QA, 25 Oct 2026)", () => {
  it.each([
    ["the slot model copying the manager's words", "tanning consultant interview form"],
    ["the slot model naming the Coaching Form", "Coaching Form"],
    ["no slot reading", null],
  ])("%s: an inactive Tanning Consultant Interview Form is not published, and no card", async (_name, formType) => {
    bag.unpublished = ["tanning-consultant-interview"];
    bag.formType = formType;
    const [reply] = await replay(conversation(), [TANNING_INTERVIEW]);
    expect(reply!.formProposal).toBeUndefined();
    expect(reply!.content).toMatch(NOT_PUBLISHED);
    expect(reply!.content).not.toMatch(A_CARD);
  });

  it("the slot model naming the Corrective Action Form: an inactive First Round Management Interview Form opens no card", async () => {
    bag.unpublished = ["management-interview-round-1"];
    bag.formType = "Corrective Action Form";
    const [reply] = await replay(conversation(), [FIRST_ROUND_INTERVIEW]);
    expect(reply!.formProposal).toBeUndefined();
    expect(reply!.content).toMatch(NOT_PUBLISHED);
    expect(reply!.content).not.toMatch(/Is payroll deduct applicable/);
  });

  it("asked while a Coaching card is open, an inactive interview still opens no card", async () => {
    bag.unpublished = ["tanning-consultant-interview"];
    bag.formType = "Coaching Form";
    const replies = await replay(conversation(), [
      "create a coaching form for Test Employee, late to her shift on 10-20",
      TANNING_INTERVIEW,
    ]);
    expect(replies[0]!.formProposal?.templateKey).toBe("coaching");
    expect(replies[1]!.formProposal ?? null).toBeNull();
    expect(replies[1]!.content).toMatch(NOT_PUBLISHED);
  });

  it("an inactive Coaching Form is not stood in for by the Follow-Up Coaching Form", async () => {
    bag.unpublished = ["coaching"];
    bag.formType = "Coaching Form";
    const [reply] = await replay(conversation(), ["create a coaching form for Test Employee, late to her shift on 10-20"]);
    expect(reply!.formProposal).toBeUndefined();
    expect(reply!.content).toMatch(NOT_PUBLISHED);
  });

  it.each([
    ["Coaching Form", "create a salon manager interview form for Test Employee"],
    ["Corrective Action Form", "create an interview form for Test Employee"],
    ["Corrective Action Form", "create a salon manager interview for Test Employee"],
  ])("an interview this library has no single title for (model: %s): %s opens no everyday-form card", async (formType, question) => {
    bag.formType = formType;
    const [reply] = await replay(conversation(), [question]);
    expect(["coaching", "dpoa", "follow-up-coaching", "policy-review"]).not.toContain(reply!.formProposal?.templateKey ?? "none");
    expect(reply!.content).not.toMatch(A_CARD);
  });

  it("a published interview the manager named is that interview, not the model's Coaching Form", async () => {
    bag.formType = "Coaching Form";
    const [reply] = await replay(conversation(), [TANNING_INTERVIEW]);
    expect(reply!.formProposal?.templateKey).toBe("tanning-consultant-interview");
  });
});

describe("unchanged: the everyday forms and the exit form still make their cards", () => {
  it.each([
    ["Corrective Action Form", "create a CA for Test Employee, out of dress code 10/11", "dpoa"],
    ["Coaching Form", "create a coaching form for Test Employee, late to her shift on 10-20", "coaching"],
    ["Corrective Action Form", "create a CA for Test Employee, she skipped the interview training on 10-20", "dpoa"],
    [null, "write up Test Employee for a no call no show on 10-20", "dpoa"],
    ["Follow-Up Coaching Form", "create a follow-up coaching form for Test Employee, coached on 10-1", "follow-up-coaching"],
    ["Resignation/Exit Form", "Create an exit form for Test Employee, she resigned and her last day was 10-20", "stc-exit"],
  ])("(model: %s) %s -> %s", async (formType, question, key) => {
    bag.formType = formType;
    const [reply] = await replay(conversation(), [question]);
    expect(reply!.formProposal?.templateKey).toBe(key);
  });

  it("a field note mentioning an interview stays on the open Corrective Action Form", async () => {
    bag.formType = "Corrective Action Form";
    const replies = await replay(conversation(), [
      "create a CA for Test Employee, out of dress code 10/11",
      "verbal, no payroll, she missed her interview shift too",
    ]);
    expect(replies[1]!.formProposal?.templateKey).toBe("dpoa");
  });
});
