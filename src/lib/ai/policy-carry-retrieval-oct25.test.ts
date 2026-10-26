import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { carriedPolicyTopic, isGoAheadTurn } from "./policy-carry-retrieval";

/**
 * ============================================================================
 * "JUST MAKE IT" DOES NOT LOSE THE POLICY ALREADY CITED
 * (POLICY_CARRY_RETRIEVAL_ENABLED) — conv_mvofuq3l2jae1be, the live answer path
 * ============================================================================
 *
 * QA item 10, reported in Ask Bubbles' production, 25 Oct 2026; ported here (names invented):
 *
 *   T1 "do verbl for <name> at <salon>. no payrol deduct. prev coachng jba
 *      manual 11-1-25. on 10-22-26 <name> wasnt scheduled and came in to show
 *      her puppy 45 min"
 *   T2 "cite animals in the workplace policy"   → Animals in the Workplace p.30
 *   T3 "I already told you the salon is <salon>"
 *   T4 "just make it"                           → "The knowledge base doesn't
 *      have anything about an 'animals in the workplace' policy", from
 *      unrelated excerpts
 *
 * T4 was searched on its own three words. With the flag on it is searched
 * with T2, the turn that named the policy. Fails with the flag off.
 */

const state = vi.hoisted(() => ({
  queries: [] as string[],
  system: "",
  grounding: "",
  reply: "",
  rewrites: [] as string[],
}));

vi.mock("./query-rewrite-claude", () => ({
  rewriteToManualTerms: async (input: { question: string }) => {
    state.rewrites.push(input.question);
    return input.question;
  },
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));
vi.mock("./form-proposal", () => ({ proposeFormForTurn: async () => null, suggestFormsForTurn: () => null }));
vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match(query: { query: string }) {
      state.queries.push(query.query);
      return [
        {
          chunk_id: "c1",
          document_id: "d1",
          document_title: "Product Guide: Naturally WOWW Face Lotion",
          category: "other",
          locator: "Page 1",
          page: 1,
          section: null,
          content: "Apply a thin layer after tanning.",
          similarity: 0.8,
        },
      ];
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
  callClaude: async (input: { system: string; grounding: string }) => {
    state.system = input.system;
    state.grounding = input.grounding;
    return state.reply;
  },
}));

const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } };

const turn = (id: string, role: "user" | "assistant", content: string) => ({
  id,
  role,
  content,
  createdAt: "2026-10-25T08:59:00Z",
});
const T1 =
  "do verbl for Wren Okafor at Fairmont. no payrol deduct. prev coachng jba manual 11-1-25. on 10-22-26 Wren wasnt scheduled and came in to show her puppy 45 min";
const T2 = "cite animals in the workplace policy";
const T3 = "I already told you the salon is Fairmont";
const T4 = "just make it";
const HISTORY = [
  turn("h1", "user", T1),
  turn("h2", "assistant", "Which salon is this actually for? I won't guess."),
  turn("h3", "user", T2),
  turn("h4", "assistant", "Animals in the Workplace: The Company doesn't allow pets in the workplace [p.30]."),
  turn("h5", "user", T3),
  turn("h6", "assistant", "Got it. Say \"create a coaching form for Wren Okafor\" and I'll bring up the draft."),
];

async function ask(question: string, history: ReturnType<typeof turn>[]) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      context: { userName: "Dana Reyes", locationName: "All areas", todayIso: "2026-10-25" },
    } as never,
    ACTOR as never,
  );
}

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.queries = [];
  state.reply = "An answer.";
  state.rewrites = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("conv_mvofuq3l2jae1be — T4 \"just make it\"", () => {
  it("flag off: is searched on its own words (the bug)", async () => {
    await ask(T4, HISTORY);
    // Searched on its own words (here with the turn before it); no query names the policy.
    expect(state.queries.some((query) => query.startsWith(T4))).toBe(true);
    expect(state.queries.some((query) => /animals in the workplace/i.test(query))).toBe(false);
  });

  it("flag on: is searched with the turn that named the policy", async () => {
    vi.stubEnv("POLICY_CARRY_RETRIEVAL_ENABLED", "true");
    await ask(T4, HISTORY);
    expect(state.queries.some((query) => query.startsWith(T4))).toBe(false);
    expect(state.queries.length).toBeGreaterThan(0);
    expect(state.queries.every((query) => /animals in the workplace/i.test(query))).toBe(true);
  });

  it("flag on: a turn with its own topic is still searched as typed", async () => {
    vi.stubEnv("POLICY_CARRY_RETRIEVAL_ENABLED", "true");
    const own = "what is the dress code policy?";
    await ask(own, HISTORY);
    expect(state.queries).toContain(own);
  });
});

describe("which turns only say to go ahead", () => {
  it.each(["just make it", "make it", "create it", "do it", "yes", "ok go ahead", "just make the form", "create the draft now", "please do it"])(
    "%s",
    (turn) => expect(isGoAheadTurn(turn)).toBe(true),
  );

  it.each([
    "make it a written warning",
    "create a coaching form for Wren Okafor",
    "just make it say she was late",
    "what is the dress code policy?",
    T3,
  ])("%s carries its own topic", (turn) => expect(isGoAheadTurn(turn)).toBe(false));

  it("with no policy named earlier, the latest topic turn is searched", () => {
    vi.stubEnv("POLICY_CARRY_RETRIEVAL_ENABLED", "true");
    expect(carriedPolicyTopic("do it", [{ role: "user", content: "Wren was rude to a guest" }])).toBe("Wren was rude to a guest");
    expect(carriedPolicyTopic("do it", [{ role: "assistant", content: "the visitors policy" }])).toBeNull();
  });
});
