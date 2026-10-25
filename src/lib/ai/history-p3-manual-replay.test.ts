import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";

/**
 * QA, full chat history (Ask Sunny), P3: the manual's own policy denied or
 * retracted. Each turn is replayed through `answerQuestion` with
 * FULL_MANUAL_CONTEXT_ENABLED on (as in production since 24 Oct 2026) and the
 * production JBA Policy Manual (all 151 rows) as the loaded manual.
 *
 *   conv_muxei72m2prj6n5  "policy specific to uggs?" was answered "the only
 *                         documents available to me right now are equipment
 *                         wiring schematics".
 *   conv_mvb51g8r2s8r2q9  "what's the policy on employees finding coverage?"
 *                         was answered "the documents available to me here are
 *                         all benefits material … none address shift coverage".
 *   conv_mvh4cpy823xcab3  Late Opening quoted from the manual, then retracted
 *                         ("not in the company documents available to me for
 *                         this question"), then restored.
 *   conv_mufp73ez8pl7992  a pre-screen summary whose staffing figures were
 *                         retracted on the "make this a downloadable document"
 *                         turn.
 *
 * WHAT THIS PROVES: which path each turn takes (policy / full manual, or
 * retrieval) and that the manual page that answers it is in the prompt the
 * model is sent, with no retrieved rows beside it. The vector search is
 * replaced by what those turns retrieved (an unrelated document), so a turn
 * that still went to retrieval would show it.
 *
 * WHAT IT CANNOT PROVE: what the live model writes from that prompt. The
 * intent-extraction and query-rewrite model calls are off here, so the route
 * is decided by the question's own words; in production a rewrite that labels
 * the turn "form" would skip the manual (see `isPolicyAnswerQuestion`).
 *
 * People's names are replaced with test names.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  answer: "An answer.",
  retrieved: [] as unknown[],
  matchCalls: 0,
  manualLoads: [] as string[],
  traceIntents: [] as string[],
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("./form-proposal", () => ({
  proposeFormForTurn: async () => null,
  suggestFormsForTurn: () => null,
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => [],
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      state.matchCalls += 1;
      return state.retrieved;
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "missing" };
    }
  },
}));

/*
 * THE LOADER WITH THE DATABASE READ REPLACED BY THE PRODUCTION ROWS. The rows
 * go through the loader's own row mapping and title filter, and the same
 * `choosePolicyManuals` assembly production runs.
 */
vi.mock("./full-manual-load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./full-manual-load")>();
  const context = await import("./full-manual-context");
  return {
    ...actual,
    loadFullManualContext: async (input: { scopeId: string; question: string }) => {
      state.manualLoads.push(input.question);
      const document = {
        id: rows.document_ids["ask-sunny"],
        title: rows.title,
        category: "policies_compliance",
        chunks: (rows.chunks as import("./full-manual-load").ChunkRow[]).map(actual.manualChunkFromRow),
      };
      const documents = [document].filter((doc) => context.isJbaPolicyManualTitle(doc.title));
      return context.choosePolicyManuals(input.question, documents);
    },
  };
});

vi.mock("./chat-trace-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chat-trace-store")>();
  return {
    ...actual,
    updateChatTrace: (patch: { intent?: string | null }) => {
      if (typeof patch.intent === "string") state.traceIntents.push(patch.intent);
      actual.updateChatTrace(patch as never);
    },
  };
});

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
    state.claudeInput = input;
    return state.answer;
  },
}));

const ORIGINAL = { ...process.env };

type Turn = { role: "user" | "assistant"; content: string };

async function ask(question: string, history: Turn[] = []) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      context: { userName: "Test Manager", locationName: "Test Salon", todayIso: "2026-10-20" },
    } as never,
    {
      role: "salon_director" as never,
      scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
    },
  );
}

const manualBlock = () => String(state.claudeInput?.fullManualBlock ?? "");
/** The manual block with its line wrapping folded, for matching a sentence. */
const manualText = () => manualBlock().replace(/\s+/g, " ");
const grounding = () => String(state.claudeInput?.grounding ?? "");

/** The last [p.N] marker printed before `snippet` in the manual block. */
function pageBefore(snippet: string): number | null {
  const text = manualBlock();
  const at = text.indexOf(snippet);
  expect(at, snippet).toBeGreaterThan(-1);
  const markers = [...text.slice(0, at).matchAll(/\[p\.(\d{1,3})\]/g)];
  const last = markers[markers.length - 1];
  return last ? Number(last[1]) : null;
}

