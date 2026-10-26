import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PORTED FROM ASK BUBBLES (QA B4, B8, G11, 25 OCT 2026) — "TEST EMPLOYEE" ON THE CARD
 * ============================================================================
 *
 * QA's turns in this app's words (salon, Tanning Consultant), through
 * `answerQuestion` with the production profile and NOT_A_NAME_GUARD_ENABLED
 * (live), and again with CA_TEMPLATE_MAP + FORM_CHOICE_STATED (live in
 * production since 25 Oct). The proposal's name reader cannot read "Test
 * Employee" ("Employee" names a form), so the card was for **Test** (and
 * stayed so after "verbal"), and with the pair on, "… at Kearney, NE." put
 * "Ne" on the card, and "… tanning consultant Test Employee at lincoln, ne."
 * asked "Who is this for?". The intent model names nobody here, as in
 * production's traces for these turns.
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
  "NOT_A_NAME_GUARD_ENABLED",
] as const;

const TODAY = "2026-10-24";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /** Names the stand-in model copies when the manager's latest turn holds one. */
  intent: { latest: [] as string[], fromAnywhere: [] as string[] },
  turn: 0,
  /** What production's model read on a turn, by turn index. */
  extra: {} as Record<number, Record<string, unknown>>,
}));

const PEOPLE: DirectoryFact[] = [];

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
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    if (input.tool?.name !== "record_intent_slots") return null;
    const text = JSON.stringify(input.messages ?? []).toLowerCase();
    const latest = text.split("manager:").pop() ?? "";
    const employee =
      [...bag.intent.latest].reverse().find((name) => latest.includes(name.toLowerCase())) ??
      bag.intent.fromAnywhere.find((name) => text.includes(name.toLowerCase())) ??
      null;
    return {
      employee,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: null,
      formTurn: false,
      policyHeading: null,
      ...(bag.extra[bag.turn] ?? {}),
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

// The first import of server-ask is the slow part; under load it alone passed 10s.
beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 120_000);

