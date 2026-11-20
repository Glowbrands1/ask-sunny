import { describe, expect, it } from "vitest";

import { missingAccountFacts, withAccountFactsKept } from "./account-facts-kept";

/*
 * QA's live test of #1121 (20 Nov 2026, f061; Tester-Sunny 2's invented "Test Testy" is Remy Calder here): the saved
 * Observation dropped "This is the third time in two months …" and "one customer said she would not come back …".
 */
const ACCOUNT =
  "Remy Calder finally arrived at 9:38, thirty-eight minutes after the scheduled opening time. During those thirty-eight minutes at least six scheduled sessions were lost, two customers asked for refunds on their memberships, and one customer said she would not come back because this was the second time she had been left waiting outside. This is the third time in two months that Remy Calder has opened late.";

describe("account facts kept (f061)", () => {
  it("adds the two facts the drafter dropped, in the card's words, at the end of Observed", () => {
    const drafted =
      "Observed:\nRemy Calder finally arrived at 9:38, thirty-eight minutes after the scheduled opening time. During those thirty-eight minutes at least six scheduled sessions were lost and two customers asked for refunds on their memberships.\n\nExpectation:\nRemy is expected to open on time.";
    const { text, added } = withAccountFactsKept(drafted, ACCOUNT, "Remy Calder");
    expect(added).toEqual([
      "One customer said she would not come back because this was the second time she had been left waiting outside.",
      "This is the third time in two months that Remy Calder has opened late.",
    ]);
    expect(text).toBe(
      "Observed:\nRemy Calder finally arrived at 9:38, thirty-eight minutes after the scheduled opening time. During those thirty-eight minutes at least six scheduled sessions were lost and two customers asked for refunds on their memberships. One customer said she would not come back because this was the second time she had been left waiting outside. This is the third time in two months that Remy Calder has opened late.\n\nExpectation:\nRemy is expected to open on time.",
    );
  });

  it("adds nothing when every fact is there, reworded or with the date written out", () => {
    const reworded =
      "Remy arrived at 9:38, thirty-eight minutes after the scheduled opening time. In those thirty-eight minutes at least six scheduled sessions were lost, two customers requested membership refunds, and one customer said she would not come back because this was the second time she had been left waiting outside. This is the third time in two months that Remy has opened late.";
    expect(missingAccountFacts(reworded, ACCOUNT, "Remy Calder")).toEqual([]);
    expect(missingAccountFacts("Observed:\nRemy was 20 minutes late to her shift on November 14, 2026.", "Remy was 20 minutes late to her shift on 11/14.", "Remy Calder")).toEqual([]);
  });

  it("changes nothing with no account or no write-up", () => {
    expect(withAccountFactsKept("Observed:\nRemy was late.", "", "Remy Calder")).toEqual({ text: "Observed:\nRemy was late.", added: [] });
    expect(withAccountFactsKept("", ACCOUNT, "Remy Calder")).toEqual({ text: "", added: [] });
  });
});