/** A retrieved row from a document that is not the manual. */
function otherDocument(title: string, content: string) {
  return {
    chunk_id: `other-${title}`,
    document_id: "00000000-0000-4000-8000-000000000001",
    document_title: title,
    category: "operations",
    locator: "Page 1",
    page: 1,
    section: null,
    content,
    similarity: 0.85,
  };
}

function expectManualPath() {
  expect(state.traceIntents, "the turn is routed as a policy question").toContain("policy");
  expect(state.manualLoads.length, "the manual is loaded").toBeGreaterThan(0);
  expect(manualBlock()).toContain("FULL POLICY MANUAL");
  expect(state.matchCalls, "retrieval is not the policy source").toBe(0);
}

vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  vi.resetModules();
  process.env.FULL_MANUAL_CONTEXT_ENABLED = "true";
  state.claudeInput = null;
  state.answer = "An answer.";
  state.retrieved = [];
  state.matchCalls = 0;
  state.manualLoads = [];
  state.traceIntents = [];
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("conv_muxei72m2prj6n5: \"policy specific to uggs?\"", () => {
  it("takes the manual path, and the manual's Shoes section (p.15) is in the prompt instead of the wiring schematics", async () => {
    state.retrieved = [otherDocument("Tanning Bed Wiring Schematic", "Ballast wiring diagram, 220V.")];
    await ask("policy specific to uggs?");

    expectManualPath();
    expect(manualText()).toContain("Tennis shoes or other full coverage closed toe shoes are to be worn.");
    expect(manualText()).toContain("No sandals, crocks, flip-flops, or other open toe shoes are allowed.");
    expect(pageBefore("Tennis shoes or other full coverage closed toe shoes")).toBe(15);
    expect(grounding()).not.toContain("Wiring Schematic");
    // The manual does not name the brand; the reply has to reason from Shoes.
    expect(manualBlock()).not.toMatch(/\bUggs?\b/);
  });
});

describe("conv_mvb51g8r2s8r2q9: \"what's the policy on employees finding coverage?\"", () => {
  it("takes the manual path, and Shift Replacement (p.37) is in the prompt instead of the benefits documents", async () => {
    state.retrieved = [otherDocument("Benefits Eligibility Guide", "COBRA continuation coverage and 401K eligibility.")];
    const history: Turn[] = [
      {
        role: "user",
        content:
          "i have a couple employees who do not meet the minimum requirement of 10 hours.  i think the last manager 'OK'd it but it's casuing issues with scheduling.  how can i proceewd to exit them out?",
      },
      { role: "assistant", content: "Before anything is processed, all normal approvals must be obtained." },
    ];
    await ask("what's the policy on employees finding coverage?  and if they can't find coverage", history);

    expectManualPath();
    expect(manualText()).toContain("It is the responsibility of the employee to find a replacement for their shift.");
    expect(manualText()).toContain("Texting is NOT an acceptable method of");
    expect(pageBefore("It is the responsibility of the employee to find a replacement")).toBe(37);
    expect(grounding()).not.toContain("COBRA");
  });
});

describe("conv_mvh4cpy823xcab3: Late Opening quoted, retracted, restored", () => {
  const quoted =
    'Here\'s the manual\'s own language on Late Opening so you have it exactly as written: "When an employee assigned to open a location is unable to open the location at the proper time, the employee must notify the manager as soon as possible."';
  const history: Turn[] = [
    { role: "user", content: "do you remeber the corrective action form about Test Employee I asked you to make ?" },
    { role: "assistant", content: "I don't have any record of that." },
    {
      role: "user",
      content: "create corrective action for for Test Employee for Late Opening from the policy manual. It is a verbal warning",
    },
    { role: "assistant", content: "I'll draft a **Corrective Action Form** for **Test Employee** from what you've described." },
    { role: "user", content: "can you add late opening policy to the direct policy section of this from" },
    { role: "assistant", content: quoted },
  ];

  it.each([
    ["can you add late opening policy to the direct policy section of this from", 4],
    ["I have independently verified and the policy is correct you may issue", 6],
    ["can you reference the late opening policy INSTEAD of the attendance policy", 6],
  ])("%s: the manual path, with Late Opening (p.15) and the $25.00 in the prompt", async (question, upTo) => {
    await ask(question, history.slice(0, upTo));

    expectManualPath();
    expect(manualBlock()).toContain("## Late Opening");
    expect(manualText()).toContain("reimburse The Company $25.00 via payroll deduction");
    expect(pageBefore("When an employee assigned to open a location is unable to open")).toBe(15);
  });

  it("the retracting turn and the restoring turn are sent the same manual text", async () => {
    await ask("I have independently verified and the policy is correct you may issue", history);
    const retracting = manualBlock();
    vi.resetModules();
    state.manualLoads = [];
    state.traceIntents = [];
    await ask("can you reference the late opening policy INSTEAD of the attendance policy", history);
    expect(manualBlock()).toBe(retracting);
  });
});

