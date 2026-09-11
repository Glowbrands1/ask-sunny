import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE PROGRESSION FRAMEWORK, AT RUNTIME
 * ============================================================================
 *
 * Three properties, none of which a source scan can establish:
 *
 *   1. AN EMPLOYEE-PERFORMANCE TURN CARRIES BOTH FRAMEWORKS. The two gates were
 *      independent, so "who should I coach from this report?" identified the
 *      right person and then recommended a management response with nothing
 *      governing which rung it could reach.
 *
 *   2. "ALL OF IT" STILL MEANS CORRECTIVE ACTION. The acceptance conversation's
 *      second turn is a fragment, and reading it alone lost the framework on the
 *      turn that asks for the whole ladder.
 *
 *   3. AN INTERVENING QUESTION CLEARS IT. The same walk that carries the
 *      fragment must not become a topic memory.
 *
 * Asserted on WHAT THE MODEL WAS SENT, or on the fact that it was not called.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  claudeCalls: 0,
  matchLimit: null as number | null,
  /** Role id -> result, and the ids actually asked for, in order. */
  roleResults: {} as Record<string, unknown>,
  roleCalls: [] as string[],
  templates: [] as unknown[],
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

// Not the subject here: the Forms gates are covered in their own suites, and a
// proposal would short-circuit the grounded path this file is about.
vi.mock("./form-proposal", () => ({ proposeFormForTurn: async () => null }));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => state.templates,
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match(query: { limit?: number }) {
      state.matchLimit = query.limit ?? null;
      return [
        {
          chunk_id: "kb-1",
          document_id: "doc-manual",
          document_title: "JBA Policy Manual",
          category: "policies_compliance",
          locator: "Page 12",
          page: 12,
          section: null,
          content: "Policy manual text.",
          similarity: 0.8,
        },
      ];
    }
    async fetchRoleGrounding(role: { id: string }) {
      state.roleCalls.push(role.id);
      return state.roleResults[role.id] ?? null;
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () => null,
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => ({ available: false, block: null, reason: "no dataset" }),
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeCalls += 1;
    state.claudeInput = input;
    return "An answer citing [S1].";
  },
}));

/* ------------------------------------------------------------- fixtures -- */

const EMPLOYEE_ID = "employee_performance_framework";
const PROGRESSION_ID = "performance_management_framework";

function roleRows(documentId: string, title: string, locators: string[]) {
  return locators.map((locator, index) => ({
    chunk_id: `${documentId}-${index}`,
    document_id: documentId,
    document_title: title,
    category: "leadership_coaching",
    locator,
    page: null,
    section: locator,
    content: `Framework text: ${locator}.`,
    similarity: 0,
  }));
}

function healthyEmployee() {
  return {
    ok: true as const,
    grounding: {
      role: { id: EMPLOYEE_ID },
      documentId: "doc-employee",
      documentTitle: "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT",
      matchedBy: "tag" as const,
      rows: roleRows("doc-employee", "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT", [
        "SOURCE HIERARCHY AND OPERATING RULES",
        "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
      ]),
      presentGroups: ["source_hierarchy", "escalation_guard"],
    },
  };
}

function healthyProgression() {
  return {
    ok: true as const,
    grounding: {
      role: { id: PROGRESSION_ID },
      documentId: "doc-progression",
      documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
      matchedBy: "tag" as const,
      rows: roleRows("doc-progression", "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT", [
        "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK",
        "SECTION 2 – PERFORMANCE MANAGEMENT LADDER",
        "SECTION 6 – DPOA FRAMEWORK",
      ]),
      presentGroups: ["escalation_authority", "escalation_ladder", "dpoa_framework"],
    },
  };
}

const DOWN = { ok: false, failure: { code: "role_document_not_found", detail: "x" } };

function manager(id: string, content: string) {
  return { id, role: "user", content, createdAt: "2026-09-09T10:00:00Z" };
}

async function ask(
  question: string,
  history: { id: string; role: string; content: string }[] = [],
) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: history as never,
      scopeId: "sun-tan-city",
      context: { userName: "Dana Reyes", locationName: "MO Kansas City Wornall", todayIso: "2026-09-09" },
    } as never,
    {
      role: "salon_director" as never,
      scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
    },
  );
}

const grounding = () => String(state.claudeInput?.grounding ?? "");

beforeEach(() => {
  vi.resetModules();
  state.claudeInput = null;
  state.claudeCalls = 0;
  state.matchLimit = null;
  state.roleCalls = [];
  state.roleResults = {
    [EMPLOYEE_ID]: healthyEmployee(),
    [PROGRESSION_ID]: healthyProgression(),
  };
  state.templates = [];
});

/* ==================================================================== */
/*  1. BOTH FRAMEWORKS                                                  */
/* ==================================================================== */

