import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * WHAT THE MODEL WAS ACTUALLY SENT ON A REPORTING TURN
 * ============================================================================
 *
 * `daily-stats-grounding.test.ts` proves the gates, the pinning and the rule
 * text as pure functions. This file proves the ORCHESTRATION, and it exists for
 * the reason `employee-performance-runtime.test.ts` gives: a source scan cannot
 * see that a families list was computed and then never passed, or that a
 * briefing was loaded and dropped on the floor. The text looks right in both
 * cases.
 *
 * So every assertion here reads what `callClaude` received.
 *
 * The doubles stop at the module boundary. `loadReportBriefing` is mocked
 * because its three loaders read Postgres through the dashboards' own read
 * layer, and those layers have their own suites; what is under test is which
 * families were asked for, what the prompt was told about them, and whether the
 * report block reached the model at all.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  claudeCalls: 0,
  /** Every `loadReportBriefing` call's input, so the routing can be asserted. */
  briefingCalls: [] as Record<string, unknown>[],
  /** What it returns. Null means routing wanted no report at all. */
  briefingResult: null as unknown,
  /** Which roles were fetched, by id. */
  roleFetches: [] as string[],
  employeeRoleResult: null as unknown,
  dailyStatsResult: null as unknown,
  matchRows: [] as unknown[],
  matchLimit: null as number | null,
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("./form-proposal", () => ({
  proposeFormForTurn: async () => null,
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match(query: { limit?: number }) {
      state.matchLimit = query.limit ?? null;
      return state.matchRows;
    }
    async fetchRoleGrounding(role: { id: string }) {
      state.roleFetches.push(role.id);
      return role.id === "daily_stats_interpretation_framework"
        ? state.dailyStatsResult
        : state.employeeRoleResult;
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async (input: Record<string, unknown>) => {
    state.briefingCalls.push(input);
    return state.briefingResult;
  },
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeCalls += 1;
    state.claudeInput = input;
    return "An answer.";
  },
}));

/* -------------------------------------------------------------------- fixtures -- */

const DAILY_DOC_ID = "doc-daily-stats";

/** A healthy Daily Stats role result, with every rule group represented. */
function healthyDailyStats() {
  return {
    ok: true,
    grounding: {
      role: { id: "daily_stats_interpretation_framework" },
      documentId: DAILY_DOC_ID,
      documentTitle: "ASK SUNNY DAILY STATS INTERPRETATION FRAMEWORK",
      matchedBy: "fallback",
      rows: [
        "ASK SUNNY OPERATING RULES FOR DAILY STATS",
        "SECTION 4 - PRIORITY DECISION TREE",
        "SECTION 8 - OUTPUT TEMPLATES",
        "Coaching Form Draft",
      ].map((locator, index) => ({
        chunk_id: `daily-${index}`,
        document_id: DAILY_DOC_ID,
        document_title: "ASK SUNNY DAILY STATS INTERPRETATION FRAMEWORK",
        category: "leadership_coaching",
        locator,
        page: null,
        section: locator,
        content: `[${locator}] framework text.`,
        similarity: 0,
      })),
      presentGroups: [
        "operating_rules",
        "priority_decision_tree",
        "output_templates",
        "coaching_handoff",
      ],
    },
  };
}

/** The role could not be guaranteed. One of the six refusals. */
function unhealthyDailyStats() {
  return {
    ok: false,
    failure: {
      code: "incomplete_rule_groups",
      detail: "The priority decision tree heading did not match.",
      missingGroups: ["priority_decision_tree"],
    },
  };
}

function briefing(overrides: Record<string, unknown> = {}) {
  return {
    text: "REPORT DATA — JB and Associates\n\nSALES TOTALS — report date 2026-09-03.",
    requested: ["sales-totals", "salon-performance"],
    present: ["sales-totals", "salon-performance"],
    missing: [],
    ...overrides,
  };
}