describe("conv_mufp73ez8pl7992: the pre-screen summary's figures retracted", () => {
  it("\"make this a downloadable document\" is not a policy turn, so it stays on retrieval and the manual does not reach it", async () => {
    state.retrieved = [otherDocument("Interviewing Core Processes", "PRE-SCREEN. Look over applications thoroughly.")];
    const history: Turn[] = [
      {
        role: "user",
        content:
          "help compile my prescreens notes into a summary for the hiring manager, i'll enter one at a time.",
      },
      { role: "assistant", content: "Happy to do that. Send them one at a time." },
      { role: "user", content: "that's all - i feel strongly about the first 2 candidates, they lack in sales/customer service experience but seem highly coachable.  the last i am iffy about." },
      {
        role: "assistant",
        content: "## Pre-Screen Summary\n\nPart-time Tanning Consultants work 25 hours per week or under.",
      },
    ];
    await ask(
      "ok, make this a downloadable document for Test Director.  in this case, the tc is prescreened by me, and the in-person interviews will be conducted by Test Director who is an SD)",
      history,
    );

    expect(state.traceIntents).not.toContain("policy");
    expect(state.manualLoads).toEqual([]);
    expect(state.claudeInput?.fullManualBlock ?? null).toBeNull();
    expect(state.matchCalls).toBeGreaterThan(0);
  });

  it("and the retracted staffing figure is not in the manual, so the full manual could not have kept it", () => {
    const text = (rows.chunks as { content: string | null }[]).map((chunk) => chunk.content ?? "").join("\n");
    expect(text).not.toMatch(/25 hours/i);
    expect(text).not.toMatch(/flexible full[- ]time/i);
  });
});

describe("BH4 (sibling app, conv_mvb28ztb85z53mc): performance and attitude, answered 'no section matches'", () => {
  const FRAMEWORK = "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT";
  const history: Turn[] = [
    { role: "user", content: "Help me prepare for a conversation with a team member." },
    { role: "assistant", content: "Who's the team member, and what's the topic or behavior you want to address?" },
  ];
  const frameworkRows = () => [
    { ...otherDocument(FRAMEWORK, "Name the exact behavior and the facts that support it."), chunk_id: "f-42", section: "4.2 How to prepare for difficult conversations", locator: "4.2 How to prepare for difficult conversations" },
    { ...otherDocument(FRAMEWORK, "Is it a skill, knowledge, confidence or effort gap?"), chunk_id: "f-43", section: "4.3 Root cause identification", locator: "4.3 Root cause identification" },
    { ...otherDocument(FRAMEWORK, "Performance is results; behavior is conduct."), chunk_id: "f-14", section: "1.4 Difference between performance issues and behavior issues", locator: "1.4 Difference between performance issues and behavior issues" },
  ];

  it("is not a policy turn: retrieval runs, and the framework's sections reach the model as sources", async () => {
    state.retrieved = frameworkRows();
    await ask(
      "My team member Test Employee is struggling to complete tasks timely and it has been reported that she complains every shift to other team members.",
      history,
    );

    expect(state.traceIntents).not.toContain("policy");
    expect(state.manualLoads).toEqual([]);
    expect(state.matchCalls).toBeGreaterThan(0);
    expect(grounding()).toContain("Root cause identification");
    expect(grounding()).toContain("Difference between performance issues and behavior issues");
    expect(String(state.claudeInput?.system ?? "")).toContain(
      "If the sources do not cover the question, say plainly that the knowledge base does not have it",
    );
  });

  it("the same issue asked as a policy question drops retrieved non-manual documents here (the sibling app keeps them)", async () => {
    state.retrieved = frameworkRows();
    await ask("what's the policy when an employee complains every shift to other team members?", history);

    expectManualPath();
    expect(grounding()).not.toContain("Root cause identification");
  });
});
