import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FRAMEWORK_GENERAL_SECTIONS_RULE, stripMarkers } from "./prompts";
import { earlierAnsweredTurn, isReformatTurn, keepEarlierSources } from "./reformat-turn";

/**
 * QA, 25 Oct 2026, approved proposals from the chat-history review.
 *
 *   conv_mufp73ez8pl7992 (REFORMAT_KEEPS_SOURCES_ENABLED): a pre-screen summary
 *   cited two company documents. "ok, make this a downloadable document for …"
 *   was searched on its own words, the documents were not found again, and the
 *   reply retracted the summary's figures ("none of that is in the knowledge
 *   base I can see") and read "I cited two markers, and, that are not valid
 *   sources" once its markers were stripped.
 *
 *   conv_mvb28ztb85z53mc, the sibling app (FRAMEWORK_GENERAL_SECTIONS_ENABLED):
 *   "struggling to complete production timely … complains every shift" was
 *   answered "the knowledge base doesn't have a section that matches" with the
 *   framework's general sections in the sources. Here in this app's wording.
 *
 * People's names are test names. The live model's wording is not tested.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  queries: [] as string[],
  rowsFor: (() => []) as (query: string) => unknown[],
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

vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match(input: { query: string }) {
      state.queries.push(input.query);
      return state.rowsFor(input.query);
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "missing" };
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => ({ available: false, block: null, reason: "no dataset" }),
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeInput = input;
    return "An answer.";
  },
}));

type Turn = { role: "user" | "assistant"; content: string };

const ORIGINAL = { ...process.env };

async function ask(question: string, history: Turn[]) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      context: { userName: "Test Manager", locationName: "Test Salon", todayIso: "2026-09-24" },
    } as never,
    {
      role: "salon_director" as never,
      scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
    },
  );
}

function row(id: string, title: string, section: string | null, content: string, similarity = 0.85) {
  return {
    chunk_id: id,
    document_id: `doc-${id}`,
    document_title: title,
    category: "operations",
    locator: section ?? "Page 1",
    page: 1,
    section,
    content,
    similarity,
  };
}

const grounding = () => String(state.claudeInput?.grounding ?? "");
const system = () => String(state.claudeInput?.system ?? "");

// The first import of server-ask is the slow part; under load it alone passed 5s.
vi.setConfig({ testTimeout: 60_000 });

beforeAll(async () => {
  await import("./server-ask");
}, 120_000);

/* ------------------------------------------------- conv_mufp73ez8pl7992 -- */

const MAKE_DOCUMENT =
  "ok, make this a downloadable document for Test Director.  in this case, the tc is prescreened by me, and the in-person interviews will be conducted by Test Director who is an SD)";
const BULLETS = "can this be formatted with bullet points ?";
const SUMMARY_ASKED =
  "that's all - i feel strongly about the first 2 candidates, they lack in sales/customer service experience but seem highly coachable.  the last i am iffy about.";

const PRESCREEN_HISTORY: Turn[] = [
  { role: "user", content: "help compile my prescreens notes into a summary for the hiring manager, i'll enter one at a time." },
  { role: "assistant", content: "Happy to do that. Send them one at a time." },
  { role: "user", content: SUMMARY_ASKED },
  {
    role: "assistant",
    content: "## Pre-Screen Summary\n\nPart-time Tanning Consultants work 25 hours per week or under.",
  },
];

const HIRING_ROW = row(
  "hiring-1",
  "Test Hiring Guide",
  "Positions",
  "Tanning Consultants (Part Time is 25 hours per week or under and must be at least 18 years old)",
);
const UNRELATED_ROW = row("other-1", "Test Downloads Guide", null, "How to download a file from the portal.");

