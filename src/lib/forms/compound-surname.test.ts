import { afterEach, describe, expect, it, vi } from "vitest";

import { compoundSurnameScore, matchEmployeeName, type RosterEmployee } from "./employee-match";

/**
 * ROSTER_COMPOUND_SURNAME_ENABLED (the re-flip's rollback, 5 Nov 2026, R3/R5/R7): a two-word roster surname typed
 * with one word mistyped. Every person is invented (checked against both apps' directories).
 */
const row = (id: string, firstName: string, lastName: string): RosterEmployee => ({ id, firstName, lastName, salonIds: [] }) as never;
const ODALYS = row("a", "Odalys", "Prewett Vansickle");
const ODALYS_D = row("b", "Odalys", "Dunmore Vansickle");
const THORNE = row("c", "Thorne", "Ash Merrow");
const ROSTER = [ODALYS, THORNE, row("d", "Marnie", "Holloway")];

const kind = (typed: string, roster: readonly RosterEmployee[] = ROSTER) => {
  const match = matchEmployeeName(typed, roster);
  return match.kind === "confirm" ? `confirm:${match.candidates.map((c) => c.name).join("|")}` : match.kind === "exact" ? `exact:${match.name}` : match.kind;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ROSTER_COMPOUND_SURNAME_ENABLED off: as before (the bug)", () => {
  it("a typo in either word of a two-word surname is never close", () => {
    expect(kind("Odalys Perwett Vansickle")).toBe("none");
    expect(kind("Odalys Prewett Vansikcle")).toBe("none");
    expect(kind("Odalys Vansikcle")).toBe("none");
  });
});

describe("ROSTER_COMPOUND_SURNAME_ENABLED on: the surname compared word by word", () => {
  it("a typo in surname word 1 or word 2 (transposed letters), or one word alone with a typo, is close to her", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(kind("Odalys Perwett Vansickle")).toBe("confirm:Odalys Prewett Vansickle");
    expect(kind("Odalys Prewett Vansikcle")).toBe("confirm:Odalys Prewett Vansickle");
    expect(kind("Odalys Vansikcle")).toBe("confirm:Odalys Prewett Vansickle");
    expect(kind("odalys prewett vansikcle")).toBe("confirm:Odalys Prewett Vansickle");
  });

  it("the exact compound name is exact, and one surname word typed exactly is asked, never filled", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(kind("Odalys Prewett Vansickle")).toBe("exact:Odalys Prewett Vansickle");
    expect(kind("Odalys Vansickle")).toBe("confirm:Odalys Prewett Vansickle");
  });

  it("negative: two roster people sharing a surname word are both a question", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(kind("Odalys Vansikcle", [ODALYS, ODALYS_D])).toBe("confirm:Odalys Dunmore Vansickle|Odalys Prewett Vansickle");
  });

  it("QA's R3 shape: word 2 with letters 4–6 rotated (Damerau 2) and word 1 exact is close to her, asked, never filled", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(kind("Odalys Prewett Vancsikle")).toBe("confirm:Odalys Prewett Vansickle");
  });

  it("negative at distance 2: two people two edits apart in one surname word, typed one edit from each, are both a question", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    const ODALYS_C = row("e", "Odalys", "Prewett Vancsikle");
    expect(kind("Odalys Prewett Vanscikle", [ODALYS, ODALYS_C])).toBe("confirm:Odalys Prewett Vancsikle|Odalys Prewett Vansickle");
  });

  it("negative: a word of three letters or fewer counts only exactly (\"Ask\" is not \"Ash\")", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(kind("Thorne Ask")).toBe("none");
    expect(compoundSurnameScore(["ask"], "Ash Merrow")).toBeNull();
    expect(compoundSurnameScore(["ash"], "Ash Merrow")).toBe(1);
  });

  it("a single-word surname is unchanged (the flag reads only compound surnames)", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(compoundSurnameScore(["holloway"], "Holloway")).toBeNull();
    expect(kind("Marnie Holoway")).toBe("confirm:Marnie Holloway");
  });
});

describe("ROSTER_COMPOUND_SURNAME_ENABLED: compound first names, and an initial of any surname word (QA's roster shapes, 6 Nov 2026)", () => {
  const ROSA = row("r", "Rosa Lind", "Thistlewood");
  const SEVERIN = row("s", "Severin", "Ashdown Ferrant");

  it("off (the bug): \"Rosa Lind T\" and \"Severin F\" match no one, so the card empties", () => {
    expect(kind("Rosa Lind T", [ROSA])).toBe("none");
    expect(kind("Severin F", [SEVERIN])).toBe("none");
  });

  it("on: a two-word first name and an initial is asked; typed in full it is exact; first name alone is asked", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(kind("Rosa Lind T", [ROSA])).toBe("confirm:Rosa Lind Thistlewood");
    expect(kind("Rosa Lind Thistlewood", [ROSA])).toBe("exact:Rosa Lind Thistlewood");
    expect(kind("rosa lind thistlewod", [ROSA])).toBe("confirm:Rosa Lind Thistlewood");
    expect(kind("Rosa Lind", [ROSA])).toBe("confirm:Rosa Lind Thistlewood");
  });

  it("on: an initial of the second surname word is asked, never filled", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(kind("Severin F", [SEVERIN])).toBe("confirm:Severin Ashdown Ferrant");
    expect(kind("Severin A", [SEVERIN])).toBe("confirm:Severin Ashdown Ferrant");
  });

  it("on: an initial shared by two people (one surname starts with it, the other's second word does) offers both, never one", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    const ROOK = row("k", "Linnea", "Rook");
    const RUSK = row("u", "Linnea", "Garvey Rusk");
    expect(kind("Linnea R", [ROOK, RUSK])).toBe("confirm:Linnea Garvey Rusk|Linnea Rook");
  });

  it("negative, on: an initial that starts no surname word is no match", () => {
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
    expect(kind("Severin Q", [SEVERIN])).toBe("none");
  });
});
