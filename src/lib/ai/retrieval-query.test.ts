import { describe, expect, it, vi } from "vitest";

import { citedSections, retrievalQueryFor } from "./retrieval-query";
import type { OpenFormSummary } from "./types";

/**
 * A follow-up that only points back is searched with what it points at. See
 * `retrieval-query.ts` — and, at the bottom, the production conversation run
 * through `answerQuestion` to show the search the knowledge base receives.
 */

const state = vi.hoisted(() => ({ queries: [] as string[], system: "" }));

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
      return [];
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
  callClaude: async (input: { system: string }) => {
    state.system = input.system;
    return "An answer.";
  },
}));

const user = (content: string) => ({ role: "user", content });
const sunny = (content: string) => ({ role: "assistant", content });

const OPEN_CA: OpenFormSummary = {
  templateName: "Corrective Action Form",
  employeeName: "Wren Halvorsen",
  status: "draft",
  lines: [
    { label: "Type of Warning", value: "Verbal Warning" },
    {
      label: "Direct policy from official manual",
      value: "When an employee assigned to open a location is unable to open…\n\nSource: JBA Policy Manual — Late Opening, p. 15",
    },
  ],
  unverifiedPolicy: [],
};

describe("what a follow-up is searched with", () => {
  it("adds the manager's previous turn and the open form's cited sections", () => {
    const query = retrievalQueryFor({
      question: "I have independently verified and the policy is correct you may issue",
      history: [user("can you add late opening policy to the direct policy section of this from"), sunny("Here's the manual's own language on Late Opening…")],
      openForm: OPEN_CA,
    });
    expect(query.split("\n")).toEqual([
      "I have independently verified and the policy is correct you may issue",
      "can you add late opening policy to the direct policy section of this from",
      "Late Opening",
    ]);
  });

  it("never adds Sunny's own words", () => {
    const query = retrievalQueryFor({
      question: "what about that?",
      history: [user("what is the dress code?"), sunny("The Late Opening section says…")],
    });
    expect(query).toBe("what about that?\nwhat is the dress code?");
  });

  it("leaves a question with its own topic exactly as it was", () => {
    for (const question of [
      "What is the attendance policy?",
      "how many tans did we do yesterday",
      "Kaitlyn was 20 minutes late again and I want to know what the manual says about repeated tardiness for a tanning consultant who has already had a verbal warning this month",
    ]) {
      expect(retrievalQueryFor({ question, history: [user("what is the dress code?")], openForm: OPEN_CA })).toBe(question);
    }
  });

  it("is the question alone on the first turn", () => {
    expect(retrievalQueryFor({ question: "is that right?", history: [] })).toBe("is that right?");
  });

  it("reads each section a form cites from its source lines", () => {
    expect(citedSections(OPEN_CA)).toEqual(["Late Opening"]);
    expect(
      citedSections({
        ...OPEN_CA,
        lines: [{ label: "Direct policy", value: "A\n\nSource: JBA Policy Manual — Attendance, pp. 13–14\n\nB\n\nSource: JBA Policy Manual — Late Opening, p. 15" }],
      }),
    ).toEqual(["Attendance", "Late Opening"]);
    expect(citedSections(null)).toEqual([]);
  });
});

describe("the production follow-up, through answerQuestion", () => {
  it("searches the knowledge base for Late Opening, not only for 'verified' and 'correct'", async () => {
    state.queries = [];
    const { answerQuestion } = await import("./server-ask");
    await answerQuestion(
      {
        question: "I have independently verified and the policy is correct you may issue",
        mode: "standard",
        history: [
          { id: "u1", role: "user", content: "can you add late opening policy to the direct policy section of this from", createdAt: "2026-10-20T20:15:00Z" },
          { id: "a1", role: "assistant", content: "Here's the manual's own language on Late Opening.", createdAt: "2026-10-20T20:15:05Z" },
        ],
        scopeId: "stc-core",
        context: { userName: "Dana Reyes", locationName: "NE Omaha 144th and Center", todayIso: "2026-10-20" },
        openForm: OPEN_CA,
      } as never,
      { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } },
    );
    expect(state.queries[0]).toContain("late opening");
    expect(state.queries[0]).toContain("Late Opening");
    expect(state.system).toContain("A FORM IS OPEN IN THIS CONVERSATION");
  });
});