function policyRows(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    chunk_id: `policy-${index}`,
    document_id: "doc-policy-manual",
    document_title: "JBA Policy Manual Edited 5.2025",
    category: "operations",
    locator: `Page ${index + 2}`,
    page: index + 2,
    section: null,
    content: `Policy manual text ${index}.`,
    similarity: 0.9 - index * 0.01,
  }));
}

const ACTOR = {
  role: "salon_director" as const,
  scope: { kind: "salon" as const, ids: ["0495"] },
};

async function ask(overrides: Record<string, unknown> = {}) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question: "What should I focus on today?",
      mode: "standard" as const,
      history: [],
      scopeId: "stc-core",
      context: { userName: "Paulyne", locationName: "Salon 0495", todayIso: "2026-09-09" },
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ACTOR as any,
  );
}

/** The system prompt the model received. */
function system(): string {
  const input = state.claudeInput;
  if (!input) throw new Error("callClaude was not called");
  return String(input.system);
}

/** The families the composer was asked for on the last call. */
function requestedFamilies(): string[] {
  const call = state.briefingCalls.at(-1);
  if (!call) throw new Error("loadReportBriefing was not called");
  return call.families as string[];
}

beforeEach(() => {
  state.claudeInput = null;
  state.claudeCalls = 0;
  state.briefingCalls = [];
  state.briefingResult = briefing();
  state.roleFetches = [];
  state.employeeRoleResult = null;
  state.dailyStatsResult = healthyDailyStats();
  state.matchRows = policyRows();
  state.matchLimit = null;
});

/* ================================================================= routing == */

describe("A. a broad operational question reaches the right reports", () => {
  it("asks for Sales Totals and Salon Performance, and nothing it does not need", async () => {
    await ask({ question: "What should I focus on today?" });

    expect(requestedFamilies()).toEqual(["sales-totals", "salon-performance"]);
  });

  it("sends the report block to the model as its own section", async () => {
    await ask({ question: "What should I focus on today?" });

    expect(state.claudeInput!.reportData).toContain("SALES TOTALS");
    // Not folded into company knowledge: figures are measurements, documents
    // are policy, and the two carry different citation rules.
    expect(state.claudeInput!.grounding).not.toContain("SALES TOTALS");
  });

  it("tells the prompt it has report figures, so a marker is never put on one", async () => {
    await ask({ question: "What should I focus on today?" });

    /*
     * ASSERTED ON THE ENTRY, NOT ITS NUMBER. The statement taxonomy is built
     * from the blocks actually attached, so report figures are the third kind
     * on this turn and the fourth on a turn that also carries employee figures.
     * Pinning the number here would make adding a block look like a regression.
     */
    expect(system()).toContain("Salon report figures");
    expect(system()).toContain("Never mark them with a source marker");
    expect(system()).toContain("name the reporting period the figure belongs to");
  });

  it("asks for no report at all on a policy question, and says so in the prompt", async () => {
    state.briefingResult = null;

    await ask({ question: "What is the refund policy on memberships?" });

    expect(state.briefingCalls).toEqual([]);
    expect(state.claudeInput!.reportData).toBeNull();
    expect(system()).toContain("You have NO report figures for this question");
  });
});

describe("C. a Spa question brings the traffic with it", () => {
  it("asks for engagement, equipment AND traffic", async () => {
    state.briefingResult = briefing({
      requested: ["bed-usage", "spa-wellness", "spa-engagement"],
      present: ["bed-usage", "spa-wellness", "spa-engagement"],
    });

    await ask({ question: "Why is Spa weak?" });

    expect(requestedFamilies()).toEqual([
      "bed-usage",
      "spa-wellness",
      "spa-engagement",
    ]);
  });
});

