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
  it("leaves the card's account line, the manager's own words (the pack's Observation lines)", () => {
    const card = "Here's the Corrective Action Form for **Tamsin**.\n**Observation of Offense:** she was late on 10/26/26";
    expect(withoutPersonPronouns(card, "Tamsin")).toEqual({ text: card, replaced: 0 });
  });
  it("leaves a reply with no pronoun alone", () => {
    const plain = "Here's the Corrective Action Form for **Tamsin**. Tamsin's shift was on 11/14.";
    expect(withoutPersonPronouns(plain, "Tamsin")).toEqual({ text: plain, replaced: 0 });
  });
});
