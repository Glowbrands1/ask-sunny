import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { correctiveActionDocument } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * B13 P0 ROWS, PORTED FROM THE SIBLING APP — REMAP_INCIDENT_FIX + PRIOR_ACTIONS_PARSE
 * ============================================================================
 *
 * The sibling app's live tester (25 Oct 2026, both flags on in production)
 * found four rows that got worse; the same mechanisms run here. Each turn is
 * the sibling manager's, word for word, told with this app's salons and job
 * titles, through `answerQuestion` with this app's production flag profile
 * (intent extraction on) and both flags on:
 *
 *   G11  "jba manual 1-1-95" must be 01/01/1995, not 2095; a clause that only
 *        names or places the employee is never What happened.
 *   B4   "jba manual 1-1-26 for previous coaching" is a prior action, never
 *        What happened; a new create request with its own incident starts
 *        with no priors unless the manager restates them.
 *   Q7   What happened keeps "late to open", not the prior's "being late".
 *   H7   "create a coaching document for … regarding On 10-16-26 …" is the
 *        request; a bare repeat request keeps the incident.
 */

const TODAY = "2026-10-25";

const FLAGS = [
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
  "FULL_MANUAL_CONTEXT_ENABLED",
] as const;

const UNDER_TEST = ["REMAP_INCIDENT_FIX_ENABLED", "PRIOR_ACTIONS_PARSE_ENABLED"] as const;

const UNSET = [
  "CODE_SLOTS_ENABLED",
  "FORM_STATE_ENABLED",
  "FORM_FULL_REMAP_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "CHAT_MEMORY_ENABLED",
  "SELF_CHECK_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
  "CHAT_DATA_TOOLS_ENABLED",
] as const;

const stateBag = vi.hoisted(() => ({ forms: new Map<string, unknown>() }));

/** What the intent model copies from the manager's words. Nothing is guessed. */
const intentModel = vi.hoisted(() => ({
  reading: null as null | ((manager: string) => Record<string, unknown>),
}));

