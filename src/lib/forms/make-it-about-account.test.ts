import { describe, expect, it } from "vitest";

import { accountMadeAbout, blendsOldEvent, oldEventWords } from "./make-it-about-account";

// QA's live AI checks, 8 Nov 2026: the draft was about a missed monthly meeting; "make it about showing up late".
const NAME = "Ottoline Ormsworth";
const CURRENT =
  "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline is expected to attend every scheduled meeting.\n\nGoing Forward:\nOttoline will put every scheduled meeting on her calendar.";
const ABOUT = "showing up late";

describe("the earlier event", () => {
  it("is read from the account's Observed part, less the name and X", () => {
    expect([...oldEventWords(CURRENT, ABOUT, NAME)].sort()).toEqual(["meet", "miss", "monthly"]);
  });

  it("is found in a blend, and not in an account about X alone", () => {
    expect(blendsOldEvent("Observed:\nOttoline Ormsworth showed up late to the monthly meeting on 10/10/26.", CURRENT, ABOUT, NAME)).toBe(true);
    expect(blendsOldEvent("Observed:\nOttoline Ormsworth arrived late to her shift on 10/10/26.", CURRENT, ABOUT, NAME)).toBe(false);
  });
});

describe("accountMadeAbout", () => {
  it("writes X alone in the form's outline when the reader blended it into the old event", () => {
    expect(
      accountMadeAbout({
        about: ABOUT,
        current: CURRENT,
        proposed: "Observed:\nOttoline Ormsworth showed up late to the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline is expected to arrive on time.",
        employeeName: NAME,
      }),
      // Changed on purpose (QA, 8 Nov 2026): always the full outline; the form's Going Forward speaks of the meeting, so it is empty.
    ).toBe("Observed:\nShowing up late.\n\nExpectation:\nOttoline is expected to arrive on time.\n\nGoing Forward:");
  });

  it("keeps the reader's text when it is about X and holds none of the old event", () => {
    const proposed = "Observed:\nOttoline Ormsworth arrived late to her shift on 10/10/26.\n\nExpectation:\nOttoline is expected to arrive on time.";
    // Changed on purpose (QA, 8 Nov 2026): always the full outline; the form's Going Forward speaks of the meeting, so it is empty.
    expect(accountMadeAbout({ about: ABOUT, current: CURRENT, proposed, employeeName: NAME })).toBe(`${proposed}\n\nGoing Forward:`);
  });

  it("writes the account when the reader set none, and empties a part that still speaks of the old event", () => {
    expect(accountMadeAbout({ about: ABOUT, current: CURRENT, proposed: null, employeeName: NAME })).toBe(
      "Observed:\nShowing up late.\n\nExpectation:\n\nGoing Forward:",
    );
  });

  // Changed on purpose (QA's live check of ec47a7f, 8 Nov 2026): the account is always written in the full outline,
  // even when the form's text had none, so the manager can see where the expectation and plan go.
  it("an account with no outline is written in the full outline", () => {
    expect(accountMadeAbout({ about: ABOUT, current: "Ottoline missed the monthly meeting.", proposed: null, employeeName: NAME })).toBe(
      "Observed:\nShowing up late.\n\nExpectation:\n\nGoing Forward:",
    );
  });

  it("a reader's \"Observed: Showing up late.\" alone gets the full outline, the form's clean sections kept", () => {
    expect(
      accountMadeAbout({
        about: ABOUT,
        current: "Observed:\nOttoline missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline arrives on time.\n\nGoing Forward:\nOttoline will set reminders.",
        proposed: "Observed:\nShowing up late.",
        employeeName: NAME,
      }),
    ).toBe("Observed:\nShowing up late.\n\nExpectation:\nOttoline arrives on time.\n\nGoing Forward:\nOttoline will set reminders.");
  });
});

describe("on the one writer's draft paths", () => {
  it("keeps the name and dates the account held (its protected values), never the old event", () => {
    expect(
      accountMadeAbout({
        about: ABOUT,
        current: CURRENT,
        proposed: "Observed:\nOttoline Ormsworth showed up late to the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline is expected to arrive on time.",
        employeeName: NAME,
        keepFacts: true,
      }),
      // Changed on purpose (QA, 8 Nov 2026): always the full outline.
    ).toBe("Observed:\nOttoline Ormsworth — showing up late (10/10/26).\n\nExpectation:\nOttoline is expected to arrive on time.\n\nGoing Forward:");
  });
});
