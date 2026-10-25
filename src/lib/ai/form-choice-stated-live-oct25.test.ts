import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseHistory } from "@/lib/api/validation";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA ROUND 12, 25 OCT 2026 — A COACHING CONVERSATION BECAME A CORRECTIVE ACTION
 * ============================================================================
 *
 * conv_mvnmetao241awxn, replayed word for word through `answerQuestion` with
 * production's flag profile (intent extraction on, the full remap off) plus
 * NOT_A_NAME_GUARD and WARNING_LEVEL_MANAGER_ONLY, and the history built the
 * way `/api/chat` builds it (through `parseHistory`). The chat named nobody.
 *
 *   T1 "Help me prepare for a coaching conversation."            coaching guidance
 *   T2 "I have an employee that is not verifying documents …"    Corrective Action card
 *   T3 "The NCR and Fitzpatrick Skin Type Chart, EFT Agreements" Corrective Action card
 *   T4 "Can you create a coaching form and a policy review? …"   Corrective Action card
 *   T5 "Can you make it generic …"                               Corrective Action card
 *
 * Production's trace for T2–T5 read "The form is the Corrective Action Form.
 * Policy reference: Business Ethics …": the slot model's form was taken
 * although the manager only ever said coaching and Policy Review. The model's
 * readings were not recorded, so each case runs twice: the model naming no
 * form, and the model copying the assistant's "Corrective Action Form".
 *
 * With FORM_CHOICE_STATED_ENABLED no turn is a Corrective Action. One turn
 * carries one card, so "a coaching form and a policy review … both" asks
 * which form to start with.
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
  "NOT_A_NAME_GUARD_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
] as const;
const FLAG = "FORM_CHOICE_STATED_ENABLED";
const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /** The slot model's reading for the turn being asked. */
  raw: {} as Record<string, unknown>,
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
      formTurn: false,
      policyHeading: null,
      ...bag.raw,
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
  for (const name of PROD_FLAGS) process.env[name] = "true";
  delete process.env[FLAG];
  bag.forms.clear();
  bag.raw = {};
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

interface Turn {
  readonly user: string;
  /** The slot model's reading for this turn. */
  readonly raw: Record<string, unknown>;
  /** Ask Sunny's reply in the live chat, put into history in place of this harness's. */
  readonly recordedReply?: string;
}

let run = 0;

/** Each turn as the browser sends it: history through `parseHistory`, continuation from the full messages. */
async function replay(turns: readonly Turn[]) {
  run += 1;
  const conversationId = `conv-choice-stated-${run}`;
  const messages: ChatMessage[] = [];
  const replies: { content: string; formProposal?: ChatFormProposal }[] = [];
  for (const [index, turn] of turns.entries()) {
    bag.raw = turn.raw;
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
      { id: `u${index}`, role: "user", content: turn.user, createdAt: "2026-10-25T09:24:00Z" } as ChatMessage,
      {
        id: `a${index}`,
        role: "assistant",
        content: turn.recordedReply ?? response.content,
        createdAt: "2026-10-25T09:24:01Z",
        formProposal: response.formProposal,
      } as ChatMessage,
    );
  }
  return replies;
}

/* The manager's turns, conv_mvnmetao241awxn (no person was named). */
const PREPARE = "Help me prepare for a coaching conversation.";
const NOT_VERIFYING = "I have an employee that is not verifying documents are signed";
const DOCUMENTS = "The NCR and Fitzpatrick Skin Type Chart, EFT Agreements";
const BOTH = "Can you create a coaching form and a policy review? I'd like to see both";
const GENERIC = "Can you make it generic so if the problem occurs elsewhere it can be used for any employee?";

/* Production's T1 reply, trimmed to its opening, and the Corrective Action intake it sent on T2–T5. */
const PREPARE_REPLY =
  "Happy to help. Before we build the conversation, tell me two things: who you're coaching and what the specific gap is (a metric, an observed behavior, a policy issue). That changes the approach a lot.";
const CA_INTAKE_REPLY =
  "Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:\n\n1. Employee's full name\n2. Date for the form (if you say “today,” I'll use October 25, 2026)\n3. What happened — a clear description of the incident(s) with dates and specifics\n4. Whether this is a verbal or written warning\n5. Whether the employee has previously received coaching and/or corrective action, and if yes, what and the date each was signed\n6. Is payroll deduct applicable? (Yes or No)\n7. The employee's job title (e.g. TC, ASD, SD) if you have it\n\nOnce I have that I'll prepare the Corrective Action Form and check the applicable company policy before anything policy-related goes on it.\n\nBusiness Ethics Policy, JBA Policy Manual p.21";

