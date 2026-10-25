import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseHistory } from "@/lib/api/validation";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE WARNING LEVEL ON ASK SUNNY'S LIVE PATH — ACCEPTANCE CASES, 24 OCT 2026
 * ============================================================================
 *
 * Every case runs the managers' turns through `answerQuestion` with
 * production's flag profile (intent extraction on, the full remap off), and the
 * history built the way `/api/chat` builds it — through `parseHistory`, which
 * drops each turn's `formProposal`. A test that kept the proposal in history
 * could not see a level that only survives in the saved slots.
 *
 * The turns are the live chats' own words (synthetic names only). Where Ask
 * Sunny's reply in the live chat carried the words that misled the reader, the
 * recorded reply is what goes into history, as the browser held it.
 *
 *   conv_mvmtc8k72x22ox6 / conv_mvmtndnm2k6ilyr  Written invented after
 *                                                "for Test Employee" / "Yes"
 *   conv_mvh1m29j25aig2n                          the "Yes" that confirms a name
 *   conv_mvmj6v1t250hfij (Kearney replay; Bubbles conv_mvmo24rs2rjnl7q)
 *                                                "verbal, prior = manual ack 9/01, no payroll"
 *   QA                                           "prior verbal on 9-1, this one is written"
 *   conv_mvmvt8y925whytt                          "this is a verbal" cleared, then Written
 *                                                came back, and rode onto a Policy Review
 *   conv_mvmvqut82r8agma, conv_mvmvradb2sj0ify   Written on a Resignation/Exit Form
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
const FLAG = "WARNING_LEVEL_MANAGER_ONLY_ENABLED";
const PAYROLL_FLAG = "INTENT_PAYROLL_MANAGER_ONLY_ENABLED";
const TODAY = "2026-10-24";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /** What the slot model returns for warningLevel — production's reading was not recorded. */
  modelLevel: null as "verbal" | "written" | null,
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
    const formType = /policy review/i.test(manager) ? "Policy Review" : null;
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
  for (const name of [...PROD_FLAGS, FLAG, PAYROLL_FLAG]) saved.set(name, process.env[name]);
  for (const name of PROD_FLAGS) process.env[name] = "true";
  process.env[FLAG] = "true";
  delete process.env[PAYROLL_FLAG];
  bag.forms.clear();
  bag.modelLevel = null;
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

const READ_BACK = /\*\*Type of Warning:\*\* (Verbal|Written) Warning, as you said/;
const readBack = (content: string) => READ_BACK.exec(content)?.[1]?.toLowerCase() ?? null;

/* Recorded replies (production, 24 Oct 2026), trimmed to the paragraphs the readers see. */
const LEVEL_LEFT_OPEN_REPLY =
  "I'll draft a **Corrective Action Form** for **Test Employee** from what you've described, and check the applicable company policy before anything policy-related goes on it.\n\nYou'll set the verbal/written warning level and any prior coaching or corrective action on the form — I won't guess at them.\n\nOne more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.";
const INTAKE_LIST_REPLY =
  "Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:\n\n1. Employee's full name\n2. Date for the form (if you say “today,” I'll use October 24, 2026)\n3. What happened — a clear description of the incident(s) with dates and specifics\n4. Whether this is a verbal or written warning\n5. Whether the employee has previously received coaching and/or corrective action, and if yes, what and the date each was signed\n6. Is payroll deduct applicable? (Yes or No)\n7. The employee's job title (e.g. TC, ASD, SD) if you have it\n\nOnce I have that I'll prepare the Corrective Action Form and check the applicable company policy before anything policy-related goes on it.";

