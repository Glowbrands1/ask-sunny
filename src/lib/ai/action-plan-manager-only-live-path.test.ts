import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseHistory } from "@/lib/api/validation";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE ACTION PLAN IS THE MANAGER'S, OR BLANK — ASK SUNNY'S LIVE PATH
 * ============================================================================
 *
 * Pau, 25 Oct 2026: when the manager typed no action plan, the form's Action
 * Plan stays blank, with no standard or boilerplate sentence. A plan the
 * manager typed is kept word for word. ACTION_PLAN_MANAGER_ONLY_ENABLED.
 *
 * The C-list turn from QA B5 (conv_mvnmf1ik2lqkfld), in this app's words (a
 * salon; Kearney is a salon here), through `answerQuestion` with production's
 * flag profile (intent extraction on, the full remap off) and the two-sentence
 * plan on — the profile under which the card printed "Management will review
 * the … policy with Test. Future policy violations may result in additional
 * corrective action up to and including termination of employment." with no
 * plan typed. The full remap (off here in production) is run as a guard.
 * The form's own Action Plan line is covered by
 * `src/app/api/forms/action-plan-manager-only-e2e.test.ts`.
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
  "ACTION_PLAN_SENTENCES_ENABLED",
] as const;
const FLAG = "ACTION_PLAN_MANAGER_ONLY_ENABLED";
const REMAP = "FORM_FULL_REMAP_ENABLED";
/* The reply check runs after the card is built; the plan rule runs after it. */
const SELF_CHECK = "SELF_CHECK_ENABLED";
const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /** What the full remap's model returns: its own summary as the action plan. */
  remapRaw: null as Record<string, unknown> | null,
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
    if (input.tool?.name === "extract_form_fields") return bag.remapRaw;
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
      warningLevel: null,
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
  for (const name of [...PROD_FLAGS, FLAG, REMAP, SELF_CHECK]) saved.set(name, process.env[name]);
  for (const name of PROD_FLAGS) process.env[name] = "true";
  delete process.env[FLAG];
  delete process.env[REMAP];
  delete process.env[SELF_CHECK];
  bag.forms.clear();
  bag.remapRaw = null;
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
      { id: `u${index}`, role: "user", content: turn.user, createdAt: "2026-10-25T20:00:00Z" } as ChatMessage,
      {
        id: `a${index}`,
        role: "assistant",
        content: turn.recordedReply ?? response.content,
        createdAt: "2026-10-25T20:00:01Z",
        formProposal: response.formProposal,
      } as ChatMessage,
    );
  }
  return replies;
}


/* QA B5, conv_mvnmf1ik2lqkfld — the C-list turn, in Ask Sunny's words. */
const C_LIST = "create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline";
const MANAGER_PLAN = "complete the Woven policy module by 10-30-26 and review it with her manager";
const CONTROL = `${C_LIST}. action plan: ${MANAGER_PLAN}`;

const STANDARD_REVIEW = /Management will review\b/;
const STANDARD_CLOSING =
  "Future policy violations may result in additional corrective action up to and including termination of employment.";
const planLines = (content: string) => content.split("\n").filter((line) => /\*\*Action plan:?\*\*/i.test(line));

