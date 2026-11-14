import { afterEach, describe, expect, it, vi } from "vitest";

import { isRelativeDateWord, relativeDates } from "./relative-dates";
import { statedWarningLevel } from "./warning-level";

/* RELATIVE_DAY_PART_WORDS (QA's live check, 13 Nov 2026). Invented wording. */
afterEach(() => vi.unstubAllEnvs());

const TODAY = "2026-11-13";
const isos = (text: string) => relativeDates(text, TODAY).map((found) => found.iso);

describe("RELATIVE_DAY_PART_WORDS", () => {
  it("off: a part of the day is not read (as on main)", () => {
    vi.stubEnv("RELATIVE_DATE_READER_ENABLED", "true");
    vi.stubEnv("RELATIVE_DAY_PART_WORDS_ENABLED", "");
    expect(isos("she no-call no-showed tonight")).toEqual([]);
  });

  it("on: tonight / this morning / this afternoon / this evening are today; last night is yesterday", () => {
    vi.stubEnv("RELATIVE_DATE_READER_ENABLED", "true");
    vi.stubEnv("RELATIVE_DAY_PART_WORDS_ENABLED", "true");
    expect(isos("she no-call no-showed tonight")).toEqual([TODAY]);
    expect(isos("she was late this morning")).toEqual([TODAY]);
    expect(isos("she left early this afternoon")).toEqual([TODAY]);
    expect(isos("she no-call no-showed this evening")).toEqual([TODAY]);
    expect(isos("she no-call no-showed last night")).toEqual(["2026-11-12"]);
  });

  it("on: the found date points at the words typed", () => {
    vi.stubEnv("RELATIVE_DATE_READER_ENABLED", "true");
    vi.stubEnv("RELATIVE_DAY_PART_WORDS_ENABLED", "true");
    const text = "she no-call no-showed last night";
    const [found] = relativeDates(text, TODAY);
    expect(text.slice(found!.index, found!.end)).toBe("last night");
  });
});

/* The sibling gate's #891 finding (invented person): "last night" is a relative word, not an earlier step. */
describe("RELATIVE_DAY_PART_WORDS: the day-part words are relative words", () => {
  it("on: relative words, and a level said after \"last night\" stays; off, as before", () => {
    vi.stubEnv("RELATIVE_DATE_READER_ENABLED", "true");
    vi.stubEnv("RELATIVE_DAY_PART_WORDS_ENABLED", "true");
    for (const word of ["last night", "tonight", "this morning", "this afternoon", "this evening"]) expect(isRelativeDateWord(word)).toBe(true);
    expect(statedWarningLevel("need a CA for marnie holloway. she mishandled cash at close last night. written warning")).toBe("written");
    expect(statedWarningLevel("need a CA for marnie holloway. she no-call no-showed last night. verbal warning")).toBe("verbal");
    vi.stubEnv("RELATIVE_DAY_PART_WORDS_ENABLED", "");
    expect(isRelativeDateWord("last night")).toBe(false);
  });
});