describe("acceptance: the level is only what the manager said, on the live path", () => {
  it.each([
    ["no slot reading", null],
    ["the slot model guessing written", "written"],
  ] as const)('conv_mvmtc8k72x22ox6: "for Test Employee" reads back no level (%s)', async (_name, guess) => {
    bag.modelLevel = guess;
    const replies = await replay("conv_test_a1", [
      {
        user: "create ca for Test Employee, Salon Director for violating standards of conduct. Test failed to have Test Newhire complete required policy acknowledgements in woven during Test Newhire's onboarding on 9-28-26 as reflected on the woven policy acknowledgement report run on 10-16-26.",
        recordedReply: LEVEL_LEFT_OPEN_REPLY,
      },
      "for Test Employee",
    ]);
    const last = replies.at(-1)!;
    expect(readBack(last.content)).toBeNull();
    expect(last.formProposal?.warningLevel ?? null).toBeNull();
  });

  it('conv_mvmtndnm2k6ilyr: a bare "Yes" reads back no level, and answers the payroll question', async () => {
    const replies = await replay("conv_test_a2", [
      { user: "create a corrective action form for Test Employee", recordedReply: LEVEL_LEFT_OPEN_REPLY },
      "Yes",
    ]);
    const last = replies.at(-1)!;
    expect(readBack(last.content)).toBeNull();
    expect(last.formProposal?.warningLevel ?? null).toBeNull();
    expect(last.formProposal?.payrollDeduct).toBe("yes");
    expect(last.content).not.toMatch(/Yes or No\?/);
  });

  it('a bare "Yes" after an either/or level question reads back no level and answers payroll (parity with Ask Bubbles)', async () => {
    const replies = await replay("conv_test_a2c", [
      {
        user: "create a corrective action form for Test Employee",
        recordedReply:
          "I can create a **Corrective Action Form** for **Test Employee**.\n\nIs this new corrective action a **Verbal Warning** or a **Written Warning**? Tell me here, or tick it on the form — I won't choose it for you.\n\nOne more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.",
      },
      "Yes",
    ]);
    const last = replies.at(-1)!;
    expect(readBack(last.content)).toBeNull();
    expect(last.formProposal?.warningLevel ?? null).toBeNull();
    expect(last.formProposal?.payrollDeduct).toBe("yes");
  });

  it("conv_mvmtndnm2k6ilyr with main's payroll flag on too: both readers agree on the bare Yes", async () => {
    process.env[PAYROLL_FLAG] = "true";
    const replies = await replay("conv_test_a2b", [
      { user: "create a corrective action form for Test Employee", recordedReply: LEVEL_LEFT_OPEN_REPLY },
      "Yes",
    ]);
    expect(replies.at(-1)!.formProposal?.payrollDeduct).toBe("yes");
    expect(readBack(replies.at(-1)!.content)).toBeNull();
  });

  it('conv_mvh1m29j25aig2n: the "Yes" that confirms a name is not a payroll answer or a level', async () => {
    const replies = await replay("conv_test_a3", [
      {
        user: "create a corrective action form for Rowen Testo",
        recordedReply:
          "Did you mean **Rowan Testo**? I couldn't find **Rowen Testo** exactly in the employee list for your salons, so I want to be sure before it goes on the form. Reply \"yes\" to use **Rowan Testo**, or \"no\" to keep **Rowen Testo** as you typed it.",
      },
      "Yes",
    ]);
    const last = replies.at(-1)!;
    expect(last.formProposal?.payrollDeduct ?? null).toBeNull();
    expect(readBack(last.content)).toBeNull();
  });

  it('R1, Kearney replay: "verbal, prior = manual ack 9/01, no payroll" reads back Verbal', async () => {
    const replies = await replay("conv_test_r1", [
      "CA for Test Employee at Kearney, out of dress code 10/11",
      "verbal, prior = manual ack 9/01, no payroll",
      "Use Kearney as the location",
    ]);
    expect(replies[1]!.formProposal?.warningLevel).toBe("verbal");
    expect(readBack(replies[1]!.content)).toBe("verbal");
    expect(replies[2]!.formProposal?.warningLevel).toBe("verbal");
  });

  it('R1: "prior verbal on 9-1, this one is written" reads back Written', async () => {
    const replies = await replay("conv_test_r1b", [
      "CA for Test Employee at Kearney, out of dress code 10/11",
      "prior verbal on 9-1, this one is written",
    ]);
    expect(replies[1]!.formProposal?.warningLevel).toBe("written");
    expect(readBack(replies[1]!.content)).toBe("written");
  });

  it("R2: a stale saved level the manager never stated goes away", async () => {
    bag.forms.set("manager-replay:conv_test_r2", {
      employeeName: "Test Employee",
      templateKey: "dpoa",
      warningLevel: "written",
    });
    const first = "create a corrective action form for Test Employee";
    const messages = [
      { id: "u0", role: "user", content: first, createdAt: "2026-10-24T20:00:00Z" },
      { id: "a0", role: "assistant", content: LEVEL_LEFT_OPEN_REPLY, createdAt: "2026-10-24T20:00:01Z" },
    ] as ChatMessage[];
    const response = await answerQuestion(
      {
        question: "for Test Employee",
        mode: "standard",
        history: parseHistory(messages) as ChatMessage[],
        scopeId: "stc-core",
        questionMessageId: "u1",
        conversationId: "conv_test_r2",
        continueProposalTemplateKey: "dpoa",
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "district_manager", scope: SCOPE, subject: "manager-replay", verified: true },
      { memoryOwnerId: "manager-replay" },
    );
    expect(response.formProposal?.warningLevel ?? null).toBeNull();
    expect(readBack(response.content)).toBeNull();
    expect((bag.forms.get("manager-replay:conv_test_r2") as { warningLevel: unknown }).warningLevel ?? null).toBeNull();
  });

  it('conv_mvmvt8y925whytt: no invented level; "this is a verbal" sets Verbal and keeps it; none on the Policy Review', async () => {
    const replies = await replay("conv_test_r4", [
      { user: "Create a form from this conversation.", recordedReply: "Which form do you need?" },
      { user: "Create a Corrective Action Form from this conversation.", recordedReply: INTAKE_LIST_REPLY },
      "test testy, tc at manhattan did not complete the 10 min sanitize clean when opening salon on 9-23-26",
      "this is a verbal",
      "test has been an employee for 7 months, create the ca",
      "do a ca and cite the standards of conduct as the policy violated",
      "Create a Policy Review from this conversation.",
    ]);
    expect(readBack(replies[2]!.content)).toBeNull();
    expect(replies[2]!.formProposal?.warningLevel ?? null).toBeNull();
    for (const turn of [3, 4, 5]) {
      expect(replies[turn]!.formProposal?.warningLevel, `turn ${turn + 1}`).toBe("verbal");
      expect(readBack(replies[turn]!.content), `turn ${turn + 1}`).toBe("verbal");
    }
    expect(replies[6]!.formProposal?.templateKey).toBe("policy-review");
    expect(replies[6]!.formProposal?.warningLevel ?? null).toBeNull();
  });

  it("conv_mvmvqut82r8agma: no level on a Resignation/Exit Form", async () => {
    const replies = await replay("conv_test_exit1", [
      "create an exit form. employee name is test testy. test was a tanning consultant at manhattan location. on 9-15-26 test provided her resignation to management and her last day worked was 9-28-26",
      "test gave and worked 2 week notice. test messaged management her resignation via woven. all salon items were returned and she is eligible for rehire",
    ]);
    for (const reply of replies) {
      expect(reply.formProposal?.templateKey).toBe("stc-exit");
      expect(reply.formProposal?.warningLevel ?? null).toBeNull();
      expect(readBack(reply.content)).toBeNull();
    }
  });

  it("conv_mvmvradb2sj0ify: no level on a Resignation/Exit Form", async () => {
    const replies = await replay("conv_test_exit2", [
      "what does policy say about pets in salon",
      "assist with creating an exit form",
      "test employee, tanning consultant at shawnee",
      "last day worked was 9-20-26. management called her with no response on 9-27-26",
      "its a no call no show",
      "create exit form",
      "Create a form from this conversation.",
      "create exit: Test Employee, Tanning Consultant, KS Shawnee Mission Pkwy\nLast day worked 9/20/26\nNo call/no show; management attempted phone contact 9/27/26, no response",
    ]);
    for (const [index, reply] of replies.entries()) {
      expect(reply.formProposal?.warningLevel ?? null, `turn ${index + 1}`).toBeNull();
      expect(readBack(reply.content), `turn ${index + 1}`).toBeNull();
    }
  });
});
