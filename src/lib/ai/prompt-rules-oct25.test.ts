import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * TWO PROMPT RULES QA APPROVED IN THE SIBLING APP, 25 OCT 2026 (G12, B6)
 * ============================================================================
 *
 * The sibling app's managers' words in this app's wording (salon for store,
 * this app's salons), replayed through `answerQuestion` with this app's
 * production profile (intent extraction on, the full remap off):
 *
 *   G12, conv_mvnu3j932gpohx4 T1: a Corrective Action request that lists
 *     previous coaching was answered there "I can't produce a facsimile of one
 *     or its contents". Here it opens the form; the answering prompt's form
 *     line carries the same wording, so FACSIMILE_ASK_ONLY_ENABLED changes it.
 *   B6, conv_mvnsqglc2v7zuyk: "previous coaching jba manual 11-1-25" came back
 *     as "Coaching Form on file, dated 2025-11-01". TYPED_PRIOR_NOT_ON_FILE_ENABLED.
 *
 * Synthetic names.
 */

const PROFILE = [
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

const TODAY = "2026-10-25";

/* Every system prompt the answering call was sent, in order. */
const sent = vi.hoisted(() => [] as string[]);

const bag = vi.hoisted(() => ({ forms: new Map<string, unknown>() }));

const PEOPLE: DirectoryFact[] = [
  {
    id: "jordan",
    firstName: "Jordan",
    lastName: "Testperson",
    preferredFirstName: null,
    salonIds: ["loc-0468"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0468",
    primaryLocationName: "KS Lawrence",
  },
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
];

const LIBRARY = TEMPLATE_SEEDS.map((seed) => ({
  id: `tpl-${seed.key}`,
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder,
  currentVersion: { id: `v-${seed.key}`, status: "published", document: seed.document, variants: seed.variants },
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
  readDirectoryFacts: async () => PEOPLE,
  loadScopedRoster: async () => PEOPLE,
  withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => LIBRARY,
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

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } = await import("@/lib/ai/__fixtures__/jba-policy-manual");
  return {
    SupabaseKnowledgeProvider: class {
      readonly name = "replay";
      async match() {
        return [];
      }
      async search() {
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
  };
});

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
  callClaude: async (input: { system: string }) => {
    sent.push(input.system);
    return "An answer.";
  },
  callClaudeTool: async (input: { tool?: { name?: string } }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    // The full remap's read: the sibling's production model guessed the Corrective Action Form.
    if (input.tool?.name === "extract_form_fields") {
      return { templateKey: "dpoa", employeeName: null, observation: null, actionPlan: null };
    }
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
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        neq: () => query,
        is: () => query,
        in: () => query,
        gte: () => query,
        ilike: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: [], error: null })),
      };
      return query;
    },
  }),
}));

const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

let answerQuestion: typeof import("./server-ask").answerQuestion;

// The first import of server-ask is the slow part.
beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 120_000);

