import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ownSystemsNote, withoutDisownedSystems } from "./own-systems";

/**
 * ============================================================================
 * WOVEN IS THIS COMPANY'S SYSTEM (OWN_SYSTEMS_FACT_ENABLED)
 * ============================================================================
 *
 * QA tester, 26 Oct 2026 (conv_mvolizr326baln0): "do employees have to
 * acknowledge policies in woven" was answered "Short answer: Woven isn't your
 * system — it's <another brand>'s." from the manual's list of where each brand
 * keeps personnel files. The page and the other brand below are INVENTED;
 * the question is the tester's own. Through `answerQuestion`.
 */

/** An invented records page with the same shape: a brand-by-brand systems list. */
const RECORDS_PAGE = [
  "Employee Records",
  "All personnel files are kept in the Personnel Platform Systems via the systems below:",
  "o Example Brand – MyGlow",
  "o Example Fitness – Woven",
].join("\n");

/** The reply's shape on 26 Oct, with the other brand invented. */
const DISOWNING_REPLY =
  "Short answer: Woven isn't your system — it's Example Fitness's. Personnel files run through MyGlow (Employee Records, JBA Policy Manual p.35 [p.35]).\n\nOn the acknowledgement itself: an Acknowledgement of Receipt and Understanding is included in the New Hire Paperwork (Orientation, JBA Policy Manual p.33 [p.33]).";

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
          document_title: "JBA Policy Manual",
          category: "other",
          locator: "Page 35 — Employee Records",
          page: 35,
          section: null,
          content: RECORDS_PAGE,
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
  state.reply = DISOWNING_REPLY;
  state.rewrites = [];
});
afterEach(() => vi.unstubAllEnvs());

const on = () => vi.stubEnv("OWN_SYSTEMS_FACT_ENABLED", "true");
const QUESTION = "do employees have to acknowledge policies in woven";
const QUESTIONS = [QUESTION, "Do employees have to acknowledge policies in woven?", "DO EMPLOYEES HAVE TO ACKNOWLEDGE POLICIES IN WOVEN", "do employees have to acknowledge policies in Woven"];
const DISOWNS = /woven (?:isn'?t|is not) your|example fitness'?s/i;

describe("conv_mvolizr326baln0: Woven is never called another company's", () => {
  it("flag off: the reply says Woven isn't your system, and no fact line (the bug)", async () => {
    const answer = await ask(QUESTION, []);
    expect(answer.content).toMatch(DISOWNS);
    expect(state.grounding).not.toMatch(/uses Woven for/);
  });

  it.each(QUESTIONS)("flag on: %s", async (question) => {
    on();
    const answer = await ask(question, []);
    expect(state.grounding).toContain("Sun Tan City uses Woven for training, assigned learning paths and policy acknowledgements");
    expect(answer.content).not.toMatch(DISOWNS);
    expect(answer.content).toContain("Acknowledgement of Receipt and Understanding");
    expect(answer.content).toContain("Personnel files run through MyGlow");
  });
});

describe("the backstop keeps every other sentence", () => {
  it.each([
    "Assign the policy acknowledgement in Woven and check completion on the learner report.",
    "Woven shows only people who are not your direct reports when you filter by district.",
    "Woven belongs to Sun Tan City's training setup, and the manual covers the rest.",
    "Yes, it's Woven, and the acknowledgement is part of onboarding.",
    "MyGlow isn't your training system; use Woven for that.",
  ])("flag on: %s", (reply) => {
    on();
    expect(withoutDisownedSystems(reply)).toBe(reply);
  });

  it.each([
    "Woven isn't your system.",
    "Woven is not this company's platform.",
    "Woven belongs to Example Fitness.",
    "woven is another brand's tool.",
    "WOVEN IS NOT USED HERE.",
  ])("flag on, the whole reply is the claim: %s -> the fact", (reply) => {
    on();
    expect(withoutDisownedSystems(reply)).toBe("Sun Tan City uses Woven for training, assigned learning paths and policy acknowledgements.");
  });

  it("flag off: the reply is as given, and no fact line", () => {
    expect(withoutDisownedSystems("Woven isn't your system.")).toBe("Woven isn't your system.");
    expect(ownSystemsNote(QUESTION, "")).toBeNull();
  });

  it("flag on: no fact line when nothing names the system", () => {
    on();
    expect(ownSystemsNote("how many pto days do i get", "Paid time Off (PTO)")).toBeNull();
  });
});
