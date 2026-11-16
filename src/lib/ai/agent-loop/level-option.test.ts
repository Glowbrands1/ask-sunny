import { describe, expect, it } from "vitest";

import { levelFormWords, levelOptionIsTheLevel } from "./tools";

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