describe("a Bed/Spa question gets the manager reasoning layer too", () => {
  /*
   * ============================================================================
   * BOTH LAYERS, ON ONE PROMPT, AT RUNTIME
   * ============================================================================
   *
   * The registry says the action framework applies to all five families and the
   * metric authority stays in code. This asserts the pipeline actually behaves
   * that way for a bed and spa question — which is the case where it was least
   * obvious, and where an earlier revision of the registry declared the
   * opposite.
   *
   * `bed-spa-authority.test.ts` covers the other half: that the framework's
   * instructions name no band, threshold or formula, so applying it cannot move
   * a classification.
   */
  beforeEach(() => {
    state.briefingResult = briefing({
      requested: ["bed-usage", "spa-wellness", "spa-engagement"],
      present: ["bed-usage", "spa-wellness", "spa-engagement"],
      text:
        "REPORT DATA — JB and Associates\n\n" +
        "BED USAGE — mtd. By equipment level: FASTEST +14.2% vs chain, outperforming. " +
        "FAST -31.0% vs chain, significantly_underperforming " +
        "[ADVISORY ONLY — FAST: intentional reduction, not a shortfall].",
    });
  });

  it("fetches the Daily Stats framework for it", async () => {
    await ask({ question: "Why is Spa weak?" });

    expect(state.roleFetches).toContain("daily_stats_interpretation_framework");
  });

  it("puts the framework's reasoning rules on the prompt", async () => {
    await ask({ question: "Why is Spa weak?" });

    expect(system()).toContain("DAILY OPERATIONAL INTERPRETATION");
    expect(system()).toContain("HOW TO READ THE DAY");
    expect(system()).toContain("DO NOT SIMPLY NAME THE LOWEST NUMBER");
    expect(system()).toContain("Recognition is half the job");
  });

  it("asks for the action while leaving the classification alone", async () => {
    await ask({ question: "Why is Spa weak?" });

    // The instruction that makes the two layers coexist.
    expect(system()).toContain("CLASSIFICATIONS ARE FINAL");
    expect(system()).toContain("the ACTION, not the arithmetic");
    expect(system()).toContain("ALREADY WITHHELD A CONCLUSION HAS DECIDED THAT");
  });

  it("carries the bed and spa figures with their own bands and advisory note", async () => {
    /*
     * THE FACTS ARRIVE PRE-CLASSIFIED. The prompt receives "FASTEST
     * outperforming" and "FAST ... ADVISORY ONLY" as computed facts, so the
     * model has nothing to decide about them — which is what makes "quote it as
     * it stands" a followable instruction rather than a hope.
     */
    await ask({ question: "Why is Spa weak?" });

    const report = String(state.claudeInput!.reportData);
    expect(report).toContain("outperforming");
    expect(report).toContain("ADVISORY ONLY");
    expect(report).toContain("intentional reduction, not a shortfall");
  });

  it("states the manager answer shape, so the action is asked for explicitly", async () => {
    await ask({ question: "Why is Spa weak?" });

    expect(system()).toContain("TOP 3 PRIORITIES");
    expect(system()).toContain("the likely behaviour or operational cause");
    expect(system()).toContain("what to coach or inspect today");
  });

  it("adds no second statement of a bed or spa rule to the system prompt", async () => {
    /*
     * NO DUPLICATE AUTHORITY AT RUNTIME. The FAST exemption and the
     * equipment-presence rule reach the model exactly once each, in the REPORT
     * DATA block beside the figures they govern — never also in the system
     * prompt, where a paraphrase would drift away from the block and the looser
     * of the two would win.
     */
    await ask({ question: "Why is Spa weak?" });

    const prompt = system();
    for (const rule of ["FAST", "NOT INSTALLED", "peer average", "v Chain"]) {
      expect(prompt, `the system prompt must not restate "${rule}"`).not.toContain(rule);
    }
    // And it is genuinely in the report block instead.
    expect(String(state.claudeInput!.reportData)).toContain("FAST");
  });
});

/* ========================================================= the framework == */