const INCIDENT = "not verifying documents are signed";

/** The slot model naming no form on any turn. */
const NO_FORM_READING: Turn[] = [
  { user: PREPARE, raw: { formTurn: false }, recordedReply: PREPARE_REPLY },
  { user: NOT_VERIFYING, raw: { incidentType: INCIDENT, formTurn: true, policyHeading: "Business Ethics" } },
  { user: DOCUMENTS, raw: { incidentType: INCIDENT, formTurn: true, policyHeading: "Business Ethics" } },
  { user: BOTH, raw: { incidentType: INCIDENT, formTurn: true, policyHeading: "Business Ethics" } },
  { user: GENERIC, raw: { incidentType: INCIDENT, formTurn: true, policyHeading: "Business Ethics" } },
];

/** The slot model copying the assistant's "Corrective Action Form" from T2 on, as production's trace reads. */
const CA_READING: Turn[] = [
  { user: PREPARE, raw: { formTurn: false }, recordedReply: PREPARE_REPLY },
  {
    user: NOT_VERIFYING,
    raw: { incidentType: INCIDENT, formType: "Corrective Action Form", formTurn: true, policyHeading: "Business Ethics" },
    recordedReply: CA_INTAKE_REPLY,
  },
  {
    user: DOCUMENTS,
    raw: { incidentType: INCIDENT, formType: "Corrective Action Form", formTurn: true, policyHeading: "Business Ethics" },
    recordedReply: CA_INTAKE_REPLY,
  },
  {
    user: BOTH,
    raw: { incidentType: INCIDENT, formType: "Corrective Action Form", formTurn: true, policyHeading: "Business Ethics" },
    recordedReply: CA_INTAKE_REPLY,
  },
  {
    user: GENERIC,
    raw: { incidentType: INCIDENT, formType: "Corrective Action Form", formTurn: true, policyHeading: "Business Ethics" },
  },
];

const OFFERS_CA = /\*\*Corrective Action Form\*\*/;

describe("conv_mvnmetao241awxn on the live path", { timeout: 60_000 }, () => {
  it.each([
    ["the model naming no form", NO_FORM_READING],
    ["the model copying Corrective Action Form", CA_READING],
  ] as const)("FORM_CHOICE_STATED on: no turn is a Corrective Action (%s)", async (_name, turns) => {
    process.env[FLAG] = "true";
    const replies = await replay(turns);
    for (const [index, reply] of replies.entries()) {
      expect(reply.formProposal?.templateKey ?? null, turns[index]!.user).not.toBe("dpoa");
      expect(reply.content, turns[index]!.user).not.toMatch(OFFERS_CA);
    }
    // T1 and T2: a coaching path or a question.
    for (const reply of replies.slice(0, 2)) {
      expect([null, "coaching"]).toContain(reply.formProposal?.templateKey ?? null);
    }
    // T4: one turn carries one card, so the manager is asked which to start with.
    const both = replies[3]!;
    expect(both.formProposal ?? null).toBeNull();
    expect(both.content).toMatch(/Coaching Form/);
    expect(both.content).toMatch(/Policy Review/);
    expect(both.content).toMatch(/which/i);
  });

  it("FORM_CHOICE_STATED on: the manager picks one, it stays, and the other comes when asked for", async () => {
    process.env[FLAG] = "true";
    const replies = await replay([
      ...CA_READING.slice(0, 4).map((turn) => ({ user: turn.user, raw: turn.raw })),
      { user: "1", raw: { incidentType: INCIDENT, formType: "Corrective Action Form", formTurn: true } },
      { user: GENERIC, raw: { incidentType: INCIDENT, formType: "Corrective Action Form", formTurn: true } },
      { user: "Now the policy review", raw: { incidentType: INCIDENT, formType: "Corrective Action Form", formTurn: true } },
    ]);
    expect(replies.slice(4).map((reply) => reply.formProposal?.templateKey ?? null)).toEqual([
      "coaching",
      "coaching",
      "policy-review",
    ]);
  });

  it("FORM_CHOICE_STATED off: the production behaviour of 25 Oct (Corrective Action on T2–T5)", async () => {
    const replies = await replay(CA_READING);
    expect(replies.slice(1).map((reply) => reply.formProposal?.templateKey ?? null)).toEqual(["dpoa", "dpoa", "dpoa", "dpoa"]);
  });
});
