import { describe, expect, it } from "vitest";

import { withoutPersonPronouns } from "./reply-pronouns";

/* QA (16 Nov 2026; Pau's first-name rule): the reply calls the person by name, never a pronoun. Invented names. */
describe("withoutPersonPronouns", () => {
  it("replaces the live reply's pronoun (the Runner's re-run of #1067)", () => {
    expect(withoutPersonPronouns("Got it. The Corrective Action Form is the card on screen, so nothing is on file for her.", "Tamsin").text)
      .toBe("Got it. The Corrective Action Form is the card on screen, so nothing is on file for Tamsin.");
  });
  it("replaces the second live slip, a capitalised possessive (the Runner's run of 7318dc77)", () => {
    expect(withoutPersonPronouns("Her Corrective Action Form is the card on screen, not created yet.", "Tamsin").text)
      .toBe("Tamsin's Corrective Action Form is the card on screen, not created yet.");
  });
  it("replaces subject, object and possessive forms", () => {
    expect(withoutPersonPronouns("She was late and her shift started at 9. Tell him the form is ready; his last day is 11/28.", "Rowan").text)
      .toBe("Rowan was late and Rowan's shift started at 9. Tell Rowan the form is ready; Rowan's last day is 11/28.");
    expect(withoutPersonPronouns("I'll send it to her and copy hers.", "Tamsin").text).toBe("I'll send it to Tamsin and copy Tamsin's.");
  });
  it("replaces they/them/their only for the person, with the verb agreeing", () => {
    expect(withoutPersonPronouns("They were late twice. Tell them the card is ready. Their last day is 11/28.", "Rowan").text)
      .toBe("Rowan was late twice. Tell Rowan the card is ready. Rowan's last day is 11/28.");
  });
  it("leaves 'them' for the blank fields, groups and quoted words (must-pass, from the live run)", () => {
    const fields = "Here's the Resignation/Exit Form for Rowan. Rehire and the reason aren't set; tell me and I'll add them, or fill them on the draft.";
    expect(withoutPersonPronouns(fields, "Rowan")).toEqual({ text: fields, replaced: 0 });
    const blank = "Rowan's last day worked: November 28, 2026. Two fields are blank: tell me and I'll add them.";
    expect(withoutPersonPronouns(blank, "Rowan")).toEqual({ text: blank, replaced: 0 });
    const quoted = 'You wrote "she was rude to a client", so the Observation says that.';
    expect(withoutPersonPronouns(quoted, "Tamsin")).toEqual({ text: quoted, replaced: 0 });
  });
  it("names the person on the card's account line too (Sunny's paraphrase), but not inside the manager's quoted words", () => {
    expect(withoutPersonPronouns("Here's the Corrective Action Form for **Tamsin**.\n**Observation of Offense:** She was late on 10/26/26.", "Tamsin").text)
      .toBe("Here's the Corrective Action Form for **Tamsin**.\n**Observation of Offense:** Tamsin was late on 10/26/26.");
    const quoted = 'Observation: as you wrote, "she opened the salon 20 minutes late".';
    expect(withoutPersonPronouns(quoted, "Tamsin")).toEqual({ text: quoted, replaced: 0 });
  });
  it("covers Runner 2's 266 re-run lines (the shapes of c019, c198, c208, c210, c231; invented names)", () => {
    expect(withoutPersonPronouns("I'll start the Corrective Action Form for her now.", "Tamsin").text).toBe("I'll start the Corrective Action Form for Tamsin now.");
    expect(withoutPersonPronouns("That puts her with her 146 tans this month.", "Tamsin").text).toBe("That puts Tamsin with Tamsin's 146 tans this month.");
    expect(withoutPersonPronouns("Compare her figures with her own 146 tans.", "Tamsin").text).toBe("Compare Tamsin's figures with Tamsin's own 146 tans.");
    expect(withoutPersonPronouns("Since you've already talked to her, a Verbal Warning fits.", "Tamsin").text).toBe("Since you've already talked to Tamsin, a Verbal Warning fits.");
    expect(withoutPersonPronouns("Print it and walk through it with her.", "Tamsin").text).toBe("Print it and walk through it with Tamsin.");
  });
  it("leaves a pronoun whose sentence names another person first (Runner 2's c210 T2, c020 T3; invented names)", () => {
    expect(withoutPersonPronouns("Those edits name **Juno Paxton** and her figures (24 tans), so none of that is on this card.", "Tamsin", ["Juno Paxton"]).text)
      .toBe("Those edits name **Juno Paxton** and her figures (24 tans), so none of that is on this card.");
    expect(withoutPersonPronouns("**Observation of Offense:** She completed onboarding with new hire Juno Paxton on 9-28-26.", "Tamsin", ["Juno Paxton"]).text)
      .toBe("**Observation of Offense:** Tamsin completed onboarding with new hire Juno Paxton on 9-28-26.");
  });
  it("names the person inside a quote the manager did not type (Runner 2's c020 T6), not inside the manager's own", () => {
    const sunny = 'The card says "She completed onboarding with new hire Juno Paxton on 9-28-26."';
    expect(withoutPersonPronouns(sunny, "Tamsin", [], "ca for tamsin orwell, onboarding not done").text)
      .toBe('The card says "Tamsin completed onboarding with new hire Juno Paxton on 9-28-26."');
    const theirs = 'You wrote "sent her immediate resignation to management".';
    expect(withoutPersonPronouns(theirs, "Tamsin", [], "exit form for tamsin orwell, she sent her immediate resignation to management").text).toBe(theirs);
  });
  it("leaves a reply with no pronoun alone", () => {
    const plain = "Here's the Corrective Action Form for **Tamsin**. Tamsin's shift was on 11/14.";
    expect(withoutPersonPronouns(plain, "Tamsin")).toEqual({ text: plain, replaced: 0 });
  });
});
