import { describe, expect, it } from "vitest";

import { withoutPersonPronouns } from "./reply-pronouns";

/*
 * QA2's live R3 on cdb2ddc2 (21 Nov 2026): the manager typed "…came into the salon to show her team her new puppy". The
 * saved Observation read "… to show the team the new puppy" (#1145), but the reply and the card's issue text read "to show
 * Test's team Test's new puppy". The reply/card pass now writes the person's possessive the way the saved write-up does:
 * once the person is named in the sentence, "her <thing>" is "the <thing>". Reported speech keeps its owner ("Remy said
 * Remy's car broke down", #1145). The tester's "Test" is STAFF's invented Remy here.
 */
describe("the person's possessive, once they are named in the sentence", () => {
  it("QA2's R3: \"to show her team her new puppy\" reads as the saved write-up does", () => {
    /*
     * CHANGED ON PURPOSE (port of Ask Bubbles #1075; QA's ruling, 22 Nov 2026, Pau's round 3 U23, option B in the
     * card/reply pass only): the first possessive of the named person keeps its owner; a second one in the sentence, or
     * one after a place/time preposition, is "the". Was "to show the team the new puppy" (the saved write-up keeps that,
     * HR's 3 Oct design).
     */
    expect(withoutPersonPronouns("Remy came into the salon to show her team her new puppy.", "Remy").text).toBe("Remy came into the salon to show Remy's team the new puppy.");
    expect(withoutPersonPronouns("She came into the salon to show her team her new puppy.", "Remy").text).toBe("Remy came into the salon to show Remy's team the new puppy.");
  });

  it("the first mention in a sentence is still the name, and reported speech keeps the owner", () => {
    expect(withoutPersonPronouns("Her phone was out on the floor.", "Remy").text).toBe("Remy's phone was out on the floor.");
    expect(withoutPersonPronouns("She said her car broke down.", "Remy").text).toBe("Remy said Remy's car broke down.");
  });

  /*
   * QA2's live R3 (#1168's case): "Her shift lead told her to go home and she refused" read "Test's shift lead, <J>, told
   * Test to go home and Test refused". The listener of the lead's instruction is named (#1147's f059: never a pronoun, never
   * dropped), so the possessive that opens the sentence is the plain "The shift lead".
   */
  it("QA2's R3 (#1168): the opening possessive is plain when the listener is named later in the sentence", () => {
    expect(withoutPersonPronouns("Her shift lead, Corin, told her to go home and she refused.", "Remy", ["Corin"]).text).toBe("The shift lead, Corin, told Remy to go home and Remy refused.");
    expect(withoutPersonPronouns("Her shift lead told her to go home and she refused.", "Remy").text).toBe("The shift lead told Remy to go home and Remy refused.");
  });
});

/*
 * Port of Ask Bubbles #1075 (Pau's round 3 there, U23; QA's ruling, option B in the card/reply pass only): the manager's
 * T5 "Multiple times she has talked about her boyfriend …" and T6 "… constantly bothering them not just about products
 * but about her personal life" read "the boyfriend" and "the personal life" on the card and in the reply: whose it was
 * got lost. The first possessive of the named person keeps its owner; item 19's "the" after a place/time preposition and
 * the R3 puppy's second possessive stay. The tester's words; the person is STAFF's invented Remy.
 */
describe("the owner is kept on the first possessive (port of Bubbles #1075, round 3 U23)", () => {
  it("T5: \"Multiple times she has talked about her boyfriend …\" keeps whose boyfriend", () => {
    expect(withoutPersonPronouns("Multiple times Remy has talked about her boyfriend or ex boyfriend with customers.", "Remy").text).toBe("Multiple times Remy has talked about Remy's boyfriend or ex boyfriend with customers.");
  });
  it("T6: \"… not just about products but about her personal life\" keeps whose personal life", () => {
    const out = withoutPersonPronouns("Remy will also follow customers around the salon, constantly bothering them not just about products but about her personal life.", "Remy").text;
    expect(out).toBe("Remy will also follow customers around the salon, constantly bothering them not just about products but about Remy's personal life.");
  });
  it("control (item 19): after a place or time preposition it is still \"the\"", () => {
    expect(withoutPersonPronouns("Remy did not come into her scheduled shift today.", "Remy").text).toBe("Remy did not come into the scheduled shift today.");
  });
  it("control (QA2's R3): a second possessive in the sentence is \"the\"", () => {
    expect(withoutPersonPronouns("Remy came into the salon to show her team her new puppy.", "Remy").text).toBe("Remy came into the salon to show Remy's team the new puppy.");
  });
});
