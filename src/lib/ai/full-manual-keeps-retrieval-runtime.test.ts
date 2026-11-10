import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * FULL_MANUAL_KEEPS_RETRIEVAL — the tester's three questions, the live answer path
 * ============================================================================
 *
 * Ask Sunny production, 10 Nov 2026 19:12–19:13Z (QA's finding). The tester asked, word for word:
 *   conv_mwb2gsx52k6reh7  "how do i coach on the spray tan booth reset step after cleaning?"
 *   conv_mwb2hmb62lroh57  "how do I reset the spray tan equipment after cleaning it, so I can coach my team on it?"
 *   conv_mwb2iugw2fxzr9z  "What are the Spray Tan Cleaning Instructions from the Tanning Consultant Manual? What do I do last, to
 *                          reset the equipment?"
 * The normalizer labelled the first and third "policy", so with FULL_MANUAL_CONTEXT on the turn put only the JBA Policy
 * Manual in the prompt and searched nothing: "I don't have a Tanning Consultant Manual in the knowledge base". Here the
 * normalizer's label is "policy" for all three (the second was labelled "other" live; a "policy" label is what sends a turn
 * down this path). The excerpt below stands in for the TC Tanning Consultant Manual's "Spray Tan Cleaning Instructions";
 * the wording is invented, the title is the indexed document's.
 */

const QUESTIONS = [
  "how do i coach on the spray tan booth reset step after cleaning?",
  "how do I reset the spray tan equipment after cleaning it, so I can coach my team on it?",
  "What are the Spray Tan Cleaning Instructions from the Tanning Consultant Manual? What do I do last, to reset the equipment?",
] as const;

const TC_TITLE = "TC Tanning Consultant Manual 8.4.2026";
const TC_STEP = "After the booth is wiped down, reset the booth from the control panel before the next guest.";

const state = vi.hoisted(() => ({
  grounding: "",
  fullManualBlock: undefined as string | null | undefined,
  reply: "",
  matched: 0,
  /** How many searches had started when the normalizer answered (QA's option C: the search overlaps it). */
  matchedWhenNormalized: -1,
  rows: [] as unknown[],
}));

vi.mock("./message-normalize-claude", () => ({
  normalizeForChat: async (input: { question: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    state.matchedWhenNormalized = state.matched;
    return { answerText: input.question, routingText: input.question, modelQuery: null, intent: "policy" };
  },
}));
vi.mock("./query-rewrite-claude", () => ({
  rewriteToManualTerms: async (input: { question: string }) => input.question,
}));
vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));
vi.mock("./form-proposal", () => ({ proposeFormForTurn: async () => null, suggestFormsForTurn: () => null }));
vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));

/* The production manual rows, read through the loader's own row mapping. */
vi.mock("./full-manual-load", async (importOriginal) => {
  const original = await importOriginal<typeof import("./full-manual-load")>();
  const { choosePolicyManuals } = await import("./full-manual-context");
  const fixture = (await import("@/test/fixtures/jba-manual-production-151.json")).default;
  return {
    ...original,
    loadFullManualContext: async (input: { question: string }) =>
      choosePolicyManuals(input.question, [
        {
          id: fixture.document_ids["ask-sunny"],
          title: fixture.title,
          category: "policies_compliance",
          chunks: (fixture.chunks as import("./full-manual-load").ChunkRow[]).map(original.manualChunkFromRow),
        },
      ]),
  };
});

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      state.matched += 1;
      return state.rows;
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
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
  callClaude: async (input: { grounding: string; fullManualBlock?: string | null }) => {
    state.grounding = input.grounding;
    state.fullManualBlock = input.fullManualBlock;
    return state.reply;
  },
}));

const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } };

function row(id: string, title: string, section: string, content: string, similarity: number) {
  return {
    chunk_id: id,
    document_id: `doc-${id}`,
    document_title: title,
    category: "training",
    locator: section,
    page: 21,
    section,
    content,
    similarity,
  };
}