beforeEach(() => {
  for (const flag of PROFILE) vi.stubEnv(flag, "true");
  bag.forms.clear();
  sent.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Turn {
  readonly question: string;
  readonly content: string;
  readonly proposal: ChatFormProposal | null;
}

let run = 0;
function on(...names: string[]) {
  for (const name of names) vi.stubEnv(name, "true");
}

/** `recorded` replaces this app's reply with the one production sent, by turn index. */
async function converse(turns: readonly string[], recorded: Readonly<Record<number, string>> = {}): Promise<Turn[]> {
  run += 1;
  const conversationId = `conv-replay-oct25-${run}`;
  const history: ChatMessage[] = [];
  const out: Turn[] = [];
  for (const [index, question] of turns.entries()) {
    const response = await answerQuestion(
      {
        question,
        mode: "standard",
        // The route keeps the last 20 turns (`LIMITS.historyTurns`).
        history: history.slice(-20),
        scopeId: "stc-core",
        questionMessageId: `msg-${run}-${index}`,
        conversationId,
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "admin" as never, scope: SCOPE, subject: "manager-replay-oct25", verified: true },
      { memoryOwnerId: "manager-replay-oct25" },
    );
    out.push({ question, content: response.content, proposal: response.formProposal ?? null });
    history.push({ id: `u-${run}-${index}`, role: "user", content: question, createdAt: `${TODAY}T15:00:00Z` });
    history.push({
      id: `a-${run}-${index}`,
      role: "assistant",
      content: recorded[index] ?? response.content,
      createdAt: `${TODAY}T15:01:00Z`,
      ...(response.formProposal ? { formProposal: response.formProposal } : {}),
    });
  }
  return out;
}

/* conv_mvnu3j932gpohx4 (sibling app), the manager's words in this app's wording. */
const B15_T1 =
  "do verbal corrective action for Test Employee, team member at Kearney, NE. location. previous coaching jba manual 9-9-26. payroll deduct applies. on 10-22-26 the register was short 8.65 which will be payroll deducted from Test Employee check";

/* conv_mvnsqglc2v7zuyk (sibling app), the manager's words in this app's wording. */
const B6_T1 =
  "do verbal for team member Test Employee at Kearney, NE. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the salon to show her team her new puppy. Test was in the salon 45 min";
const B6_T2 = "jba manual 11-1-25";
const B6_T4 = "cite animals in the workplace policy";

/* conv_mvmcdbcc26rpzd3 (sibling app): "show draft" was answered "Me typing out the fields would just be a facsimile". */
const SHOW_DRAFT = "show draft";

const ASK_ONLY = 'tell them in one sentence to ask you to create it — for example "ask me to create a coaching form for her" — and stop. Never say you cannot write';
const TYPED_PRIOR = "A PRIOR STEP THE MANAGER TYPED IN THIS CONVERSATION IS NOT ON FILE.";

describe("G12: a Corrective Action request is never answered with a facsimile refusal", () => {
  it.each([
    ["flag off", [] as string[]],
    ["FACSIMILE_ASK_ONLY_ENABLED", ["FACSIMILE_ASK_ONLY_ENABLED"]],
  ])("conv_mvnu3j932gpohx4 T1 opens the Corrective Action Form on the live intent path (%s)", async (_name, flags) => {
    on(...flags);
    const [reply] = await converse([B15_T1]);
    expect(reply!.proposal?.templateKey).toBe("dpoa");
    expect(reply!.content).not.toMatch(/facsimile|can't write this up/i);
  });

  it.each([
    ["PROMPT_CACHE_ENABLED off (production)", [] as string[]],
    ["PROMPT_CACHE_ENABLED on", ["PROMPT_CACHE_ENABLED"]],
  ])("the answering prompt with FACSIMILE_ASK_ONLY_ENABLED asks for the form and never says it cannot (%s)", async (_name, layout) => {
    on(...layout, "FACSIMILE_ASK_ONLY_ENABLED");
    await converse([SHOW_DRAFT]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toMatch(/facsimile/i);
    expect(sent[0]).toContain(ASK_ONLY);
  });

  it("flag off: the answering prompt is headed NEVER WRITE A FACSIMILE, as before", async () => {
    await converse([SHOW_DRAFT]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("- NEVER WRITE A FACSIMILE OF A COMPANY FORM.");
    expect(sent[0]).not.toContain(ASK_ONLY);
  });
});

describe("B6: a prior step the manager typed is never on file", () => {
  it("conv_mvnsqglc2v7zuyk T1–T2 on the live intent path: no reply says the coaching is on file", async () => {
    on("TYPED_PRIOR_NOT_ON_FILE_ENABLED");
    const turns = await converse([B6_T1, B6_T2]);
    for (const turn of turns) expect(turn.content).not.toMatch(/\bon file\b/i);
  });

  it.each([
    ["PROMPT_CACHE_ENABLED off (production)", [] as string[]],
    ["PROMPT_CACHE_ENABLED on", ["PROMPT_CACHE_ENABLED"]],
  ])("the answering prompt with TYPED_PRIOR_NOT_ON_FILE_ENABLED carries the rule (%s)", async (_name, layout) => {
    on(...layout, "TYPED_PRIOR_NOT_ON_FILE_ENABLED");
    await converse([B6_T4]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(TYPED_PRIOR);
    expect(sent[0]).toContain("Give it in the manager's own words");
  });

  it("flag off: the rule is not in the answering prompt", async () => {
    await converse([B6_T4]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain(TYPED_PRIOR);
  });
});
