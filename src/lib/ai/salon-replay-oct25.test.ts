import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE SALON THE MANAGER TYPED — PORTED FROM THE SIBLING APP'S REPLAY, 25 OCT 2026
 * ============================================================================
 *
 * The sibling app's chat-history replay (production, 25 Oct 2026), its
 * managers' words in this app's wording (salon for store, this app's salons),
 * replayed through `answerQuestion` with this app's production profile
 * (intent extraction on, the full remap off):
 *
 *   conv_mvnsstvq2cywp78 / conv_mvnu3j932gpohx4: a Corrective Action request
 *     that lists previous coaching, then "change store location to …", then
 *     'create a Corrective Action Form for Test Employee"' — the card kept the
 *     first place, and What happened was the stray quote.
 *   conv_mve3dllz2vq5db8: an all-locations account typed "the location is
 *     NE Grand Island"; every card said the account covers every location.
 *   conv_mvnssmd12m61nhu: "create an exit for …" (no "form") came back as the
 *     Corrective Action Form.
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
  callClaude: async () => "An answer.",
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

const T1 =
  "do verbal corrective action for Test Employee, team member at Kearney, NE. location. previous coaching jba manual 9-9-26. payroll deduct applies. on 10-22-26 the register was short 8.65 which will be payroll deducted from Test Employee check";
const T2 = "change salon location to grand island, ne";
/* The stray closing quote is the manager's. */
const T3 = 'create a Corrective Action Form for Test Employee"';
const T1_REPLY =
  "I can't write this up as a corrective action document here — that's a formal HR record, and I can't produce a facsimile of one or its contents. If you want to proceed, just say: **\"create a Corrective Action form for Test Employee\"** and the draft card will come up.";
const T2_REPLY = "Got it — the salon for this is NE Grand Island, not Kearney. When you're ready, say **\"create a Corrective Action form for Test Employee\"**.";
const PUNCTUATION_ONLY = /^[^\p{L}\p{N}]*$/u;

describe("T1: a Corrective Action request that lists previous coaching is a form request", () => {
  it("opens the Corrective Action Form, never the facsimile refusal", async () => {
    const [reply] = await converse([T1]);
    expect(reply!.content).not.toMatch(/facsimile|can't write this up/i);
    expect(reply!.proposal?.templateKey).toBe("dpoa");
  });
});

const GRAND_ISLAND = "loc-0307";
const KEARNEY = "loc-0309";

describe("T3: the salon the manager changed to is the card's salon", () => {
  it.each([
    ["after the sibling's chat replies", { 0: T1_REPLY, 1: T2_REPLY }],
    ["with every turn through this app", {}],
  ])("%s: NE Grand Island on T2 and T3 (NEWEST_PLACE_TURN_ENABLED)", async (_name, recorded) => {
    on("NEWEST_PLACE_TURN_ENABLED");
    const turns = await converse([T1, T2, T3], recorded);
    expect(turns[0]!.proposal?.locationId).toBe(KEARNEY);
    expect(turns[1]!.proposal?.locationId).toBe(GRAND_ISLAND);
    const card = turns.at(-1)!;
    expect(card.proposal?.templateKey).toBe("dpoa");
    expect(card.proposal?.locationId).toBe(GRAND_ISLAND);
  });

  it("with the place guard on too: NE Grand Island", async () => {
    on("NEWEST_PLACE_TURN_ENABLED", "PLACE_SPAN_GUARD_ENABLED");
    const turns = await converse([T1, T2, T3], { 0: T1_REPLY, 1: T2_REPLY });
    expect(turns.at(-1)!.proposal?.locationId).toBe(GRAND_ISLAND);
  });

  it("NEWEST_PLACE_TURN_ENABLED off: the first salon stays (what the sibling's production showed)", async () => {
    on("PLACE_SPAN_GUARD_ENABLED");
    const turns = await converse([T1, T2, T3], { 0: T1_REPLY, 1: T2_REPLY });
    expect(turns.at(-1)!.proposal?.locationId).toBe(KEARNEY);
  });

  it("the full remap (FORM_FULL_REMAP_ENABLED, the sibling's path): NE Grand Island", async () => {
    on("FORM_FULL_REMAP_ENABLED", "NEWEST_PLACE_TURN_ENABLED", "PLACE_SPAN_GUARD_ENABLED", "REMAP_INCIDENT_FIX_ENABLED", "PRIOR_ACTIONS_PARSE_ENABLED");
    const turns = await converse([T1, T2, T3], { 0: T1_REPLY, 1: T2_REPLY });
    expect(turns.at(-1)!.proposal?.locationId).toBe(GRAND_ISLAND);
  });
});

describe("T3: a stray quote is never What happened", () => {
  it.each([
    ["the live intent path", [] as string[]],
    ["the full remap with REMAP_INCIDENT_FIX_ENABLED", ["FORM_FULL_REMAP_ENABLED", "REMAP_INCIDENT_FIX_ENABLED", "PRIOR_ACTIONS_PARSE_ENABLED"]],
  ])("%s", async (_name, flags) => {
    on(...flags);
    const turns = await converse([T1, T2, T3], { 0: T1_REPLY, 1: T2_REPLY });
    const card = turns.at(-1)!;
    const happened = /\*\*What happened:\*\* ([^\n]*)/.exec(card.content)?.[1] ?? null;
    if (happened !== null) expect(happened).not.toMatch(PUNCTUATION_ONLY);
  });
});

describe("conv_mve3dllz2vq5db8: an all-salons account's typed salon is the card's salon", () => {
  const TURNS = [
    "What does our policy say about attendance?",
    "create a coaching form that is for Test Employee over tardiness",
    "the location is NE Grand Island",
    "Create a Coaching Form from this conversation.",
  ];

  it("the coaching card names NE Grand Island", async () => {
    const turns = await converse(TURNS);
    const card = turns.at(-1)!;
    expect(card.proposal?.templateKey).toBe("coaching");
    expect(card.proposal?.locationId).toBe(GRAND_ISLAND);
    expect(card.content).not.toMatch(/covers every (?:salon|location)/i);
  });
});

describe('conv_mvnssmd12m61nhu: "create an exit" is the Resignation/Exit Form', () => {
  it.each([
    "create an exit for Test Employee at Lawrence last day worked 10-17-26",
    "create an exit for Test Employee",
  ])("%s", async (question) => {
    const [reply] = await converse([question]);
    expect(reply!.proposal?.templateKey ?? null).not.toBe("dpoa");
    expect(reply!.content).not.toMatch(/Corrective Action Form|Verbal or written\?|Is payroll deduct applicable\?/);
    if (reply!.proposal) expect(reply!.proposal.templateKey).toBe("stc-exit");
  });
});
