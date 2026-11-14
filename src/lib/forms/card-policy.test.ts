import { describe, expect, it } from "vitest";

import { cardPolicyFor, cardPolicyHeading, cardPolicyPhrase } from "./card-policy";

/** NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED — QA's live check, 3 Nov 2026. */
describe("the policy heading on the card", () => {
  for (const [line, heading] of [
    ["**Policy:** Late Opening Policy, JBA Policy Manual p.15", "Late Opening"],
    ["**Policy:** Attendance, as you said. I'll quote that section from the current policy manual on the draft.", "Attendance"],
    ["**Policy:** Bonus Policy, JBA Policy Manual p.38, as you said", "Bonus"],
    ["**Policy:** Standards of Conduct, as you said — Standards of Conduct Policy, JBA Policy Manual p.12", "Standards of Conduct"],
  ] as const) {
    it(`${JSON.stringify(line)} → ${heading}`, () => {
      expect(cardPolicyHeading(`Here is what I would put on a **Corrective Action Form**.\n\n${line}`)).toBe(heading);
    });
  }

  it("a card that cites no policy sends none", () => {
    expect(cardPolicyHeading("Here is what I would put on a **Coaching Form**.")).toBeNull();
  });

  it("the card the manager pressed Create on, by its proposal id", () => {
    const messages = [
      { role: "assistant", content: "**Policy:** Attendance, as you said", formProposal: { proposalId: "p-1" } },
      { role: "assistant", content: "**Policy:** Late Opening Policy, JBA Policy Manual p.15", formProposal: { proposalId: "p-2" } },
    ] as never;
    expect(cardPolicyFor({ proposalId: "p-2" }, messages)).toBe("Late Opening");
    expect(cardPolicyFor({ proposalId: "p-1" }, messages)).toBe("Attendance");
  });

  it("named as the manual's headings are named in a sentence", () => {
    expect(cardPolicyPhrase("Late Opening")).toBe("Late Opening policy");
    expect(cardPolicyPhrase("Bonus Policy")).toBe("Bonus Policy");
  });
});

/* The agent loop's card carries its policy (code-check audit #40, batch A): Create sends it, whatever the reply's words say. */
describe("a card that carries its own policy", () => {
  const card = (policyLine: string | null, content: string) => [
    { role: "user" as const, content: "ca for her, she opened 20 minutes late" },
    { role: "assistant" as const, content, formProposal: { proposalId: "p-9", policyLine } as never },
  ];
  it("sends the card's policy, not the reply's line", () => {
    expect(cardPolicyFor({ proposalId: "p-9" }, card("Late Opening Policy, JBA Policy Manual p.15", "**Policy:** Attendance Policy, JBA Policy Manual p.14"))).toBe("Late Opening");
    expect(cardPolicyFor({ proposalId: "p-9" }, card("Late Opening Policy, JBA Policy Manual p.15", "Here's the card."))).toBe("Late Opening");
  });
  it("sends none when the card cites none, even if the reply names one", () => {
    expect(cardPolicyFor({ proposalId: "p-9" }, card(null, "**Policy:** Attendance Policy, JBA Policy Manual p.14"))).toBeNull();
  });
});
