import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE ANSWER PATH, EXERCISED RATHER THAN READ
 * ============================================================================
 *
 * The first version of these tests asserted on `readFileSync` of
 * `server-ask.ts` and string matching. That catches a deleted call and nothing
 * else: it cannot tell whether the framework actually reached the model, whether
 * a refusal actually skipped it, or whether a facts block was passed and then
 * dropped. Two of the three bugs QA found were invisible to it — the fail-open
 * `.catch(() => null)` and the `employeeFacts.block` that went nowhere both
 * left the source text looking exactly right.
 *
 * So these tests run `answerQuestion` with the providers and the model call
 * mocked, and assert on WHAT CLAUDE WAS SENT — or on the fact that it was not
 * called at all.
 *
 * The structural assertions that are still worth having (form proposal ordering,
 * the corpus not coming from the request) live in
 * `employee-performance-grounding.test.ts` alongside the pure-function tests.
 */

/* -------------------------------------------------------------- test doubles -- */

const state = vi.hoisted(() => ({
  /** What `callClaude` was called with, or null if it was never called. */
  claudeInput: null as Record<string, unknown> | null,
  claudeCalls: 0,
  /** Rows `knowledge.match` returns. */
  matchRows: [] as unknown[],
  matchLimit: null as number | null,
  matchCalls: 0,
  /** What `fetchRoleGrounding` returns for the EMPLOYEE framework. */
  roleResult: null as unknown,
  roleCalls: 0,
  /**
   * What it returns for the DAILY STATS framework, and how often it was asked.
   *
   * Counted separately because the two roles share one provider method, and
   * `roleCalls` is asserted throughout this file as "was the employee framework
   * fetched". A single counter would make every reporting question look like an
   * employee-performance one the moment a second role existed.
   */
  dailyStatsResult: null as unknown,
  dailyStatsCalls: 0,
  /** What `loadEmployeeFacts` returns. */
  employeeFacts: null as unknown,
  briefing: null as string | null,
  /** Families a requested report had no delivery for. Empty means all loaded. */
  missingFamilies: [] as string[],
  proposal: null as unknown,
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("./form-proposal", () => ({
  proposeFormForTurn: async () => state.proposal,
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match(query: { limit?: number }) {
      state.matchCalls += 1;
      state.matchLimit = query.limit ?? null;
      return state.matchRows;
    }
    async fetchRoleGrounding(role: { id: string }) {
      if (role.id === "daily_stats_interpretation_framework") {
        state.dailyStatsCalls += 1;
        return state.dailyStatsResult;
      }
      state.roleCalls += 1;
      return state.roleResult;
    }
  },
}));

/*
 * THE REPORT BLOCK NOW ARRIVES THROUGH THE FIVE-FAMILY COMPOSER.
 *
 * `state.briefing` stays a plain string so every assertion in this file reads
 * unchanged; the double wraps it in the shape `loadReportBriefing` returns. A
 * non-null block with an empty `present` is the no-data case — a block that
 * NAMES the reports it could not load — and `state.missingFamilies` selects it.
 */
vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () =>
    state.briefing === null
      ? null
      : {
          text: state.briefing,
          requested: state.missingFamilies.length > 0 ? state.missingFamilies : ["bed-usage"],
          present: state.missingFamilies.length > 0 ? [] : ["bed-usage"],
          missing: state.missingFamilies,
        },
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => state.employeeFacts,
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

/* -------------------------------------------------------------------- fixtures -- */

const FRAMEWORK_DOC_ID = "doc-framework";

function frameworkRow(index: number, locator: string) {
  return {
    chunk_id: `fw-${index}`,
    document_id: FRAMEWORK_DOC_ID,
    document_title: "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT",
    category: "leadership_coaching",
    locator,
    page: null,
    section: locator,
    content: `Framework rule text: ${locator}.`,
    similarity: 0,
  };
}

/** A healthy role result, exactly as `buildRoleGrounding` shapes one. */
function healthyRole() {
  return {
    ok: true as const,
    grounding: {
      role: { id: "employee_performance_framework" },
      documentId: FRAMEWORK_DOC_ID,
      documentTitle: "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT",
      matchedBy: "fallback" as const,
      rows: [
        frameworkRow(1, "SOURCE HIERARCHY AND OPERATING RULES"),
        frameworkRow(3, "DEFAULT OUTPUT RULE FOR EMPLOYEE PERFORMANCE REPORTS"),
        frameworkRow(67, "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE"),
        frameworkRow(78, "SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny"),
        frameworkRow(79, "FINAL INTERPRETATION MODEL"),
      ],
      presentGroups: [
        "source_hierarchy",
        "output_rules",
        "escalation_guard",
        "final_operating_rules",
        "interpretation_model",
      ],
    },
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

const ACTOR = { role: "salon_director" as const, scope: { kind: "salon" as const, ids: ["0495"] } };

function request(overrides: Record<string, unknown> = {}) {
  return {
    question: "What does the refund policy say?",
    mode: "standard" as const,
    history: [] as { role: string; content: string }[],
    scopeId: "stc-core",
    context: { userName: "Paulyne", locationName: "Salon 0495", todayIso: "2026-09-09" },
    ...overrides,
  };
}

async function ask(overrides: Record<string, unknown> = {}) {
  const { answerQuestion } = await import("./server-ask");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return answerQuestion(request(overrides) as any, ACTOR as any);
}

/** Everything the model was sent, as one searchable string. */
function claudePayload(): string {
  const input = state.claudeInput;
  if (!input) throw new Error("callClaude was not called");
  return [input.system, input.grounding, input.reportData, input.employeeData, input.question]
    .filter((part): part is string => typeof part === "string")
    .join("\n\n");
}

beforeEach(() => {
  state.claudeInput = null;
  state.claudeCalls = 0;
  state.matchRows = policyRows();
  state.matchLimit = null;
  state.matchCalls = 0;
  state.roleResult = null;
  state.roleCalls = 0;
  state.dailyStatsResult = null;
  state.dailyStatsCalls = 0;
  state.missingFamilies = [];
  state.employeeFacts = null;
  state.briefing = null;
  state.proposal = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

/* --------------------------------------------------------------------- A -- */

describe("A. employee performance + framework available -> framework reaches Claude", () => {
  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: false,
      available: false,
      block: null,
      provenance: null,
      reason: "no dataset",
    };
  });

  it("calls the model with the framework's own rule text in the grounding", async () => {
    await ask({ question: "Who should I coach from this employee performance report?" });

    expect(state.claudeCalls).toBe(1);
    expect(claudePayload()).toContain("NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE");
    expect(claudePayload()).toContain("SOURCE HIERARCHY AND OPERATING RULES");
  });

  it("puts the framework's rules ahead of the policy evidence", async () => {
    await ask({ question: "Who should I coach from this employee report?" });

    const grounding = String(state.claudeInput!.grounding);
    expect(grounding.indexOf("SOURCE HIERARCHY")).toBeLessThan(
      grounding.indexOf("JBA Policy Manual"),
    );
  });

  it("turns on the framework rules in the system prompt", async () => {
    await ask({ question: "Who should I coach?" });

    expect(String(state.claudeInput!.system)).toContain(
      "EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK",
    );
  });

  it("fetches deeper so policy still reaches the prompt", async () => {
    await ask({ question: "Who should I coach?" });

    expect(state.matchLimit).toBe(40);
    expect(claudePayload()).toContain("JBA Policy Manual");
  });

  it("cites the real framework document", async () => {
    const answer = await ask({ question: "Who should I coach?" });

    expect(answer.citations[0]?.documentId).toBe(FRAMEWORK_DOC_ID);
    expect(answer.citations[0]?.documentTitle).toBe(
      "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT",
    );
  });
});

/* --------------------------------------------------------------------- B -- */

describe("B. employee performance + framework unavailable -> Claude is not called", () => {
  const failures = [
    { code: "role_document_not_found", detail: "no document carries the tag" },
    { code: "role_document_ambiguous", detail: "2 documents claim the role" },
    { code: "role_document_query_failed", detail: "lookup did not complete" },
    { code: "role_chunk_query_failed", detail: "chunk lookup did not complete" },
    { code: "no_mandatory_chunks", detail: "no heading matched" },
    { code: "incomplete_rule_groups", detail: "missing the escalation guard" },
  ] as const;

  for (const failure of failures) {
    it(`refuses on ${failure.code} without calling the model`, async () => {
      state.roleResult = { ok: false, failure };

      const answer = await ask({
        question: "Who should I coach from this employee performance report?",
      });

      expect(state.claudeCalls).toBe(0);
      expect(state.claudeInput).toBeNull();
      expect(answer.content).toContain(
        "The Employee Performance Framework required for this analysis is currently unavailable",
      );
      expect(answer.citations).toEqual([]);
      expect(answer.coverage).toBe("insufficient");
    });
  }

  it("does not leak the internal reason to the manager", async () => {
    state.roleResult = {
      ok: false,
      failure: {
        code: "role_chunk_query_failed",
        detail: 'relation "knowledge_chunks" does not exist at character 42',
      },
    };

    const answer = await ask({ question: "Does anyone need an EPP?" });

    expect(answer.content).not.toContain("knowledge_chunks");
    expect(answer.content).not.toContain("character 42");
    expect(answer.content).not.toContain("role_chunk_query_failed");
  });

  it("refuses an escalation question just as firmly as a coaching one", async () => {
    state.roleResult = { ok: false, failure: failures[0] };

    await ask({ question: "Does anyone need an EPP based on these numbers?" });

    expect(state.claudeCalls).toBe(0);
  });
});

/* --------------------------------------------------------------------- C -- */

describe("C. an unrelated policy question does not load the framework", () => {
  it("never asks for the role at all", async () => {
    const answer = await ask({ question: "What does the refund policy say?" });

    expect(state.roleCalls).toBe(0);
    expect(state.claudeCalls).toBe(1);
    expect(String(state.claudeInput!.system)).not.toContain(
      "EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK",
    );
    expect(answer.coverage).toBe("grounded");
  });

  it("keeps the ordinary retrieval depth", async () => {
    await ask({ question: "What does the refund policy say?" });
    expect(state.matchLimit).toBe(14);
  });

  it("still answers when the framework would have been unavailable", async () => {
    // The refusal must be scoped to employee-performance turns only.
    state.roleResult = { ok: false, failure: { code: "role_document_not_found", detail: "x" } };

    await ask({ question: "What does the refund policy say?" });

    expect(state.claudeCalls).toBe(1);
  });
});

/* ------------------------------------------------------------------ D, E -- */

describe("D. an immediate employee-performance follow-up keeps the framework", () => {
  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: false,
      available: false,
      block: null,
      provenance: null,
      reason: "no dataset",
    };
  });

  it("inherits intent for an elliptical follow-up", async () => {
    await ask({
      question: "What about Sarah?",
      history: [
        { role: "user", content: "Who should I coach from this employee report?" },
        { role: "assistant", content: "Here are the top three." },
      ],
    });

    expect(state.roleCalls).toBe(1);
    expect(claudePayload()).toContain("NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE");
  });

  it("refuses the follow-up too when the framework has gone missing", async () => {
    state.roleResult = { ok: false, failure: { code: "role_document_not_found", detail: "x" } };

    const answer = await ask({
      question: "What about Sarah?",
      history: [{ role: "user", content: "Who should I coach from this employee report?" }],
    });

    expect(state.claudeCalls).toBe(0);
    expect(answer.coverage).toBe("insufficient");
  });
});

