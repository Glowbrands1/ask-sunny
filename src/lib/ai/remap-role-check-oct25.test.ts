import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import type { AccessScope, Role } from "@/types";

/**
 * ============================================================================
 * THE REMAP CARD RESPECTS THE ROLE MATRIX — QA, 25 OCT 2026
 * ============================================================================
 *
 * With FORM_FULL_REMAP_ENABLED on, `answerQuestion` returned the remap's card
 * before the proposal path ran, and the remap never read the actor's role. An
 * Employee or an Assistant Salon Director asking for "a coaching form for …"
 * was shown a Coaching Form card; Create was then refused with a 403.
 *
 * REMAP_ROLE_CHECK_ENABLED on: such a turn shows no card and gets the proposal
 * path's own refusal. A Salon Director gets today's remap card. Off, today's
 * behaviour is pinned: the card is shown even to an Employee. Invented names.
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
  "FORM_FULL_REMAP_ENABLED",
] as const;

/*
 * The request as briefed, then the same request in a manager's real register:
 * all lowercase with no punctuation; sentence case with the name typed
 * lowercase and Capitalized; ALL UPPERCASE; and terse. The name comes back
 * from the extraction exactly as typed. No reader may depend on case.
 */
const VARIANTS = [
  ["coaching form for Tessaly Brookhart, late 3 times", "Tessaly Brookhart"],
  ["coaching form for rowan pell late 3 times", "rowan pell"],
  ["Coaching form for rowan pell, late 3 times.", "rowan pell"],
  ["Coaching form for Rowan Pell, late 3 times.", "Rowan Pell"],
  ["COACHING FORM FOR ROWAN PELL, LATE 3 TIMES", "ROWAN PELL"],
  ["just do a coaching form for rowan pell shes late again", "rowan pell"],
] as const;
const REFUSAL = "Your role cannot create a **Coaching Form**, so I will not propose one.";

const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({ forms: new Map<string, unknown>(), name: "" }));

const PEOPLE: DirectoryFact[] = [
  {
    id: "tessaly",
    firstName: "Tessaly",
    lastName: "Brookhart",
    preferredFirstName: null,
    salonIds: ["loc-0468"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0468",
    primaryLocationName: "KS Lawrence",
  },
  {
    id: "rowan",
    firstName: "Rowan",
    lastName: "Pell",
    preferredFirstName: null,
    salonIds: ["loc-0468"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0468",
    primaryLocationName: "KS Lawrence",
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
    // The full remap's read. It names no form, so the Coaching Form is chosen from the manager's own words, in any case.
    if (input.tool?.name === "extract_form_fields") {
      return { templateKey: null, employeeName: bag.name, observation: "Late to her shift three times.", actionPlan: null };
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

// The first import of the chat path is slow on a loaded machine.
beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 60_000);

beforeEach(() => {
  for (const flag of PROFILE) vi.stubEnv(flag, "true");
  bag.forms.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

let run = 0;

async function ask(role: Role, question: string, name: string) {
  run += 1;
  bag.name = name;
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      questionMessageId: `msg-role-${run}`,
      conversationId: `conv-remap-role-${run}`,
      context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
    },
    { role, scope: SCOPE, subject: `manager-remap-role-${run}`, verified: true },
    { memoryOwnerId: `manager-remap-role-${run}` },
  );
}

describe.each(VARIANTS)("%s", (question, name) => {
  describe("REMAP_ROLE_CHECK_ENABLED on", () => {
    beforeEach(() => {
      vi.stubEnv("REMAP_ROLE_CHECK_ENABLED", "true");
    });

    it.each(["employee", "assistant_salon_director"] as const)(
      "%s: no card, and the proposal path's refusal",
      async (role) => {
        const response = await ask(role, question, name);
        expect(response.formProposal ?? null).toBeNull();
        expect(response.content).toContain(REFUSAL);
      },
    );

    it("salon_director: today's remap card", async () => {
      const response = await ask("salon_director", question, name);
      expect(response.formProposal?.templateKey).toBe("coaching");
      expect(response.formProposal?.employeeName?.toLowerCase()).toBe(name.toLowerCase());
      expect(response.content).not.toContain("Your role cannot create");
    });
  });

  describe("REMAP_ROLE_CHECK_ENABLED off (today's behaviour, pinned)", () => {
    it.each(["employee", "assistant_salon_director", "salon_director"] as const)(
      "%s: the remap card is shown",
      async (role) => {
        const response = await ask(role, question, name);
        expect(response.formProposal?.templateKey).toBe("coaching");
        expect(response.formProposal?.employeeName?.toLowerCase()).toBe(name.toLowerCase());
        expect(response.content).not.toContain("Your role cannot create");
      },
    );
  });
});
