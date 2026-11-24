import { describe, expect, it } from "vitest";

import { candidateNameWords } from "./chat-form-records";
import { closelySpelledEmployee } from "./reopen-close-spelling";

/*
 * QA's f072 (20 Nov 2026): the forms-on-file readers split names on [^a-z], so "Ramírez" was read as "ram rez" (and
 * "Peñalver" as "pe alver"). They fold accents first (`foldName`, #1141). Invented names only.
 */
describe("accented names in the forms-on-file readers (f072)", () => {
  it("a question's name words fold accents, never split on them", () => {
    expect(candidateNameWords("show me forms for Lucía Ramírez")).toEqual(["lucia", "ramirez"]);
    expect(candidateNameWords("Inés Peñalver's CA")).toEqual(["ines", "penalver"]);
  });

  it("the close-spelling reader reads an accented form's name whole", () => {
    expect(closelySpelledEmployee("edit lucia ramires ca", ["Lucía Ramírez"])).toBe("Lucía Ramírez");
  });
});
