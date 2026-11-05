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
