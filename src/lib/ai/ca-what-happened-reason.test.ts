import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { askCaWhatHappened } = await import("./ca-what-happened");

/*
 * QA, this app's production with CA_SALES_POLICY_ENABLED on, 4 Nov 2026: a
 * reason given ("Not meeting sales requirements", "for not completing her
 * woven courses by the deadline") was answered "You haven't told me what
 * happened yet". QA's wording, the people invented.
 */
const card = (employeeName: string) => ({
  content: `I'll draft a **Corrective Action Form** for **${employeeName}** from what you've described.`,
  citations: [],
  formProposal: { templateKey: "dpoa", templateName: "Corrective Action Form", employeeName } as never,
});
const NOTE = /You haven't told me what happened yet/;

function flags(on: boolean) {
  vi.stubEnv("CA_ASKS_WHAT_HAPPENED_ENABLED", "true");
  vi.stubEnv("CA_SALES_POLICY_ENABLED", on ? "true" : "false");
}
afterEach(() => vi.unstubAllEnvs());

describe("a \"not\" before what the employee failed to do is the account (CA_SALES_POLICY_ENABLED)", () => {
  it("QA's wordings: no note", () => {
    flags(true);
    for (const [say, name] of [
      ["I need a Corrective Action for Brielle Oakhurst. Not meeting sales requirements.", "Brielle Oakhurst"],
      ["create a corrective action for Wrenna Halvik for not completing her woven courses by the deadline of october 31st", "Wrenna Halvik"],
      ["create a verbal ca for tanning consultant ondine marsk at liberty. ondine did not follow must see behaviors for october 2026 which violates standards of conduct policy", "Ondine Marsk"],
    ] as const) {
      expect(askCaWhatHappened(card(name), say, []).content, say).not.toMatch(NOTE);
    }
  });

  it("a denial of a fault is still no account: the note stays", () => {
    flags(true);
    expect(askCaWhatHappened(card("Brielle Oakhurst"), "create a corrective action for Brielle Oakhurst, she was never late", []).content).toMatch(NOTE);
    expect(askCaWhatHappened(card("Brielle Oakhurst"), "create a corrective action for Brielle Oakhurst", []).content).toMatch(NOTE);
  });

  it("off: any negation is no account, as on main", () => {
    flags(false);
    expect(askCaWhatHappened(card("Brielle Oakhurst"), "I need a Corrective Action for Brielle Oakhurst. Not meeting sales requirements.", []).content).toMatch(NOTE);
  });
});