describe("E. an unrelated follow-up clears the framework immediately", () => {
  it("does not inherit intent for a question that stands on its own", async () => {
    await ask({
      question: "What does the refund policy say?",
      history: [
        { role: "user", content: "Who should I coach from this employee report?" },
        { role: "assistant", content: "Here are the top three." },
      ],
    });

    expect(state.roleCalls).toBe(0);
    expect(state.claudeCalls).toBe(1);
    expect(String(state.claudeInput!.system)).not.toContain(
      "EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK",
    );
  });

  it("does not inherit from an older turn once a plain question intervened", async () => {
    await ask({
      question: "What about it?",
      history: [
        { role: "user", content: "Who should I coach from this employee report?" },
        { role: "assistant", content: "Here are the top three." },
        { role: "user", content: "What does the refund policy say?" },
        { role: "assistant", content: "Fourteen days." },
      ],
    });

    expect(state.roleCalls).toBe(0);
  });
});

/* ------------------------------- multi-hop continuation, A through E -- */

describe("multi-hop elliptical continuation", () => {
  const U = (content: string) => ({ role: "user", content });
  const A = (content: string) => ({ role: "assistant", content });

  const HOP_1 = [U("Who should I coach?"), A("Here are the top three.")];
  const HOP_2 = [...HOP_1, U("What about Sarah?"), A("She is low on upgrades.")];
  const HOP_3 = [...HOP_2, U("The other two?"), A("Both improving.")];

  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: false,
      available: false,
      block: null,
      provenance: null,
      reason: "no dataset",
    };
  });

  it("A. coach? -> What about Sarah? -> And Jane? all keep the framework", async () => {
    for (const [question, history] of [
      ["Who should I coach?", []],
      ["What about Sarah?", HOP_1],
      ["And Jane?", HOP_2],
    ] as const) {
      state.roleCalls = 0;
      state.claudeCalls = 0;
      state.claudeInput = null;

      await ask({ question, history: [...history] });

      expect(state.roleCalls, question).toBe(1);
      expect(claudePayload(), question).toContain(
        "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
      );
    }
  });

  it("B. a four-turn run of fragments all keeps the framework", async () => {
    for (const [question, history] of [
      ["What about Sarah?", HOP_1],
      ["The other two?", HOP_2],
      ["Why?", HOP_3],
    ] as const) {
      state.roleCalls = 0;
      state.claudeCalls = 0;

      await ask({ question, history: [...history] });

      expect(state.roleCalls, question).toBe(1);
      expect(String(state.claudeInput!.system), question).toContain(
        "EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK",
      );
    }
  });

  it("C. a standalone refund question mid-run does NOT load the framework", async () => {
    await ask({ question: "What does the refund policy say?", history: HOP_2 });

    expect(state.roleCalls).toBe(0);
    expect(state.claudeCalls).toBe(1);
    expect(String(state.claudeInput!.system)).not.toContain(
      "EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK",
    );
  });

  it("D. after the clear, a fragment refers to the new topic, not the old one", async () => {
    const cleared = [
      ...HOP_2,
      U("What does the refund policy say?"),
      A("Fourteen days."),
    ];

    await ask({ question: "What about it?", history: cleared });

    expect(state.roleCalls).toBe(0);
    expect(state.claudeCalls).toBe(1);
  });

  it("E. an unavailable framework refuses on every hop, not just the first", async () => {
    state.roleResult = { ok: false, failure: { code: "role_document_not_found", detail: "x" } };

    for (const [question, history] of [
      ["What about Sarah?", HOP_1],
      ["And Jane?", HOP_2],
      ["Why?", HOP_3],
    ] as const) {
      state.claudeCalls = 0;
      state.claudeInput = null;

      const answer = await ask({ question, history: [...history] });

      expect(state.claudeCalls, question).toBe(0);
      expect(answer.coverage, question).toBe("insufficient");
      expect(answer.content, question).toContain(
        "The Employee Performance Framework required for this analysis is currently unavailable",
      );
    }
  });
});

