import { describe, expect, it } from "vitest";

import { levelFormWords, levelOptionIsTheLevel, levelPhraseNamingTheForm } from "./tools";

/* QA (16 Nov 2026, #1079's control): the option word is the level only when it does not describe another thing. */
describe("levelOptionIsTheLevel", () => {
  const words = levelFormWords("Corrective Action Form");
  it("takes the option word next to the form's own words, a number, a short linking word or the clause's end", () => {
    for (const [text, level] of [
      ["written CA for remy calder, late 11/14, payroll deduct $20", "written"],
      ["verbal ca for remy calder, late on 11/13", "verbal"],
      ["give her a written warning for being late", "written"],
      ["a written corrective action for remy", "written"],
      ["verbal 146 tans Below in PPTA", "verbal"],
      ["give her a written for being late", "written"],
      ["make it a written", "written"],
      ["this one is a verbal.", "verbal"],
      ["writen ca for remy", "written"],
    ] as const) expect(levelOptionIsTheLevel(text, level, words), text).toBe(true);
  });
  it("never takes an option word that describes another thing (QA's control)", () => {
    for (const [text, level] of [
      ["CA for Remy Calder, she didn't follow the written closing checklist on 11/14", "written"],
      ["ca for remy, she ignored the written policy", "written"],
      ["ca for remy, verbal abuse toward a guest", "verbal"],
    ] as const) expect(levelOptionIsTheLevel(text, level, words), text).toBe(false);
  });
  it("reads the form's words from its name", () => {
    expect(levelFormWords("Corrective Action Form")).toEqual(["corrective", "action", "ca", "warning", "warnings"]);
  });
});

/* QA (live c_pay r1, 16 Nov 2026): the level code sets itself: the option word right before one of the form's own words. */
describe("levelPhraseNamingTheForm", () => {
  const words = levelFormWords("Corrective Action Form");
  it("returns the option word and the form's word as typed", () => {
    expect(levelPhraseNamingTheForm("written CA for remy calder, late 11/14, payroll deduct $20", "written", words)).toBe("written CA");
    expect(levelPhraseNamingTheForm("verbal ca for remy calder, late on 11/13", "verbal", words)).toBe("verbal ca");
    expect(levelPhraseNamingTheForm("give her a Written Warning for being late", "written", words)).toBe("Written Warning");
    expect(levelPhraseNamingTheForm("a written corrective action for remy", "written", words)).toBe("written corrective");
  });
  it("is null when the option word is not right before the form's own word", () => {
    for (const text of [
      "CA for Remy Calder, she didn't follow the written closing checklist on 11/14",
      "ca for remy calder, she was written up before, late 11/14",
      "give her a written for being late",
      "verbal 146 tans Below in PPTA",
      "ca for remy, verbal abuse toward a guest",
      "written, CA for remy",
    ]) {
      expect(levelPhraseNamingTheForm(text, "written", words), text).toBeNull();
      expect(levelPhraseNamingTheForm(text, "verbal", words), text).toBeNull();
    }
  });
});