describe("conv_mufp73ez8pl7992: the manager's reformat turns are read as reformats", () => {
  it.each([MAKE_DOCUMENT, BULLETS, "put that in a table", "summarize that"])("%s", (question) => {
    expect(isReformatTurn(question, PRESCREEN_HISTORY)).toBe(true);
  });

  it.each([
    "create a coaching form for Test Employee",
    "what's the policy on bereavement",
    "make this a verbal warning",
    "is there a prescreen form i can use?",
  ])("%s is not a reformat", (question) => {
    expect(isReformatTurn(question, PRESCREEN_HISTORY)).toBe(false);
  });

  it("is never a reformat with no earlier answer to reshape", () => {
    expect(isReformatTurn(MAKE_DOCUMENT, [{ role: "user", content: SUMMARY_ASKED }])).toBe(false);
  });

  it("finds the turn the summary answered, past an earlier reformat", () => {
    expect(earlierAnsweredTurn(PRESCREEN_HISTORY)?.question).toBe(SUMMARY_ASKED);
    const afterDocument: Turn[] = [
      ...PRESCREEN_HISTORY,
      { role: "user", content: MAKE_DOCUMENT },
      { role: "assistant", content: "**PRE-SCREEN SUMMARY**" },
    ];
    expect(earlierAnsweredTurn(afterDocument)?.question).toBe(SUMMARY_ASKED);
  });

  it("keeps the earlier answer's rows first, each once", () => {
    const kept = keepEarlierSources([HIRING_ROW], [UNRELATED_ROW, HIRING_ROW], 8);
    expect(kept.map((entry) => entry.chunk_id)).toEqual(["hiring-1", "other-1"]);
  });
});