describe("an employee-performance question loads BOTH frameworks", () => {
  const EMPLOYEE_QUESTIONS = [
    "Who should I coach from this employee report?",
    "Rank my team by conversion.",
    "Which consultant is lowest?",
    "Who has the biggest opportunity?",
  ];

  it.each(EMPLOYEE_QUESTIONS)("%s asks for both", async (question) => {
    await ask(question);

    expect(state.roleCalls).toContain(EMPLOYEE_ID);
    expect(state.roleCalls).toContain(PROGRESSION_ID);
  });

  it.each(EMPLOYEE_QUESTIONS)("%s sends both blocks to the model", async (question) => {
    await ask(question);

    expect(state.claudeCalls).toBe(1);
    // The metrics-to-behaviour half.
    expect(grounding()).toContain("NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE");
    // The what-response-is-appropriate half.
    expect(grounding()).toContain("PERFORMANCE MANAGEMENT LADDER");
  });

  it("reads the progression before the limits that apply inside it", async () => {
    await ask("Who should I coach from this employee report?");

    const text = grounding();
    expect(text.indexOf("PERFORMANCE MANAGEMENT LADDER")).toBeLessThan(
      text.indexOf("NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE"),
    );
  });

  it("refuses the turn when the progression is unavailable, even though the metrics framework is fine", async () => {
    state.roleResults[PROGRESSION_ID] = DOWN;

    const answer = await ask("Who should I coach from this employee report?");

    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toContain("Performance Management Framework");
    expect(answer.coverage).toBe("insufficient");
  });

  /*
   * THE REVERSE DOES NOT HOLD, and asserting it is what keeps the union from
   * becoming "always load everything". A question about the SYSTEM has nobody in
   * it, so requiring the metrics framework for it would refuse a process
   * question because an employee document was missing.
   */
  it("does not require the employee framework for a pure process question", async () => {
    state.roleResults[EMPLOYEE_ID] = DOWN;

    const answer = await ask("What is our corrective action process?");

    expect(state.roleCalls).toContain(PROGRESSION_ID);
    expect(state.roleCalls).not.toContain(EMPLOYEE_ID);
    expect(state.claudeCalls).toBe(1);
    expect(answer.content).not.toContain("currently unavailable");
  });

  it("fetches deeper when a role is pinned, so the manuals are not crowded out", async () => {
    await ask("Who should I coach from this employee report?");
    expect(state.matchLimit).toBe(40);
  });
});

/* ==================================================================== */
/*  2. MULTI-TURN CONTINUATION                                          */
/* ==================================================================== */

describe("the progression survives an elliptical follow-up", () => {
  it("carries \"all of it\" after \"corrective action\"", async () => {
    const answer = await ask("all of it", [manager("m1", "corrective action")]);

    expect(state.roleCalls).toContain(PROGRESSION_ID);
    expect(state.claudeCalls).toBe(1);
    expect(grounding()).toContain("PERFORMANCE MANAGEMENT LADDER");
    expect(answer.content).not.toContain("currently unavailable");
  });

  it.each([
    "all of it",
    "explain all of it",
    "the whole thing",
    "walk me through it",
    "tell me everything",
    "what about follow-up?",
    "and if there is still no improvement?",
    "how so?",
  ])("carries \"%s\"", async (question) => {
    await ask(question, [manager("m1", "corrective action")]);
    expect(state.roleCalls).toContain(PROGRESSION_ID);
  });

  it("carries through a whole chain of fragments", async () => {
    const history = [
      manager("m1", "corrective action"),
      manager("m2", "explain all of it"),
      manager("m3", "what about follow-up?"),
    ];

    await ask("and if there is still no improvement?", history);

    expect(state.roleCalls).toContain(PROGRESSION_ID);
    expect(grounding()).toContain("PERFORMANCE MANAGEMENT LADDER");
  });

  it("refuses a continued turn when the progression is unavailable", async () => {
    // The continuation must inherit the FAIL-CLOSED posture too, or the second
    // turn is the way round the first turn's guard.
    state.roleResults[PROGRESSION_ID] = DOWN;

    const answer = await ask("all of it", [manager("m1", "corrective action")]);

    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toContain("Performance Management Framework");
  });
});

describe("an intervening question clears the progression context", () => {
  it("does not resurrect it through an unrelated anchor", async () => {
    const history = [
      manager("m1", "corrective action"),
      manager("m2", "what does the refund policy say?"),
    ];

    const answer = await ask("what about it?", history);

    // The nearest standalone turn is the refund policy, so that is the anchor.
    expect(state.roleCalls).not.toContain(PROGRESSION_ID);
    expect(state.claudeCalls).toBe(1);
    expect(answer.content).not.toContain("currently unavailable");
  });

  it("still answers the unrelated question when the progression is down", async () => {
    /*
     * The consequence that matters. If the context leaked, a refund-policy
     * follow-up would be REFUSED for want of a corrective-action framework.
     */
    state.roleResults[PROGRESSION_ID] = DOWN;

    const history = [
      manager("m1", "corrective action"),
      manager("m2", "what does the refund policy say?"),
    ];

    const answer = await ask("what about it?", history);

    expect(state.claudeCalls).toBe(1);
    expect(answer.content).not.toContain("currently unavailable");
  });

  it("does not fire on a fragment with no anchor at all", async () => {
    await ask("all of it", []);
    expect(state.roleCalls).not.toContain(PROGRESSION_ID);
  });

  it("does not treat a fragment that carries its own subject as a continuation", async () => {
    // "explain the attendance policy" is a whole question, not "explain all of
    // it". A fragment pattern that could carry a subject would be a way to have
    // a policy question refused for a missing framework.
    await ask("explain the attendance policy", [manager("m1", "corrective action")]);
    expect(state.roleCalls).not.toContain(PROGRESSION_ID);
  });
});

/* ==================================================================== */
/*  3. ORDINARY WORK IS UNAFFECTED                                      */
/* ==================================================================== */

describe("ordinary questions neither load nor are refused by the progression", () => {
  beforeEach(() => {
    state.roleResults[PROGRESSION_ID] = DOWN;
    state.roleResults[EMPLOYEE_ID] = DOWN;
  });

  it.each([
    "what is the attendance policy?",
    "what does the handbook say about dress code?",
    "how do I replace a lamp?",
    "what time does the salon open on Sunday?",
    "what is the membership cancellation process?",
  ])("%s is answered from retrieval", async (question) => {
    const answer = await ask(question);

    expect(state.roleCalls).not.toContain(PROGRESSION_ID);
    expect(state.claudeCalls).toBe(1);
    expect(answer.content).not.toContain("currently unavailable");
    expect(answer.coverage).toBe("grounded");
  });
});