const PEOPLE: DirectoryFact[] = [
  {
    id: "wren",
    firstName: "Wren",
    lastName: "Halvorsen",
    preferredFirstName: null,
    salonIds: ["loc-0309"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0309",
    primaryLocationName: "NE Kearney",
  },
  {
    id: "test-employee",
    firstName: "Test",
    lastName: "Employee",
    preferredFirstName: null,
    salonIds: ["loc-0309"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0309",
    primaryLocationName: "NE Kearney",
  },
];

function template(overrides: Record<string, unknown>) {
  return {
    id: "tpl",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "A coaching conversation.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published", variants: [] },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

const LIBRARY = [
  template({}),
  template({
    id: "tpl-dpoa",
    key: "dpoa",
    name: "Corrective Action Form",
    shortName: "CA",
    description: "A corrective action.",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    currentVersion: { id: "v-dpoa", status: "published", document: correctiveActionDocument(), variants: [] },
  }),
];

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
  loadFormState: async (userId: string, conversationId: string) =>
    stateBag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    stateBag.forms.set(`${userId}:${conversationId}`, state);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "late-open";
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
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name !== "record_intent_slots") return null;
    const text = JSON.stringify(input.messages ?? []);
    const manager = (text.split("Manager:").pop() ?? text).replace(/\\n/g, "\n");
    return intentModel.reading ? intentModel.reading(manager) : null;
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

// The app's whole chat path is imported once; under load that takes longer than the default hook timeout.
beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 60_000);

beforeEach(() => {
  stateBag.forms.clear();
  intentModel.reading = null;
  for (const name of FLAGS) vi.stubEnv(name, "1");
  for (const name of UNSET) vi.stubEnv(name, "");
  for (const name of UNDER_TEST) vi.stubEnv(name, "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type Answer = Awaited<ReturnType<typeof answerQuestion>>;

/** Each manager turn in order, with the replies the app gave as history. */
async function chat(turns: readonly string[], conversationId: string): Promise<Answer[]> {
  const history: ChatMessage[] = [];
  const answers: Answer[] = [];
  for (const [index, question] of turns.entries()) {
    const response = await answerQuestion(
      {
        question,
        mode: "standard",
        history: [...history],
        scopeId: "stc-core",
        questionMessageId: `msg-${conversationId}-${index}`,
        conversationId,
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "district_manager", scope: SCOPE, subject: "manager-late-open", verified: true },
      { memoryOwnerId: "manager-late-open" },
    );
    answers.push(response);
    history.push({ id: `u-${index}`, role: "user", content: question, createdAt: `${TODAY}T19:41:5${index}Z` });
    history.push({
      id: `a-${index}`,
      role: "assistant",
      content: response.content,
      createdAt: `${TODAY}T19:41:5${index}Z`,
      ...(response.formProposal ? { formProposal: response.formProposal } : {}),
    } as ChatMessage);
  }
  return answers;
}

/** A faithful copy of the manager's words: the date exactly as typed, no policy guessed. */
function copiesTheManager(manager: string): Record<string, unknown> {
  const date = /\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/.exec(manager)?.[0] ?? null;
  return {
    employee: /test employee/i.test(manager) ? "Test Employee" : null,
    salon: /kearney/i.test(manager) ? "NE Kearney" : null,
    title: null,
    incidentType: null,
    incidentDate: date,
    payrollAmount: null,
    warningLevel: /\bverbal\b/i.test(manager) ? "verbal" : null,
    formType: /\b(?:ca|corrective action)\b/i.test(manager) ? "corrective action" : /coaching document/i.test(manager) ? "coaching" : null,
    formTurn: true,
    policyHeading: null,
  };
}

function whatHappened(content: string): string | null {
  return /\*\*(?:Observation of Offense|What happened):\*\*\s*([^\n]+)/.exec(content)?.[1]?.trim() ?? null;
}

function priorLine(content: string): string | null {
  const line = /\*\*Prior actions:\*\*\s*([^\n]+)/.exec(content)?.[1];
  return line ? line.replace(/, as you said\b.*$/, "") : null;
}

const G11 =
  "create a written corrective action for tan consultant Test Employee at grand island, ne. location. previous coaching jba manual 1-1-95, verbal ca 10-5-26. payroll deduct is applicable and $25 will be payroll deducted for late open on 10-21-26";
const B4 = [
  "create ca form for Test Employee for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching",
  "verbal",
  "create ca form for Test Employee for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check. previous coaching - jba policy manual 1-20-26.",
];
const Q7 = "create a CA for Test Employee at Kearney, late to open on 10-20, she was coached on 9-15 for being late";
const H7 = [
  "create a coaching document for Test Employee regarding On 10-16-26 Test Employee did not complete her closing checklist",
  "create a coaching document for Test Employee",
  "create a coaching document for Test Employee",
];

describe("B13 P0 rows, both flags on (production flags too)", () => {
  beforeEach(() => {
    intentModel.reading = copiesTheManager;
  });

  it("G11: 1-1-95 is 1995, and What happened is not the person or the salon", async () => {
    const [reply] = await chat([G11], "conv-b13-g11");
    expect(priorLine(reply!.content)).toContain("01/01/1995");
    expect(priorLine(reply!.content)).not.toContain("2095");
    // What happened is the late open the payroll answer is for, not "tan consultant at grand island".
    expect(whatHappened(reply!.content)).toBe("late open on 10-21-26");
  });

  it("B4 turns 1-2: the prior is never What happened", async () => {
    const [first, second] = await chat(B4.slice(0, 2), "conv-b13-b4a");
    for (const reply of [first!, second!]) {
      expect(whatHappened(reply.content)).toBe("violating attendance policy on 10-20-26");
      expect(priorLine(reply.content)).toBe("Coaching — JBA Policy Manual — 01/01/2026");
    }
  });

  it("B4 turn 3: a new CA with its own incident starts with its own prior only", async () => {
    const third = (await chat(B4, "conv-b13-b4b")).at(-1)!;
    expect(whatHappened(third.content)).toBe("a register shortage on 10-20-26");
    expect(priorLine(third.content)).toBe("Coaching — JBA Policy Manual — 01/20/2026");
  });

  it("Q7: What happened keeps the incident's own words, late to open", async () => {
    const [reply] = await chat([Q7], "conv-b13-q7");
    expect(whatHappened(reply!.content)).toBe("late to open on 10-20");
    expect(priorLine(reply!.content)).toBe("Coaching for being late — 09/15/2026");
  });

  it("H7: the request words go, and a bare repeat request keeps the incident", async () => {
    const replies = await chat(H7, "conv-b13-h7");
    for (const reply of replies) {
      expect(whatHappened(reply.content)).toBe("did not complete her closing checklist");
    }
  });
});
