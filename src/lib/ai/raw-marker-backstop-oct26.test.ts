import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { withoutRawMarkerText } from "./raw-markers";

/**
 * ============================================================================
 * NO RAW [S#] IN A REPLY (RAW_MARKER_BACKSTOP_ENABLED)
 * ============================================================================
 *
 * QA live, 26 Oct 2026: S15b "how do i set up the checking account
 * preference for customer sign-up" printed "...free upgrades [S2]"
 * (conv_mvomnj3mga16lj); S26 printed "[S7]"; E1's PTO answer printed
 * "[S6][S10]". A run of markers with nothing between them kept all but its
 * last one. The page below is INVENTED. Through `answerQuestion`.
 */

const KB_PAGE = "Customer sign-up: the checking account preference is set on the membership screen.";

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
          document_title: "Invented Portal Guide",
          category: "other",
          locator: "Page 28 — Resetting an Employee's Password",
          page: 28,
          section: null,
          content: KB_PAGE,
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
  state.system = "";
  state.grounding = "";
  state.reply = "An answer.";
  state.rewrites = [];
});
afterEach(() => vi.unstubAllEnvs());
// Flag-off pins hold whatever the environment has on; flag-on tests call on().
beforeEach(() => vi.stubEnv("RAW_MARKER_BACKSTOP_ENABLED", ""));

const on = () => vi.stubEnv("RAW_MARKER_BACKSTOP_ENABLED", "true");
const RAW = /\[\s*S\s*\d+\s*\]/i;

const S15B = "how do i set up the checking account preference for customer sign-up";
const QUESTIONS = [S15B, S15B.charAt(0).toUpperCase() + S15B.slice(1), `${S15B.charAt(0).toUpperCase() + S15B.slice(1)}?`];

describe("through answerQuestion", () => {
  const REPLIES = [
    "Set the checking account preference on the membership screen [S1]. Members who pay by checking get free upgrades [S2][S1].",
    "The knowledge base covers this in two places [S6][S10]. Set it on the membership screen.",
    "Set it on the membership screen [S7][S1]. It saves at once.",
  ];

  it("flag off: a run of markers keeps all but its last (the bug)", async () => {
    state.reply = REPLIES[1]!;
    const answer = await ask(S15B, []);
    expect(answer.content).toMatch(RAW);
  });

  it.each(QUESTIONS.flatMap((question) => REPLIES.map((reply) => [question, reply] as const)))("flag on: %s / %s", async (question, reply) => {
    on();
    state.reply = reply;
    const answer = await ask(question, []);
    expect(answer.content).not.toMatch(RAW);
    expect(answer.content).toMatch(/membership screen\./);
  });
});

describe("the text pass", () => {
  it.each([
    ["free upgrades [S2]", "free upgrades"],
    ["two places [S6][S10].", "two places."],
    ["two places [S6] [S10], then more.", "two places, then more."],
    ["as listed (see [S4], [S5]).", "as listed."],
    ["Policy [S3] and [S4] say so.", "Policy say so."],
    ["Late Opening, JBA Policy Manual p.15 [p.15] [S2].", "Late Opening, JBA Policy Manual p.15 [p.15]."],
    ["- Clock in on time [S1]\n- Call ahead [S2]", "- Clock in on time\n- Call ahead"],
  ])("%s", (input, output) => {
    expect(withoutRawMarkerText(input)).toBe(output);
  });

  it.each([
    ["Steps:\n- First step [S1]\n    - nested step [S2]\n    - nested two\n- Second", "Steps:\n- First step\n    - nested step\n    - nested two\n- Second"],
    ["1. Open [S1]\n   a. detail one", "1. Open\n   a. detail one"],
    ["Not allowed (in) the store [S1].", "Not allowed (in) the store."],
    ["Use `arr[S1]` here [S2].", "Use `arr[S1]` here."],
    ["PTO (see [S4], [S5]).", "PTO."],
  ])("QA-5: %s", (input, output) => {
    expect(withoutRawMarkerText(input)).toBe(output);
    expect(withoutRawMarkerText(input.toUpperCase())).toBe(output.toUpperCase());
  });

  it("[p.N] citations and ordinary brackets are untouched", () => {
    const text = "Dress Code [p.15]. Use the [Submit] button.";
    expect(withoutRawMarkerText(text)).toBe(text);
  });
});