/* ------------------------- discipline: policy vs employee action -- */

describe("a disciplinary POLICY question is never refused for a missing framework", () => {
  beforeEach(() => {
    // The hostile configuration: the framework cannot be loaded at all.
    state.roleResult = { ok: false, failure: { code: "role_document_not_found", detail: "x" } };
  });

  const POLICY_LOOKUPS = [
    "What does the disciplinary policy say?",
    "Where can I find the discipline policy?",
    "What is the disciplinary process?",
    "Where is the coaching form?",
  ];

  for (const question of POLICY_LOOKUPS) {
    it(`answers "${question}" from ordinary retrieval`, async () => {
      const answer = await ask({ question });

      expect(state.roleCalls).toBe(0);
      expect(state.claudeCalls).toBe(1);
      expect(answer.coverage).toBe("grounded");
      expect(answer.content).not.toContain("currently unavailable");
      expect(state.matchLimit).toBe(14);
    });
  }
});

describe("a disciplinary EMPLOYEE decision still requires the framework", () => {
  it("loads it and sends the escalation guard", async () => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: false,
      available: false,
      block: null,
      provenance: null,
      reason: "no dataset",
    };

    await ask({ question: "Should I discipline Sarah based on these numbers?" });

    expect(state.roleCalls).toBe(1);
    expect(claudePayload()).toContain("NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE");
    expect(String(state.claudeInput!.system)).toContain(
      "Never recommend discipline, an EPP, a DPOA, a suspension or a termination on the strength of numbers alone",
    );
  });

  it("refuses rather than answering it without the guard", async () => {
    state.roleResult = { ok: false, failure: { code: "incomplete_rule_groups", detail: "x" } };

    const answer = await ask({
      question: "Does Jane need disciplinary action based on this report?",
    });

    expect(state.claudeCalls).toBe(0);
    expect(answer.coverage).toBe("insufficient");
  });
});

