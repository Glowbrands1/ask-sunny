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
