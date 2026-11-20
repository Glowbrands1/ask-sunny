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

/*
 * QA's live test of #1152 (20 Nov 2026, f083; draft c6a29914, the person invented): "ca for <P>, she was 40 minutes late
 * on 11/18, this is the third time in two months, I've had two verbal talks with her already, and a customer said they
 * won't come back because nobody was at the desk". The card's account was appended whole: the lateness and the customer
 * twice, and the manager's "She". Only the missing fact is added, in the form's voice; a fact already there in other words
 * ("would not return" for "won't come back", "November 18, 2026" for "11/18") is never added again.
 */
describe("account facts kept: only the missing fact (f083)", () => {
  const card = "She was 40 minutes late on 11/18, this is the third time in two months. A customer said they won't come back because nobody was at the desk.";
  const drafted =
    "Observed:\nRemy was 40 minutes late to work on November 18, 2026. A customer stated they would not return because nobody was at the desk.\n\nExpectation:\nRemy is expected to arrive on time for every scheduled shift.";

  it("adds only \"This is the third time in two months.\", never the account again", () => {
    expect(missingAccountFacts(drafted, card, "Remy Calder")).toEqual(["This is the third time in two months."]);
    expect(withAccountFactsKept(drafted, card, "Remy Calder").text).toBe(
      "Observed:\nRemy was 40 minutes late to work on November 18, 2026. A customer stated they would not return because nobody was at the desk. This is the third time in two months.\n\nExpectation:\nRemy is expected to arrive on time for every scheduled shift.",
    );
  });

  it("an added clause that opens with she/he names the person by first name", () => {
    expect(missingAccountFacts("Observed:\nA customer complained.", "She left early on 11/18 without telling anyone.", "Remy Calder")).toEqual([
      "Remy left early on 11/18 without telling anyone.",
    ]);
  });
});