describe("acceptance: Action Plan manager-only, intent path (production profile)", () => {
  it("flag off: the C-list turn still prints the standard two-sentence plan (unchanged)", async () => {
    const [reply] = await replay("conv_test_plan_off", [C_LIST]);
    expect(reply!.formProposal?.templateKey).toBe("dpoa");
    expect(reply!.content).toMatch(STANDARD_REVIEW);
    expect(reply!.content).toContain(STANDARD_CLOSING);
  });

  it("flag on: the C-list turn's card has no Action Plan at all", async () => {
    process.env[FLAG] = "true";
    const [reply] = await replay("conv_test_plan_on", [C_LIST]);
    expect(reply!.formProposal?.templateKey).toBe("dpoa");
    expect(planLines(reply!.content)).toEqual([]);
    expect(reply!.content).not.toMatch(STANDARD_REVIEW);
    expect(reply!.content).not.toContain(STANDARD_CLOSING);
  });

  it("flag on, control: the plan the manager typed is the Action Plan, word for word", async () => {
    process.env[FLAG] = "true";
    const [reply] = await replay("conv_test_plan_typed", [CONTROL]);
    expect(reply!.formProposal?.templateKey).toBe("dpoa");
    expect(planLines(reply!.content)).toEqual([`**Action Plan:** ${MANAGER_PLAN}`]);
    expect(reply!.content).not.toMatch(STANDARD_REVIEW);
    expect(reply!.content).not.toContain(STANDARD_CLOSING);
  });

  it("flag on, control as a second turn: the typed plan is kept, and nothing else is added", async () => {
    process.env[FLAG] = "true";
    const replies = await replay("conv_test_plan_typed_2", [C_LIST, `action plan: ${MANAGER_PLAN}`]);
    expect(planLines(replies[0]!.content)).toEqual([]);
    expect(replies[1]!.formProposal?.templateKey).toBe("dpoa");
    expect(planLines(replies[1]!.content)).toEqual([`**Action Plan:** ${MANAGER_PLAN}`]);
    expect(replies[1]!.content).not.toMatch(STANDARD_REVIEW);
  });

  it.each([
    ["the C-list turn", C_LIST, []],
    ["the control turn", CONTROL, [`**Action Plan:** ${MANAGER_PLAN}`]],
  ] as const)("flag on with the reply check on: %s", async (_name, turn, expected) => {
    process.env[FLAG] = "true";
    process.env[SELF_CHECK] = "true";
    const [reply] = await replay("conv_test_plan_checked", [turn]);
    expect(planLines(reply!.content)).toEqual(expected);
    expect(reply!.content).not.toMatch(STANDARD_REVIEW);
  });

  it("flag off, control: today the typed plan is replaced by the standard sentences (what the flag changes)", async () => {
    const [reply] = await replay("conv_test_plan_typed_off", [CONTROL]);
    expect(reply!.content).toMatch(STANDARD_REVIEW);
    expect(planLines(reply!.content).join("\n")).not.toContain(MANAGER_PLAN);
  });
});

describe("guard: Action Plan manager-only on the full remap (off in Ask Sunny production)", () => {
  // Words the manager used, so the remap's grounding check keeps it today.
  const SUMMARY = "Test to meet the woven deadline.";
  const remapRaw = (question: string) => ({
    templateKey: "dpoa",
    employeeName: "Test Employee",
    observation: null,
    actionPlan: SUMMARY,
    warningLevel: /written/.test(question) ? "written" : null,
  });

  it("flag off: the remap card prints the model's own action plan summary (unchanged)", async () => {
    process.env[REMAP] = "true";
    bag.remapRaw = remapRaw(C_LIST);
    const [reply] = await replay("conv_test_remap_off", [C_LIST]);
    expect(reply!.formProposal?.templateKey).toBe("dpoa");
    expect(planLines(reply!.content)).toEqual([`**Action plan:** ${SUMMARY}`]);
  });

  it("flag on: no plan on the remap card when the manager typed none", async () => {
    process.env[REMAP] = "true";
    process.env[FLAG] = "true";
    bag.remapRaw = remapRaw(C_LIST);
    const [reply] = await replay("conv_test_remap_on", [C_LIST]);
    expect(reply!.formProposal?.templateKey).toBe("dpoa");
    expect(planLines(reply!.content)).toEqual([]);
    expect(reply!.content).not.toContain(SUMMARY);
  });

  it("flag on, control: the remap card carries the manager's plan word for word", async () => {
    process.env[REMAP] = "true";
    process.env[FLAG] = "true";
    bag.remapRaw = remapRaw(CONTROL);
    const [reply] = await replay("conv_test_remap_typed", [CONTROL]);
    expect(planLines(reply!.content)).toHaveLength(1);
    expect(planLines(reply!.content)[0]).toMatch(new RegExp(`^\\*\\*Action [Pp]lan:\\*\\* ${MANAGER_PLAN}$`));
    expect(reply!.content).not.toContain(SUMMARY);
  });
});