/* --------------------------------------------------------------------- F -- */

describe("F. manager-supplied employee facts are usable as facts", () => {
  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: false,
      available: false,
      block: null,
      provenance: null,
      reason: "no dataset",
    };
  });

  const question =
    "Sarah had 40 opportunities and converted 8 this month. What should I coach?";

  it("loads the framework for it", async () => {
    await ask({ question });

    expect(state.roleCalls).toBe(1);
    expect(state.claudeCalls).toBe(1);
  });

  it("permits the figures the manager stated", async () => {
    await ask({ question });
    const system = String(state.claudeInput!.system);

    expect(system).toContain(
      "You MAY use employee figures the manager has stated in this conversation, exactly as stated",
    );
  });

  it("does not claim there are no employee facts at all", async () => {
    await ask({ question });
    const system = String(state.claudeInput!.system);

    // The old wording asserted a falsehood whenever the manager supplied data.
    expect(system).not.toContain("YOU HAVE NO CURRENT EMPLOYEE-LEVEL DATA FOR THIS QUESTION");
    expect(system).not.toContain("no employee figures at all");
    // It says the honest thing instead.
    expect(system).toContain("NO EMPLOYEE PERFORMANCE REPORT HAS BEEN INGESTED");
  });

  it("still forbids adding metrics the manager did not state", async () => {
    await ask({ question });
    const system = String(state.claudeInput!.system);

    expect(system).toContain("Do not infer a metric that was not stated");
    expect(system).toContain("do not compute a rate the manager did not give you");
  });
});