async function ask(question: string) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      context: { userName: "Dana Reyes", locationName: "All areas", todayIso: "2026-11-10" },
    } as never,
    ACTOR as never,
  );
}

const FLAGS = ["FULL_MANUAL_CONTEXT_ENABLED", "QUERY_REWRITE_ENABLED", "FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED"];
const saved = Object.fromEntries(FLAGS.map((name) => [name, process.env[name]]));

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  process.env.FULL_MANUAL_CONTEXT_ENABLED = "1";
  process.env.QUERY_REWRITE_ENABLED = "1";
  delete process.env.FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED;
  state.grounding = "";
  state.fullManualBlock = undefined;
  state.matched = 0;
  state.matchedWhenNormalized = -1;
  state.rows = [
    row("tc-cleaning", TC_TITLE, "Spray Tan Cleaning Instructions", TC_STEP, 0.87),
    row("jba-care", "JBA Policy Manual Edited 5.2025", "Care and Cleaning of Equipment and Facilities", "Keep the equipment clean.", 0.86),
    row("bcs-other", "Buff City Soap Store Guide", "Cleaning", "Another brand's text.", 0.85),
  ];
  state.reply = `Reset the booth from the control panel before the next guest [S1].`;
});

afterEach(() => {
  for (const name of FLAGS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("FULL_MANUAL_KEEPS_RETRIEVAL: a 'policy'-labelled how-to question still searches the other manuals", () => {
  for (const question of QUESTIONS) {
    it(`flag off (as production today, the defect): "${question}" searches nothing; only the policy manual is in the prompt`, async () => {
      await ask(question);
      expect(state.fullManualBlock, "the full-manual path").toBeTruthy();
      expect(state.matched).toBe(0);
      expect(state.grounding).not.toContain(TC_TITLE);
    });

    it(`flag on: "${question}" gives the TC manual's excerpt beside the policy manual, and cites it`, async () => {
      process.env.FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED = "1";
      const response = await ask(question);
      expect(state.fullManualBlock, "the policy manual is still in the prompt").toBeTruthy();
      expect(state.matched).toBeGreaterThan(0);
      expect(state.grounding).toContain(`[S1] ${TC_TITLE}`);
      expect(state.grounding).toContain(TC_STEP);
      // The policy manual is not repeated as an [S#] excerpt, and another brand's document is not given.
      expect(state.grounding).not.toContain("JBA Policy Manual Edited 5.2025");
      expect(state.grounding).not.toContain("Buff City Soap Store Guide");
      expect(response.citations.map((citation) => citation.documentTitle)).toContain(TC_TITLE);
    });
  }

  it("flag on: the search starts with the normalizer (before it answers) and runs once", async () => {
    process.env.FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED = "1";
    await ask(QUESTIONS[0]);
    expect(state.matchedWhenNormalized).toBe(1);
    expect(state.matched).toBe(1);
    expect(state.grounding).toContain(TC_STEP);
  });

  it("flag off: no search starts early", async () => {
    await ask(QUESTIONS[0]);
    expect(state.matchedWhenNormalized).toBe(0);
  });

  it("flag off: the grounding is byte-for-byte what it was before the flag existed", async () => {
    const unset = await ask(QUESTIONS[0]);
    const unsetGrounding = state.grounding;
    process.env.FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED = "off";
    const off = await ask(QUESTIONS[0]);
    expect(state.grounding).toBe(unsetGrounding);
    expect(off.content).toBe(unset.content);
  });

  it("flag on, nothing beside the manual: the grounding is the manual's own note, as with the flag off", async () => {
    state.rows = [row("jba-care", "JBA Policy Manual Edited 5.2025", "Care", "Keep the equipment clean.", 0.86)];
    await ask(QUESTIONS[0]);
    const off = state.grounding;
    process.env.FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED = "1";
    await ask(QUESTIONS[0]);
    expect(state.grounding).toBe(off);
  });
});
