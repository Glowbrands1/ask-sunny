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

/*
 * QA2 (21 Nov 2026), #1180 live on main 37c2ad82, PARTIAL (the person invented): the live card's account read "She was 40
 * minutes late on 11/18, the third time in two months." The pass added that whole sentence ("<P> was 40 minutes late on
 * 11/18, the third time in two months."), so the lateness was stated twice. Only the missing clause is added, as a short
 * sentence of its own.
 */
describe("account facts kept: a missing appositive clause alone (f083 follow-up)", () => {
  const card = "She was 40 minutes late on 11/18, the third time in two months. A customer said they won't come back because nobody was at the desk.";
  const drafted =
    "Observed:\nRemy was 40 minutes late to work on November 18, 2026. A customer stated they would not return because nobody was at the desk.\n\nExpectation:\nRemy is expected to arrive on time for every scheduled shift.";

  it("adds \"This is the third time in two months.\", never the lateness again", () => {
    expect(missingAccountFacts(drafted, card, "Remy Calder")).toEqual(["This is the third time in two months."]);
  });

  it("a missing \"which …\" clause reads as its own sentence", () => {
    expect(missingAccountFacts("Observed:\nRemy was 40 minutes late on 11/18.", "Remy was 40 minutes late on 11/18, which made the salon open late for six guests.", "Remy Calder")).toEqual([
      "This made the salon open late for six guests.",
    ]);
  });
});

describe("account facts kept: a whole clause is never turned into a phrase", () => {
  it("\"…, the doors were not unlocked\" stays a sentence of its own", () => {
    expect(missingAccountFacts("Observed:\nRemy arrived at 9:38 on 11/18.", "Remy arrived at 9:38 on 11/18, the doors were not unlocked until then.", "Remy Calder")).toEqual([
      "The doors were not unlocked until then.",
    ]);
  });
});

/*
 * Port from the sibling app (its QA's live re-test of the loop, 21 Nov 2026, A2–A5; Remy Calder is the pack's invented
 * person): every saved CA's Observation stated the offense twice, "<P> did not attend the monthly meeting on October 20,
 * 2026. <P> did not attend the monthly meeting on 10-20-26.", and A3 also tacked on "...by the 10-15-26 deadline. On
 * 10-20-26." The manager's dashed dates were not read as the dates the drafter wrote out, so each sentence holding one
 * looked missing.
 */
describe("account facts kept: a dashed date is the same date written out (sibling's QA live re-test, A2–A5)", () => {
  it("\"create verbal ca for <name> for not attending the monthly meeting on 10-20-26\": the reworded sentence holds it, nothing is added", () => {
    const drafted = "Observed:\nRemy did not attend the monthly meeting on October 20, 2026.\n\nExpectation:\nRemy is expected to attend every monthly meeting.";
    const { text, added } = withAccountFactsKept(drafted, "Remy did not attend the monthly meeting on 10-20-26.", "Remy Calder");
    expect(added).toEqual([]);
    expect(text).toBe(drafted);
  });

  it("A3: the drafter wrote both dates out; no \"This was due by the 10-15-26 deadline.\" and no dangling \"On 10-20-26.\" is tacked on", () => {
    const account = "On 10-20-26, Remy had still not completed the tanning safety training, which was due by the 10-15-26 deadline.";
    const drafted = "Observed:\nAs of October 20, 2026, Remy had still not completed the tanning safety training, which was due by the October 15, 2026 deadline.";
    expect(missingAccountFacts(drafted, account, "Remy Calder")).toEqual([]);
  });

  it("control: a fact the drafter really dropped is still added, dashed date and all", () => {
    expect(missingAccountFacts("Observed:\nRemy did not attend the monthly meeting on October 20, 2026.", "Remy did not attend the monthly meeting on 10-20-26. She also missed the 10-27-26 meeting.", "Remy Calder")).toEqual([
      "Remy also missed the 10-27-26 meeting.",
    ]);
  });
});