/* --------------------------------------------------------------------- G -- */

describe("G. with no employee facts anywhere, nobody is invented", () => {
  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: false,
      available: false,
      block: null,
      provenance: null,
      reason: "no dataset",
    };
  });

  it("instructs the model to say so and not to rank or name people", async () => {
    await ask({ question: "Who should I coach?" });
    const system = String(state.claudeInput!.system);

    expect(system).toContain(
      "Do not invent an employee, a name, a score, a ranking or a headcount",
    );
    expect(system).toContain("you have the coaching framework but no current employee-level report");
  });

  it("sends no employee data block", async () => {
    await ask({ question: "Who should I coach?" });
    expect(state.claudeInput!.employeeData).toBeNull();
  });

  it("still offers the useful half rather than refusing", async () => {
    await ask({ question: "Who should I coach?" });

    expect(String(state.claudeInput!.system)).toContain(
      "which metrics matter, what to observe, how to prioritise",
    );
  });
});

/* --------------------------------------------------------------------- H -- */

describe("H. an employee facts block actually reaches the model", () => {
  const FACTS = "Sarah Cole — 412 opportunities, 38 EFT, 9.2% conversion.";

  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: true,
      available: true,
      block: `CURRENT EMPLOYEE PERFORMANCE DATA\n\nSource: Employee Performance Report, August 2026.\n\n${FACTS}`,
      provenance: "Employee Performance Report, August 2026",
      reason: null,
    };
  });

  it("passes the block to Claude as its own section", async () => {
    await ask({ question: "Who should I coach from this employee report?" });

    expect(state.claudeInput!.employeeData).toContain(FACTS);
    expect(claudePayload()).toContain(FACTS);
  });

  it("keeps it out of the company knowledge block", async () => {
    await ask({ question: "Who should I coach from this employee report?" });

    // Employee figures are not documents and take no source marker.
    expect(String(state.claudeInput!.grounding)).not.toContain(FACTS);
  });

  it("switches the prompt to the attached-data rules", async () => {
    await ask({ question: "Who should I coach from this employee report?" });
    const system = String(state.claudeInput!.system);

    expect(system).toContain("The CURRENT EMPLOYEE PERFORMANCE DATA section holds the employee figures");
    expect(system).not.toContain("NO EMPLOYEE PERFORMANCE REPORT HAS BEEN INGESTED");
  });

  it("keeps the real reporting provenance rather than inventing a citation", async () => {
    const answer = await ask({ question: "Who should I coach from this employee report?" });

    expect(String(state.claudeInput!.employeeData)).toContain(
      "Employee Performance Report, August 2026",
    );
    // No citation is manufactured for employee figures.
    for (const citation of answer.citations) {
      expect(citation.excerpt).not.toContain(FACTS);
    }
  });
});

