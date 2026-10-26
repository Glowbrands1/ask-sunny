import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BRAND_REPLY_GUARD_ENABLED through `answerQuestion` (ported from the sibling
 * app, testers U1/U6): a reply that lists every brand the JBA manual covers,
 * to the managers' questions in lowercase and sentence case.
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

async function ask(question: string, history: readonly never[]) {
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
  state.reply =
    "The attendance policy applies across all brands (Buff City Soap, Crunch, Sun Tan City, JB & Associates office) [S1]. A no call no show may result in termination [S1].";
});
afterEach(() => vi.unstubAllEnvs());
// Flag-off pins hold whatever the environment has on; flag-on tests set it.
beforeEach(() => vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", ""));

const QUESTIONS = [
  "what does our policy say about attendance?",
  "What does our policy say about attendance?",
  "late opening policy",
  "Late opening policy",
  "whats policy say about changing availabilty",
  "Whats policy say about changing availabilty",
  "WHAT DOES OUR POLICY SAY ABOUT ATTENDANCE",
];

describe("the attendance answer", () => {
  it.each(QUESTIONS)("flag on: %s never names the sibling company", async (question) => {
    vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");
    const answer = await ask(question, []);
    expect(answer.content).not.toMatch(/buff city/i);
    expect(answer.content).toMatch(/no call no show/);
  });

  it("flag off: the sibling company is in the reply (the leak)", async () => {
    const answer = await ask(QUESTIONS[0]!, []);
    expect(answer.content).toMatch(/buff city/i);
  });
});