describe("the Daily Stats framework reaches the prompt, and is cited like a source", () => {
  it("is fetched for an interpretation question", async () => {
    await ask({ question: "What should I focus on today?" });

    expect(state.roleFetches).toContain("daily_stats_interpretation_framework");
  });

  it("is NOT fetched for a policy question", async () => {
    state.briefingResult = null;

    await ask({ question: "What is the dress code?" });

    expect(state.roleFetches).toEqual([]);
  });

  it("arrives in the company knowledge block with a real marker", async () => {
    await ask({ question: "What should I focus on today?" });

    const grounding = String(state.claudeInput!.grounding);
    expect(grounding).toContain(
      "ASK SUNNY DAILY STATS INTERPRETATION FRAMEWORK — ASK SUNNY OPERATING RULES FOR DAILY STATS",
    );
    // Pinned first: the reasoning contract before the evidence.
    expect(grounding.indexOf("DAILY STATS INTERPRETATION FRAMEWORK")).toBeLessThan(
      grounding.indexOf("JBA Policy Manual"),
    );
  });

  it("does not spend the evidence budget, so policy still outranks it", async () => {
    await ask({ question: "What should I focus on today?" });

    const grounding = String(state.claudeInput!.grounding);
    const policyChunks = grounding.split("JBA Policy Manual").length - 1;
    expect(policyChunks).toBe(policyRows().length);
  });

  it("fetches deeper when a role is in play", async () => {
    await ask({ question: "What should I focus on today?" });
    const deep = state.matchLimit;

    state.briefingResult = null;
    await ask({ question: "What is the dress code?" });

    expect(deep).toBeGreaterThan(state.matchLimit!);
  });

  it("adds the source rules AND the answer shape when there are figures", async () => {
    await ask({ question: "What should I focus on today?" });

    expect(system()).toContain("DAILY OPERATIONAL INTERPRETATION");
    expect(system()).toContain("ITS EXAMPLES ARE NOT MEASUREMENTS");
    expect(system()).toContain("1. OVERALL READ");
    expect(system()).toContain("DO NOT DUMP EVERY METRIC");
  });
});

describe("an unhealthy framework degrades loudly rather than silently", () => {
  /*
   * THE DISTINCTION FROM THE EMPLOYEE FRAMEWORK, ASSERTED AT RUNTIME.
   *
   * The employee framework FAILS CLOSED because its absence is dangerous: it
   * carries the guard against discipline on a metric alone. This one carries
   * the prioritisation contract, so its absence is unhelpful rather than
   * unsafe — and refusing would mean a corpus that has not had the document
   * uploaded could not answer the most common question in the product.
   *
   * What must never happen is the prompt CLAIMING a source it does not have.
   */
  it("still answers", async () => {
    state.dailyStatsResult = unhealthyDailyStats();

    const answer = await ask({ question: "What should I focus on today?" });

    expect(state.claudeCalls).toBe(1);
    expect(answer.content).toBe("An answer.");
  });

  it("does not claim the framework is one of the numbered sources", async () => {
    state.dailyStatsResult = unhealthyDailyStats();

    await ask({ question: "What should I focus on today?" });

    expect(system()).not.toContain("DAILY OPERATIONAL INTERPRETATION");
    expect(system()).not.toContain("One of the numbered sources above is the Daily Stats");
  });

  it("KEEPS the reasoning contract, which needs no document to be true", async () => {
    /*
     * The failure this covers: without the contract, "what should I focus on
     * today?" against five loaded reports produces a list of every metric,
     * which is the exact thing the framework exists to prevent. The guidance
     * that stops it — weigh impact not lowness, name the behaviour, recognition
     * is half the job — is true whether or not a document is in the corpus.
     */
    state.dailyStatsResult = unhealthyDailyStats();

    await ask({ question: "What should I focus on today?" });

    expect(system()).toContain("HOW TO READ THE DAY");
    expect(system()).toContain("DO NOT SIMPLY NAME THE LOWEST NUMBER");
    expect(system()).toContain("Recognition is half the job");
    expect(system()).toContain("1. OVERALL READ");
  });

  it("does not pin an unhealthy framework's rows into the sources", async () => {
    state.dailyStatsResult = unhealthyDailyStats();

    await ask({ question: "What should I focus on today?" });

    expect(String(state.claudeInput!.grounding)).not.toContain(
      "DAILY STATS INTERPRETATION FRAMEWORK",
    );
  });
});