/* --------------------------------------------------------------------- K -- */

describe("K. policy evidence and framework reasoning coexist", () => {
  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: false,
      available: false,
      block: null,
      provenance: null,
      reason: "no dataset",
    };
  });

  it("sends both, with the hierarchy stated", async () => {
    await ask({ question: "Who should I coach from this employee report?" });

    expect(claudePayload()).toContain("JBA Policy Manual");
    expect(claudePayload()).toContain("SOURCE HIERARCHY AND OPERATING RULES");
    expect(String(state.claudeInput!.system)).toContain(
      "WHERE POLICY AND THE FRAMEWORK CONFLICT, POLICY WINS.",
    );
  });

  it("does not let the framework eat the evidence budget", async () => {
    state.matchRows = policyRows(12);

    await ask({ question: "Who should I coach from this employee report?" });

    const grounding = String(state.claudeInput!.grounding);
    // Five pinned framework chunks plus twelve policy chunks.
    expect(grounding).toContain("[S17]");
    expect(grounding).not.toContain("[S18]");
  });

  it("drops retrieved framework rows so they are not sent twice", async () => {
    state.matchRows = [
      frameworkRow(1, "SOURCE HIERARCHY AND OPERATING RULES"),
      ...policyRows(3),
    ];

    await ask({ question: "Who should I coach from this employee report?" });

    const grounding = String(state.claudeInput!.grounding);
    /*
     * Counted on the CHUNK HEADER (`[Sn] Title — Locator`) rather than on the
     * phrase, because the stub content repeats its own locator and would make
     * one chunk look like two.
     */
    const headers = grounding.split("— SOURCE HIERARCHY AND OPERATING RULES\n").length - 1;
    expect(headers).toBe(1);
  });

  it("still attaches the salon-level briefing on a reporting question", async () => {
    state.briefing = "REPORT DATA\n\nTotal tans 48,584.";

    await ask({ question: "Which consultant is lowest on spa conversion?" });

    expect(state.claudeInput!.reportData).toContain("48,584");
    expect(claudePayload()).toContain("SOURCE HIERARCHY AND OPERATING RULES");
  });
});

/* --------------------------------------------------------------------- L -- */

describe("L. the Forms and Coaching path is unaffected", () => {
  it("returns the proposal without touching retrieval, the role or the model", async () => {
    state.proposal = {
      content: "I can create a coaching form for her.",
      citations: [],
      coverage: "grounded",
      recommendedVideoIds: [],
      formProposal: { templateKey: "coaching_form" },
    };

    const answer = await ask({ question: "Create a coaching form for Sarah" });

    expect(answer).toBe(state.proposal);
    expect(state.matchCalls).toBe(0);
    expect(state.roleCalls).toBe(0);
    expect(state.claudeCalls).toBe(0);
  });

  it("keeps the form-facsimile prohibition when the framework is loaded", async () => {
    state.roleResult = healthyRole();
    state.employeeFacts = {
      datasetIngested: false,
      available: false,
      block: null,
      provenance: null,
      reason: "no dataset",
    };

    await ask({ question: "Who should I coach from this employee report?" });

    expect(String(state.claudeInput!.system)).toContain(
      "NEVER WRITE A FACSIMILE OF A COMPANY FORM.",
    );
  });
});

/* ------------------------------------------- general and reporting regressions -- */

describe("general knowledge retrieval still works end to end", () => {
  it("answers a plain policy question from retrieved rows", async () => {
    const answer = await ask({ question: "What does the refund policy say?" });

    expect(state.claudeCalls).toBe(1);
    expect(answer.coverage).toBe("grounded");
    expect(answer.citations[0]?.documentTitle).toBe("JBA Policy Manual Edited 5.2025");
  });

  it("reports insufficient coverage when nothing matched and no role applied", async () => {
    state.matchRows = [];

    const answer = await ask({ question: "What does the refund policy say?" });

    expect(answer.coverage).toBe("insufficient");
    expect(state.claudeCalls).toBe(1);
  });
});