describe("conv_mufp73ez8pl7992 through answerQuestion", () => {
  beforeEach(() => {
    vi.resetModules();
    state.claudeInput = null;
    state.queries = [];
    state.rowsFor = (query: string) => (query.includes("feel strongly") ? [HIRING_ROW] : [UNRELATED_ROW]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("on: the summary's source is in the grounding of the 'downloadable document' turn", async () => {
    process.env.REFORMAT_KEEPS_SOURCES_ENABLED = "true";
    await ask(MAKE_DOCUMENT, PRESCREEN_HISTORY);

    expect(state.queries.some((query) => query.includes("feel strongly"))).toBe(true);
    expect(grounding()).toContain("Part Time is 25 hours per week or under");
    expect(grounding().indexOf("Test Hiring Guide")).toBeLessThan(grounding().indexOf("Test Downloads Guide"));
  });

  it("on: and in the grounding of the bullet-points turn after it", async () => {
    process.env.REFORMAT_KEEPS_SOURCES_ENABLED = "true";
    await ask(BULLETS, [
      ...PRESCREEN_HISTORY,
      { role: "user", content: MAKE_DOCUMENT },
      { role: "assistant", content: "**PRE-SCREEN SUMMARY — OVERLAND PARK, TANNING CONSULTANT**" },
    ]);
    expect(grounding()).toContain("Part Time is 25 hours per week or under");
  }, 30_000);

  it("off: the turn is searched on its own words only, as in production", async () => {
    delete process.env.REFORMAT_KEEPS_SOURCES_ENABLED;
    await ask(MAKE_DOCUMENT, PRESCREEN_HISTORY);
    expect(state.queries.some((query) => query.includes("feel strongly"))).toBe(false);
    expect(grounding()).not.toContain("25 hours");
  }, 30_000);
});

describe("conv_mufp73ez8pl7992: removing markers leaves no dangling words", () => {
  const MODEL_WROTE = "Before the document — I need to correct three things I put in that last summary. I cited two markers, [S6] and [S7], that are not valid sources.";

  it("off: what production showed", () => {
    expect(stripMarkers(MODEL_WROTE)).toContain("I cited two markers, and, that are not valid sources.");
  });

  it("on: the joined markers go with their commas and their 'and'", () => {
    const out = stripMarkers(MODEL_WROTE, { tidy: true });
    expect(out).toContain("I cited two markers that are not valid sources.");
    expect(out).not.toMatch(/,\s*and\s*,/);
  });

  it.each([
    ["Coach in private [S1][S3].", "Coach in private."],
    ["Coach in private [S1], [S2] and [S3].", "Coach in private."],
    ["Shoes must be closed toe (see [S2]).", "Shoes must be closed toe."],
    ["Two things [S1]; then more [S2].", "Two things; then more."],
    ["- [S2]\n- Real item [S3]", "- Real item"],
    ["Keep the [S1x] text and 1 and 2 [S1] and the rest.", "Keep the [S1x] text and 1 and 2 and the rest."],
  ])("%s", (input, expected) => {
    expect(stripMarkers(input, { tidy: true })).toBe(expected);
  });

  it("is wired to the flag in answerQuestion", async () => {
    vi.resetModules();
    state.rowsFor = () => [UNRELATED_ROW];
    const original = process.env.REFORMAT_KEEPS_SOURCES_ENABLED;
    process.env.REFORMAT_KEEPS_SOURCES_ENABLED = "true";
    const { answerQuestion } = await import("./server-ask");
    const callClaude = await import("./call-claude");
    vi.spyOn(callClaude, "callClaude").mockResolvedValueOnce(MODEL_WROTE);
    const answer = await answerQuestion(
      {
        question: MAKE_DOCUMENT,
        mode: "standard",
        history: PRESCREEN_HISTORY,
        scopeId: "stc-core",
        context: { userName: "Test Manager", locationName: "Test Salon", todayIso: "2026-09-24" },
      } as never,
      { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] } },
    );
    if (original === undefined) delete process.env.REFORMAT_KEEPS_SOURCES_ENABLED;
    else process.env.REFORMAT_KEEPS_SOURCES_ENABLED = original;
    expect(answer.content).toContain("I cited two markers that are not valid sources.");
  }, 30_000);
});

/* ------------------------------------- conv_mvb28ztb85z53mc, this app -- */

describe("conv_mvb28ztb85z53mc (sibling app), this app's wording: the framework's general sections", () => {
  const FRAMEWORK = "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT";
  const history: Turn[] = [
    { role: "user", content: "Help me prepare for a conversation with a team member." },
    { role: "assistant", content: "Who's the team member, and what's the topic or behavior you want to address?" },
  ];
  const QUESTION =
    "My team member Test Employee is struggling to complete tasks timely and it has been reported that she complains every shift to other team members.";

  beforeEach(() => {
    vi.resetModules();
    state.claudeInput = null;
    state.queries = [];
    state.rowsFor = () => [
      row("f-43", FRAMEWORK, "4.3 Root cause identification", "Is it a skill, knowledge, confidence or effort gap?", 0.88),
      row("f-14", FRAMEWORK, "1.4 Difference between performance issues and behavior issues", "Performance is results; behavior is conduct.", 0.86),
    ];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("on: the prompt says an issue the framework does not name is covered by its general sections", async () => {
    process.env.FRAMEWORK_GENERAL_SECTIONS_ENABLED = "true";
    await ask(QUESTION, history);
    expect(grounding()).toContain("Root cause identification");
    expect(system()).toContain(FRAMEWORK_GENERAL_SECTIONS_RULE);
    expect(system().indexOf(FRAMEWORK_GENERAL_SECTIONS_RULE)).toBeGreaterThan(
      system().indexOf("If the sources do not cover the question"),
    );
  });

  it("on, without the framework among the sources: the prompt is unchanged", async () => {
    process.env.FRAMEWORK_GENERAL_SECTIONS_ENABLED = "true";
    state.rowsFor = () => [UNRELATED_ROW];
    await ask(QUESTION, history);
    expect(system()).not.toContain(FRAMEWORK_GENERAL_SECTIONS_RULE);
  }, 30_000);

  it("off: the prompt is byte-for-byte the prompt without the flag", async () => {
    delete process.env.FRAMEWORK_GENERAL_SECTIONS_ENABLED;
    await ask(QUESTION, history);
    const off = system();
    expect(off).not.toContain(FRAMEWORK_GENERAL_SECTIONS_RULE);
    vi.resetModules();
    process.env.FRAMEWORK_GENERAL_SECTIONS_ENABLED = "true";
    await ask(QUESTION, history);
    expect(system().replace(`\n${FRAMEWORK_GENERAL_SECTIONS_RULE}`, "")).toBe(off);
  }, 30_000);
});
