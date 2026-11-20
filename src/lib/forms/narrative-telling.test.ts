import { describe, expect, it } from "vitest";

import { guardNarrative, ungroundedTelling } from "./narrative-draft";

/*
 * f082 (QA's live test, 20 Nov 2026, conv_mwpgp5pq29vc3jk): the manager wrote "ca for Test Testy, we do not do extra
 * cleaning after hours, she left early 11/18" (a rule, stated), and the saved Observation said "Test was told that extra
 * cleaning is not performed after hours." Who told whom is a fact the manager never gave: the sentence is dropped.
 */
const SAID = "ca for Test Testy, we do not do extra cleaning after hours, she left early 11/18";

describe("a telling the manager never described", () => {
  it("drops QA's live sentence and keeps the rest of the Observation", () => {
    const drafted = "Observed:\nTest left early on 11/18. Test was told that extra cleaning is not performed after hours.";
    const { text, removed } = guardNarrative(drafted, SAID);
    expect(text).toBe("Observed:\nTest left early on 11/18.");
    expect(removed).toEqual(["Test was told that extra cleaning is not performed after hours."]);
  });

  it("reads every shape of the claim", () => {
    for (const sentence of [
      "Test was told that extra cleaning is not performed after hours.",
      "Test has been reminded that the salon closes on time.",
      "She was previously informed of the closing procedure.",
      "The manager told her extra cleaning is not done after hours.",
      "Test had been made aware of the rule.",
    ]) {
      expect(ungroundedTelling(sentence, SAID), sentence).not.toBeNull();
    }
  });

  it("keeps a telling the manager did describe, in their own words", () => {
    for (const said of [
      `${SAID}. I told her last week`,
      `${SAID}, she knows we don't`,
      `${SAID}, we went over it at her last 1:1`,
    ]) {
      expect(ungroundedTelling("Test was told that extra cleaning is not performed after hours.", said), said).toBeNull();
    }
  });

  it("is not a sentence about something else", () => {
    expect(ungroundedTelling("Test left early on 11/18.", SAID)).toBeNull();
    expect(ungroundedTelling("Extra cleaning is not performed after hours.", SAID)).toBeNull();
  });
});