describe("reporting chat grounding still works end to end", () => {
  it("attaches the briefing for a reporting question with no framework", async () => {
    state.briefing = "REPORT DATA\n\nTotal tans 48,584.";

    await ask({ question: "What was our spa conversion last month?" });

    expect(state.roleCalls).toBe(0);
    expect(state.claudeInput!.reportData).toContain("48,584");
  });

  it("counts a briefing as coverage even with no citations", async () => {
    state.matchRows = [];
    state.briefing = "REPORT DATA\n\nTotal tans 48,584.";

    const answer = await ask({ question: "What was our spa conversion last month?" });

    expect(answer.coverage).toBe("grounded");
  });
});

/* ================= REMEDIATION 2: ROUTING INTO FAIL-CLOSED ================ */

/**
 * ============================================================================
 * THE FIVE ROUTING BLOCKERS, AT THE ORCHESTRATION LAYER
 * ============================================================================
 *
 * Independent QA found five ways a question reached the wrong side of the
 * fail-closed gate. Two of them REFUSED an ordinary policy lookup because the
 * framework happened to be unavailable; three of them answered an employee
 * escalation with no framework at all. The architecture was right both times —
 * the routing into it was not.
 *
 * These run against `answerQuestion`, so they assert what Claude was sent, or
 * that it was not called. A gate-level test could not have caught either
 * failure mode: both look correct in isolation and only bite once the refusal
 * is real.
 */

const NO_FACTS = {
  datasetIngested: false,
  available: false,
  block: null,
  provenance: null,
  reason: "no dataset",
};

const FRAMEWORK_DOWN = {
  ok: false,
  failure: { code: "role_document_not_found", detail: "no document carries the tag" },
};

const U = (content: string) => ({ role: "user", content });
const A = (content: string) => ({ role: "assistant", content });

/** Did this turn get the framework's escalation guard? */
function frameworkReached(): boolean {
  return (
    state.claudeInput !== null &&
    String(state.claudeInput.grounding).includes("NEVER RECOMMEND DISCIPLINE")
  );
}

describe("policy questions are never refused for a missing framework", () => {
  beforeEach(() => {
    // The hostile configuration throughout: the framework cannot be loaded.
    state.roleResult = FRAMEWORK_DOWN;
    state.employeeFacts = NO_FACTS;
  });

  const ORDINARY = [
    "Can managers discipline employees under this policy?",
    "What is a coaching form used for?",
    "What does the disciplinary policy say?",
    "What are the steps for a write-up?",
    "Does HR approve disciplinary action?",
    "Where is the coaching form?",
    "Is there a write-up form?",
    "Where is the disciplinary procedure documented?",
    "What does the coaching guide say?",
    "Where can I find the performance improvement template?",
    "What does this report say about the disciplinary policy?",
  ];

  for (const question of ORDINARY) {
    it(`answers "${question}" through ordinary retrieval`, async () => {
      const answer = await ask({ question });

      expect(state.roleCalls).toBe(0);
      expect(state.claudeCalls).toBe(1);
      expect(answer.content).not.toContain("currently unavailable");
      expect(answer.coverage).toBe("grounded");
      expect(state.matchLimit).toBe(14);
      expect(String(state.claudeInput!.system)).not.toContain(
        "EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK",
      );
    });
  }
});

describe("newly routed employee escalations reach the framework", () => {
  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = NO_FACTS;
  });

  const ESCALATIONS = [
    "Should we write her up?",
    "Should I write Sarah up?",
    "Do we need to write him up?",
    "Would you write this employee up?",
    "Based on those numbers, is a write-up appropriate?",
    "Based on this report, should someone be disciplined?",
    "Does this report justify a performance improvement plan?",
    "Should this employee be disciplined?",
    "Should one of these employees be disciplined based on this report?",
    "Can I discipline Sarah under this policy?",
    "Based on those numbers, should we write her up?",
  ];

  for (const question of ESCALATIONS) {
    it(`grounds "${question}" in the framework`, async () => {
      await ask({ question });

      expect(state.roleCalls).toBe(1);
      expect(frameworkReached()).toBe(true);
      expect(String(state.claudeInput!.system)).toContain(
        "Never recommend discipline, an EPP, a DPOA, a suspension or a termination on the strength of numbers alone",
      );
    });
  }

  for (const question of ESCALATIONS) {
    it(`refuses "${question}" when the framework is unavailable`, async () => {
      state.roleResult = FRAMEWORK_DOWN;

      const answer = await ask({ question });

      expect(state.claudeCalls).toBe(0);
      expect(state.claudeInput).toBeNull();
      expect(answer.coverage).toBe("insufficient");
      expect(answer.content).toContain(
        "The Employee Performance Framework required for this analysis is currently unavailable",
      );
      // No implementation detail leaks.
      expect(answer.content).not.toContain("role_document_not_found");
      expect(answer.content).not.toContain("carries the tag");
    });
  }
});