beforeEach(() => {
  for (const flag of PROFILE) vi.stubEnv(flag, "true");
  bag.forms.clear();
  bag.intent = { latest: [], fromAnywhere: [] };
  bag.extra = {};
  PEOPLE.splice(0, PEOPLE.length);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Turn {
  readonly question: string;
  readonly employeeName: string | null;
  readonly template: string | null;
  readonly role: string | null;
  readonly payrollDeduct: string | null;
  readonly content: string;
}

let run = 0;

/** `recorded` replaces this app's reply with the one production sent, by turn index. */
async function converse(turns: readonly string[], recorded: Readonly<Record<number, string>> = {}): Promise<Turn[]> {
  run += 1;
  const conversationId = `conv-history-names-${run}`;
  const history: ChatMessage[] = [];
  const out: Turn[] = [];
  for (const [index, question] of turns.entries()) {
    bag.turn = index;
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
      { role: "admin" as never, scope: SCOPE, subject: "manager-history-names", verified: true },
      { memoryOwnerId: "manager-history-names" },
    );
    const card = response.formProposal as
      | { employeeName?: string | null; templateName?: string; employeeRole?: string | null; payrollDeduct?: string | null }
      | undefined;
    out.push({
      question,
      employeeName: card?.employeeName ?? null,
      template: card?.templateName ?? null,
      role: card?.employeeRole ?? null,
      payrollDeduct: card?.payrollDeduct ?? null,
      content: response.content,
    });
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

/** The people a reply offers to pick from or confirm: the bold names on a "which of them" / "did you mean" line. */
function offered(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /which of them|did you mean|which person|who is this/i.test(line))
    .flatMap((line) => [...line.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim().toLowerCase()));
}


const TURNS = {
  B4: [
    "create ca form for Test Employee for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching",
    "verbal",
  ],
  B8: [
    "write a verbal CA for Tanning Consultant, Test Employee at Kearney, NE. On 10-20-26 Test Employee was late for shift and did not call supervisor as outlined in attendance policy. payroll deduct is not applicable. previous coaching is JBA Manual 1-1-25",
  ],
  G11: [
    "create a written corrective action for tanning consultant Test Employee at lincoln, ne. location. previous coaching jba manual 1-1-95, verbal ca 10-5-26. payroll deduct is applicable and $25 will be payroll deducted for late open on 10-21-26",
  ],
} as const;

describe.each([
  ["production profile", [] as string[]],
  ["with CA_TEMPLATE_MAP + FORM_CHOICE_STATED (live)", ["CA_TEMPLATE_MAP_ENABLED", "FORM_CHOICE_STATED_ENABLED"]],
])("the card is for Test Employee — %s", (_label, extra) => {
  beforeEach(() => {
    for (const flag of extra) vi.stubEnv(flag, "true");
  });

  it.each(Object.entries(TURNS))("%s", { timeout: 120_000 }, async (_id, turns) => {
    const seen = await converse(turns);
    for (const [index, turn] of seen.entries()) {
      const where = `turn ${index + 1}: ${turns[index]!.slice(0, 50)}`;
      expect(turn.template, where).toBe("Corrective Action Form");
      expect(turn.employeeName, where).toBe("Test Employee");
      expect(offered(turn.content), where).toEqual([]);
      expect(turn.content, where).not.toMatch(/who is this \*\*/i);
    }
  });
});

describe("a salon's state code is not a person", () => {
  it("NE / ne", async () => {
    const { isNotAName } = await import("@/lib/forms/not-a-name");
    expect(isNotAName("NE")).toBe(true);
    expect(isNotAName("ne")).toBe(true);
    expect(isNotAName("Nell")).toBe(false);
  });
});

/*
 * QA G4: conv_mvo1t7qv253555k dropped the employee, conv_mvo1vv4w2on1b4p kept
 * it — the same turns. chat_traces: the title and salon were read the same
 * both times (the code's readers); only the employee differed, and it came
 * only from the intent model's slot (null in one run, "Test Employee" in the
 * other). The stand-in model here names nobody, as in the run that dropped it.
 */
describe("G4: the employee does not depend on the model's slot", () => {
  it.each([
    ["production profile", [] as string[]],
    ["with CA_TEMPLATE_MAP + FORM_CHOICE_STATED (live)", ["CA_TEMPLATE_MAP_ENABLED", "FORM_CHOICE_STATED_ENABLED"]],
  ])("conv_mvo1t7qv253555k — %s", { timeout: 120_000 }, async (_label, extra) => {
    for (const flag of extra) vi.stubEnv(flag, "true");
    bag.extra = { 0: { formType: "coaching" }, 1: { formType: "coaching", title: "Tanning Consultant" } };
    const turns = await converse([
      "Help me prepare a coaching form for not completing daily cleaning duties and signing off on daily cleaning checklists when the tasks are not completed",
      "Okay let's restart. Test Employee, Tanning Consultant, KS Manhattan. Not completing closing duties and signing off that they were complete when they weren't. Not completing proper sanitation procedures on the equipment.",
    ]);
    expect(turns[1]!.employeeName).toBe("Test Employee");
    expect(turns[1]!.content).not.toMatch(/who is this|full name/i);
  });
});

/*
 * Pau, 26 Oct 2026: "lowercase or first letter capitalized, should be like
 * human". QA's turns above, typed the way managers type: all in lower case
 * (with and without the punctuation), and in sentence case with the name
 * typed "test employee" or "Test employee". Each gives the card the same
 * name as "Test Employee". Before the guard read the name in either case, B4
 * put **Test** on the card in every variant, and B8, G11 (with the pair on)
 * and G4 asked who the form was for.
 */
const allLower = (text: string) => text.toLowerCase();
const bare = (text: string) => text.toLowerCase().replace(/[.,!?'’]/g, "").replace(/\s+/g, " ").trim();
const named = (name: string) => (text: string) => text.replace(/Test Employee/g, name);
const REGISTERS: readonly [string, (text: string) => string][] = [
  ["all lower case", allLower],
  ["all lower case, no punctuation", bare],
  ['sentence case, "test employee"', named("test employee")],
  ['sentence case, "Test employee"', named("Test employee")],
];

describe.each([
  ["production profile", [] as string[]],
  ["with CA_TEMPLATE_MAP + FORM_CHOICE_STATED (live)", ["CA_TEMPLATE_MAP_ENABLED", "FORM_CHOICE_STATED_ENABLED"]],
])("typed in lower or sentence case, the card is still for Test Employee — %s", (_label, extra) => {
  beforeEach(() => {
    for (const flag of extra) vi.stubEnv(flag, "true");
  });

  const cases = Object.entries(TURNS).flatMap(([id, turns]) =>
    REGISTERS.map(([register, retype]) => [`${id}, ${register}`, turns.map(retype)] as const),
  );
  it.each(cases)("%s", { timeout: 120_000 }, async (_id, turns) => {
    const seen = await converse(turns);
    for (const [index, turn] of seen.entries()) {
      const where = `turn ${index + 1}: ${turns[index]!.slice(0, 50)}`;
      expect(turn.template, where).toBe("Corrective Action Form");
      expect(turn.employeeName, where).toBe("Test Employee");
      expect(offered(turn.content), where).toEqual([]);
      expect(turn.content, where).not.toMatch(/who is this \*\*/i);
    }
  });

  it.each(REGISTERS)("G4, %s", { timeout: 120_000 }, async (_register, retype) => {
    bag.extra = { 0: { formType: "coaching" }, 1: { formType: "coaching", title: "Tanning Consultant" } };
    const turns = await converse(
      [
        "Help me prepare a coaching form for not completing daily cleaning duties and signing off on daily cleaning checklists when the tasks are not completed",
        "Okay let's restart. Test Employee, Tanning Consultant, KS Manhattan. Not completing closing duties and signing off that they were complete when they weren't. Not completing proper sanitation procedures on the equipment.",
      ].map(retype),
    );
    expect(turns[1]!.employeeName).toBe("Test Employee");
    expect(turns[1]!.content).not.toMatch(/who is this|full name/i);
  });
});

describe("the typed-name reader, in either case", () => {
  it("guard on: lower case and sentence case read as the capitalised name", async () => {
    const { typedEmployeeName } = await import("@/lib/forms/typed-employee-name");
    for (const text of [
      "create ca form for Test Employee for violating attendance policy",
      "create ca form for test employee for violating attendance policy",
      "create ca form for Test employee for violating attendance policy",
      "okay lets restart test employee tanning consultant ks manhattan",
      "Okay let's restart. Test employee, Tanning Consultant, KS Manhattan.",
    ]) {
      expect(typedEmployeeName(text), text).toBe("Test Employee");
    }
  });

  it("guard on: a lower-case word before 'employee' is not a name unless it is QA's 'test'", async () => {
    const { typedEmployeeName } = await import("@/lib/forms/typed-employee-name");
    for (const text of [
      "write a ca for a late employee at kearney",
      "coaching for a rude employee",
      "create a coaching form for my employee",
      "a form for the test employee handbook",
      "is there a test employee form",
      "coaching for New Employee orientation",
      "coaching for test employees",
      "the employee dress code for test",
    ]) {
      expect(typedEmployeeName(text), text).toBeNull();
    }
  });

  it("guard off: unchanged — only the capitalised name is read", async () => {
    vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "false");
    const { typedEmployeeName } = await import("@/lib/forms/typed-employee-name");
    expect(typedEmployeeName("create ca form for Test Employee for violating attendance policy")).toBe("Test Employee");
    expect(typedEmployeeName("create ca form for test employee for violating attendance policy")).toBeNull();
    expect(typedEmployeeName("create ca form for Test employee for violating attendance policy")).toBeNull();
  });
});