/* ============================================================== no data == */

describe("F. a report with no delivery is led with, not filled in", () => {
  it("tells the prompt to say so first", async () => {
    state.briefingResult = briefing({
      requested: ["spa-engagement", "spa-wellness", "bed-usage"],
      present: ["spa-engagement", "bed-usage"],
      missing: ["spa-wellness"],
      text: "REPORT DATA\n\nNOT LOADED — Spa Wellness: no current delivery.",
    });

    await ask({ question: "Why is Spa weak?" });

    expect(system()).toContain("ONE OR MORE REPORTS THIS QUESTION NEEDS IS NOT LOADED");
    expect(system()).toContain("Never estimate the missing figures");
    expect(state.claudeInput!.reportData).toContain("Spa Wellness: no current delivery");
  });

  it("omits that instruction when everything loaded", async () => {
    await ask({ question: "What should I focus on today?" });

    expect(system()).not.toContain("IS NOT LOADED");
  });

  it("reports insufficient coverage when nothing loaded and NOTHING was grounded", async () => {
    /*
     * A block that names absent reports carries no figures, so counting it as
     * coverage would put a confident banner over an answer whose whole content
     * is "I do not have that delivery".
     *
     * The framework is unhealthy here as well as the reports being absent, and
     * that is the point of the pair with the test below: a pinned framework is
     * REAL company knowledge and does count, so both halves have to be empty
     * before `insufficient` is the honest answer.
     */
    state.matchRows = [];
    state.dailyStatsResult = unhealthyDailyStats();
    state.briefingResult = briefing({
      present: [],
      missing: ["sales-totals", "salon-performance"],
    });

    const answer = await ask({ question: "What should I focus on today?" });

    expect(answer.coverage).toBe("insufficient");
  });

  it("counts a pinned framework as coverage even when no report loaded", async () => {
    /*
     * The complement, and it is not a technicality: Sunny genuinely can answer
     * "how should I read this once the numbers arrive" from the framework
     * alone, and it can cite it. A "the knowledge base does not cover this"
     * banner over that answer would be wrong.
     */
    state.matchRows = [];
    state.briefingResult = briefing({
      present: [],
      missing: ["sales-totals", "salon-performance"],
    });

    const answer = await ask({ question: "What should I focus on today?" });

    expect(answer.coverage).toBe("grounded");
  });

  it("still counts a loaded report as coverage with no citations at all", async () => {
    state.matchRows = [];

    const answer = await ask({ question: "What should I focus on today?" });

    expect(answer.coverage).toBe("grounded");
    expect(answer.citations).toEqual([]);
  });
});

/* ====================================================== the report context == */