describe("newly recognised fragments keep the framework, and fail closed with it", () => {
  const HISTORY = [U("Who should I coach?"), A("Here are the top three.")];

  const FRAGMENTS = ["How so?", "What do you mean?", "Based on that?", "Why?", "What then?"];

  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = NO_FACTS;
  });

  for (const question of FRAGMENTS) {
    it(`inherits intent for "${question}"`, async () => {
      await ask({ question, history: [...HISTORY] });

      expect(state.roleCalls).toBe(1);
      expect(frameworkReached()).toBe(true);
    });
  }

  for (const question of FRAGMENTS) {
    it(`refuses "${question}" when the framework is unavailable`, async () => {
      state.roleResult = FRAMEWORK_DOWN;

      const answer = await ask({ question, history: [...HISTORY] });

      expect(state.claudeCalls).toBe(0);
      expect(answer.coverage).toBe("insufficient");
    });
  }

  it("clears every fragment once an unrelated question intervenes", async () => {
    const cleared = [
      ...HISTORY,
      U("What about Sarah?"),
      A("Low on upgrades."),
      U("What is a coaching form used for?"),
      A("It records a coaching conversation."),
    ];

    for (const question of FRAGMENTS) {
      state.roleCalls = 0;
      state.claudeCalls = 0;

      await ask({ question, history: [...cleared] });

      expect(state.roleCalls, question).toBe(0);
      expect(state.claudeCalls, question).toBe(1);
    }
  });
});

describe("interaction matrix A-F", () => {
  beforeEach(() => {
    state.roleResult = healthyRole();
    state.employeeFacts = NO_FACTS;
  });

  it("A. generic category + documentary -> ordinary KB", async () => {
    state.roleResult = FRAMEWORK_DOWN;

    const answer = await ask({ question: "Can managers discipline employees under this policy?" });

    expect(state.roleCalls).toBe(0);
    expect(state.claudeCalls).toBe(1);
    expect(answer.content).not.toContain("currently unavailable");
  });

  it("B. named person + documentary -> framework mandatory", async () => {
    await ask({ question: "Can I discipline Sarah under this policy?" });

    expect(state.roleCalls).toBe(1);
    expect(frameworkReached()).toBe(true);
  });

  it("C. metric context + escalation -> framework mandatory", async () => {
    await ask({ question: "Based on those numbers, should we write her up?" });

    expect(state.roleCalls).toBe(1);
    expect(frameworkReached()).toBe(true);
  });

  it("D. metric context + documentary -> ordinary KB", async () => {
    state.roleResult = FRAMEWORK_DOWN;

    const answer = await ask({
      question: "What does this report say about the disciplinary policy?",
    });

    expect(state.roleCalls).toBe(0);
    expect(state.claudeCalls).toBe(1);
    expect(answer.content).not.toContain("currently unavailable");
  });

  it("E. elliptical run after an explicit escalation keeps the framework", async () => {
    const history: { role: string; content: string }[] = [];
    const turns = ["Should we write Sarah up?", "Why?", "How so?", "Based on that?"];

    for (const question of turns) {
      state.roleCalls = 0;
      state.claudeCalls = 0;

      await ask({ question, history: [...history] });

      expect(state.roleCalls, question).toBe(1);
      expect(frameworkReached(), question).toBe(true);

      history.push(U(question), A("Because of her upgrade rate."));
    }
  });

  it("F. a documentary question mid-run resets, and no fragment resurrects it", async () => {
    const history = [
      U("Should we write Sarah up?"),
      A("Observe first."),
      U("Why?"),
      A("Because a metric is not a finding."),
      U("What is the coaching form used for?"),
      A("It records a coaching conversation."),
    ];

    // The documentary turn itself.
    await ask({ question: "What is the coaching form used for?", history: history.slice(0, 4) });
    expect(state.roleCalls).toBe(0);

    // And the fragment after it.
    state.roleCalls = 0;
    state.claudeCalls = 0;
    await ask({ question: "What do you mean?", history: [...history] });
    expect(state.roleCalls).toBe(0);
    expect(state.claudeCalls).toBe(1);
  });
});
