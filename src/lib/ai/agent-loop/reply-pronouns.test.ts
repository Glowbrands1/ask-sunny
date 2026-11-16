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
  /*
   * Pau's ruling (QA, 16 Nov 2026): a pronoun in the other person's reported question or statement is the card's person's
   * when the card's person is named in the same sentence. Runner 2's c090 T5 and c091 T2 in shape; invented names.
   */
  it("names the person inside another person's reported question when the person is named in the sentence (c090 T5, c091 T2)", () => {
    expect(withoutPersonPronouns("When Juno Paxton asked whether she had completed her 10-minute sanitization, Tamsin said yes.", "Tamsin", ["Juno Paxton"]).text)
      .toBe("When Juno Paxton asked whether Tamsin had completed Tamsin's 10-minute sanitization, Tamsin said yes.");
    expect(withoutPersonPronouns("**Observation of Offense:** When **Juno Paxton** asked if she had finished her closing checklist, **Tamsin Orwell** said yes.", "Tamsin", ["Juno Paxton"]).text)
      .toBe("**Observation of Offense:** When **Juno Paxton** asked if Tamsin had finished Tamsin's closing checklist, **Tamsin Orwell** said yes.");
    expect(withoutPersonPronouns("Juno Paxton reminded Tamsin to clean her beds after each guest.", "Tamsin", ["Juno Paxton"]).text)
      .toBe("Juno Paxton reminded Tamsin to clean Tamsin's beds after each guest.");
  });
  it("keeps the other person's own pronoun: no reported question, or the person not named in the sentence (c210 T2, c097)", () => {
    // c210 T2: the other person's possessive.
    const figures = "Those edits name **Juno Paxton** and her figures (24 tans), so none of that is on Tamsin's card.";
    expect(withoutPersonPronouns(figures, "Tamsin", ["Juno Paxton"])).toEqual({ text: figures, replaced: 0 });
    // c097: the new hire is the subject; her onboarding is the new hire's.
    const onboarding = "New hire Juno Paxton was left alone during her onboarding with Tamsin on 9-28-26.";
    expect(withoutPersonPronouns(onboarding, "Tamsin", ["Juno Paxton"])).toEqual({ text: onboarding, replaced: 0 });
    /*
     * Changed on purpose (Pau's ruling via QA, 17 Nov 2026, Runner 2's c090 T5 / c091 T5 on train 3): a pronoun in another
     * person's reported question is the card person's even when the card's person is not named in the sentence (they are
     * the card's person), so this is no longer kept. What stays is a reporter who is a pronoun (below).
     */
    expect(withoutPersonPronouns("Juno Paxton asked whether she could swap shifts.", "Tamsin", ["Juno Paxton"]).text).toBe("Juno Paxton asked whether Tamsin could swap shifts.");
    // After the clause's comma, the other person's own words are theirs again.
    const after = "When Juno Paxton asked whether Tamsin was done, she said her checklist was finished.";
    expect(withoutPersonPronouns(after, "Tamsin", ["Juno Paxton"])).toEqual({ text: after, replaced: 0 });
  });
  /*
   * Pau's ruling, extended (QA, 17 Nov 2026; Runner 2's c090 T5, c091 T5, c247 T1 on train 3; invented names): a pronoun in a
   * clause a named person reports ("<M> asked whether she …", "<P> messaged <M> … stating she quit") is the card person's,
   * whether or not the card's person is named in the sentence. A reporter who is a pronoun ("she said her checklist …")
   * keeps the pronoun (it may be the speaker's own).
   */
  it("names the card's person in a reported clause when the card's person is not named in it (c090 T5, c091 T5)", () => {
    expect(withoutPersonPronouns("**Observation of Offense:** Corin set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am. When we arrived at 8:15am, the lobby lights were still off. When Brisa asked whether she had completed her 10-minute sanitization, Arlo said yes. The footage showed that it had not been completed.", "Corin", ["Brisa", "Arlo"]).text)
      .toBe("**Observation of Offense:** Corin set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am. When we arrived at 8:15am, the lobby lights were still off. When Brisa asked whether Corin had completed Corin's 10-minute sanitization, Arlo said yes. The footage showed that it had not been completed.");
    expect(withoutPersonPronouns("When Corin asked whether she had completed her 10-minute sanitization, Brisa said yes.", "Arlo", ["Corin Rennick", "Corin", "Brisa", "Delphine Sorrowby"]).text)
      .toBe("When Corin asked whether Arlo had completed Arlo's 10-minute sanitization, Brisa said yes.");
  });
  it("names the card's person in a clause reported with \"stating\", another person named between (c247 T1)", () => {
    expect(withoutPersonPronouns("on 11-5-26 Arlo messaged Training Salon Director, Brisa Rennick via Woven stating she quit effective immediately.", "Arlo", ["Brisa Rennick"]).text)
      .toBe("on 11-5-26 Arlo messaged Training Salon Director, Brisa Rennick via Woven stating Arlo quit effective immediately.");
  });
  it("keeps the pronoun of a reporter who is a pronoun, and the other person's own words with no reporting verb", () => {
    const speaker = "Juno Paxton came in at 9, and she said her checklist was finished.";
    expect(withoutPersonPronouns(speaker, "Tamsin", ["Juno Paxton"])).toEqual({ text: speaker, replaced: 0 });
    const figures = "Those edits name **Juno Paxton** and her figures (24 tans).";
    expect(withoutPersonPronouns(figures, "Tamsin", ["Juno Paxton"])).toEqual({ text: figures, replaced: 0 });
  });
  it("names the person inside a quote the manager did not type (Runner 2's c020 T6), not inside the manager's own", () => {
    const sunny = 'The card says "She completed onboarding with new hire Juno Paxton on 9-28-26."';
    expect(withoutPersonPronouns(sunny, "Tamsin", [], "ca for tamsin orwell, onboarding not done").text)
      .toBe('The card says "Tamsin completed onboarding with new hire Juno Paxton on 9-28-26."');
    const theirs = 'You wrote "sent her immediate resignation to management".';
    expect(withoutPersonPronouns(theirs, "Tamsin", [], "exit form for tamsin orwell, she sent her immediate resignation to management").text).toBe(theirs);
  });
  it("keeps the manager's words quoted back with a small difference (Runner 2's c152 T1)", () => {
    const close = 'You said she "sent her immediate resignation to management".';
    expect(withoutPersonPronouns(close, "Tamsin", [], "exit form for tamsin orwell, she sent her immediate resignation to the management team").text)
      .toBe('You said Tamsin "sent her immediate resignation to management".');
  });
  it("leaves a reply with no pronoun alone", () => {
    const plain = "Here's the Corrective Action Form for **Tamsin**. Tamsin's shift was on 11/14.";
    expect(withoutPersonPronouns(plain, "Tamsin")).toEqual({ text: plain, replaced: 0 });
  });
});