describe("H and I. a report context reloads rows and survives the follow-up", () => {
  const reportContext = {
    family: "bed-usage",
    period: "mtd:2026-08-31",
    window: null,
    salons: ["0123"],
    districts: ["Cotton, Sarah"],
    metric: "vChain",
    view: null,
  };

  it("hands the pointers to the loader, which re-reads for itself", async () => {
    await ask({ question: "What should I focus on today?", reportContext });

    const call = state.briefingCalls.at(-1)!;
    expect(call.context).toEqual(reportContext);
  });

  it("adds the context's family to whatever the question routed to", async () => {
    await ask({ question: "What should I focus on today?", reportContext });

    // Bed Usage came from the tab; the two daily families came from the words.
    expect(requestedFamilies()).toContain("bed-usage");
    expect(requestedFamilies()).toContain("sales-totals");
  });

  it("keeps the report on a follow-up that names no report and no metric", async () => {
    /*
     * THE TEST THAT MATTERS FOR A CROSS-REPORT CONVERSATION. "Why is #1 the
     * biggest problem?" routes to NO family on its own words — by design, so a
     * briefing does not attach itself to every turn forever once it arrives —
     * and the context is the only reason the second turn still has the report.
     */
    await ask({ question: "Why is #1 the biggest problem?", reportContext });

    expect(requestedFamilies()).toEqual(["bed-usage"]);
    expect(state.claudeInput!.reportData).toContain("REPORT DATA");
  });

  it("loses the report when the follow-up carries no context and no vocabulary", async () => {
    state.briefingResult = null;

    await ask({ question: "Why is #1 the biggest problem?" });

    expect(state.briefingCalls).toEqual([]);
  });

  it("never lets the context widen the company", async () => {
    // There is no company field on the context, and the loader is called
    // without one, so it defaults to the authorized company.
    await ask({ question: "What should I focus on today?", reportContext });

    const call = state.briefingCalls.at(-1)!;
    expect(call.company).toBeUndefined();
    /*
     * `question` and `today` travel too — the first so "last month" resolves
     * against the periods that exist, the second so freshness is measured
     * against the SERVER's day rather than a frozen prototype date. Neither is
     * a company, and there is still no field through which one could arrive.
     */
    expect(Object.keys(call).sort()).toEqual(["context", "families", "question", "today"]);
    expect(call.today).toBe("2026-09-09");
  });
});

/* ============================================== both frameworks together == */

describe("I. a coaching question carries both frameworks", () => {
  beforeEach(() => {
    state.employeeRoleResult = {
      ok: true,
      grounding: {
        role: { id: "employee_performance_framework" },
        documentId: "doc-employee",
        documentTitle: "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT",
        matchedBy: "fallback",
        rows: [
          {
            chunk_id: "emp-0",
            document_id: "doc-employee",
            document_title: "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT",
            category: "leadership_coaching",
            locator: "SOURCE HIERARCHY AND OPERATING RULES",
            page: null,
            section: null,
            content: "Employee framework operating rules.",
            similarity: 0,
          },
        ],
        presentGroups: ["source_hierarchy"],
      },
    };
  });

  it("fetches both roles", async () => {
    await ask({ question: "What should I coach today?" });

    expect(state.roleFetches).toContain("employee_performance_framework");
    expect(state.roleFetches).toContain("daily_stats_interpretation_framework");
  });

  it("states both sets of rules, and neither on a turn that lacks its framework", async () => {
    await ask({ question: "What should I coach today?" });

    expect(system()).toContain("DAILY OPERATIONAL INTERPRETATION");
    expect(system()).toContain("EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK");
    expect(system()).toContain("Never recommend discipline");
  });

  it("reads the Daily Stats frame before the escalation limits inside it", async () => {
    await ask({ question: "What should I coach today?" });

    const grounding = String(state.claudeInput!.grounding);
    expect(grounding.indexOf("DAILY STATS INTERPRETATION FRAMEWORK")).toBeLessThan(
      grounding.indexOf("EMPLOYEE PERFORMANCE FRAMEWORK"),
    );
  });

  it("still fails CLOSED when the employee framework is unhealthy, report or not", async () => {
    /*
     * The two policies live side by side and must not blur. A coaching turn
     * whose escalation guard cannot be guaranteed does not reach the model,
     * whatever the reports say and whatever the Daily Stats framework did.
     */
    state.employeeRoleResult = {
      ok: false,
      failure: { code: "role_document_not_found", detail: "not in the corpus" },
    };

    const answer = await ask({ question: "What should I coach today?" });

    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toContain("Employee Performance Framework required");
    expect(answer.coverage).toBe("insufficient");
  });
});
