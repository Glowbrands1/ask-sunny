import { describe, expect, it } from "vitest";

import { employeeState, extractEmployeeNames, managerContext, tidyTypedName } from "./proposal";

/**
 * QA, 22 Oct 2026 — who the form is for, read from the manager's own turns.
 *
 *   F-02  a reply that is only a salon ("kearney", "sorry, it's grand island")
 *         replaced the employee already named
 *   F-09  a role between "for" and the name ("for the manager Jane Doe", "for
 *         her coworker Amy Lee") hid the person; "Her coworker Amy Lee" at the
 *         start of a sentence was read as a second subject
 *   F-06  "for pat rivera and sam jones" named only Pat, so a form went to one
 *         of two people without a word
 *   spelling  the manager's spelling is kept (exact directory matches are
 *         applied in `form-proposal.ts`, not here)
 *
 * Every person is synthetic.
 */

/** The employee after the manager's turns, read the way the proposal reads them. */
function after(...turns: string[]) {
  const history = turns.slice(0, -1).map((content, index) => ({ id: `u${index}`, role: "user" as const, content }));
  return employeeState(managerContext(history, { id: "now", content: turns[turns.length - 1]! })).resolution;
}

const OPENED = "create a coaching form for pat rivera, late 3 times this week";

describe("F-02: a reply that names a salon never replaces the employee", () => {
  it.each([
    "kearney",
    "Kearney",
    "KEARNEY",
    "lincoln o street",
    "Lincoln O St",
    "grand island",
    "sorry, it's grand island",
    "it's at kearney",
    "at kearney",
    "lawrence",
    "omaha",
    "wornall",
    "kansas city",
    "NE Kearney",
  ])("%s", (reply) => {
    expect(after(OPENED, reply)).toEqual({ kind: "resolved", employeeName: "pat rivera" });
  });

  it("several location replies in a row still leave the employee alone", () => {
    expect(after(OPENED, "kearney", "sorry, lincoln o street", "grand island")).toEqual({
      kind: "resolved",
      employeeName: "pat rivera",
    });
  });

  it("with no employee yet, a salon reply does not become one", () => {
    expect(after("i need a coaching form", "kearney")).toEqual({ kind: "missing" });
    expect(after("i need a coaching form", "sorry, it's grand island")).toEqual({ kind: "missing" });
  });

  describe("an explicit change of person still changes it", () => {
    it.each([
      ["actually it's for sam jones", "sam jones"],
      ["the employee is Pat Kearney", "Pat Kearney"],
      ["not pat rivera, it's dana moss", "dana moss"],
      ["No, not Pat. Dana Moss.", "Dana Moss"],
      ["it's for dana moss", "dana moss"],
    ])("%s", (reply, employee) => {
      expect(after(OPENED, reply)).toEqual({ kind: "resolved", employeeName: employee });
    });
  });

  it("a full name that merely contains a salon word is a person", () => {
    expect(after("i need a coaching form", "lawrence smith")).toEqual({ kind: "resolved", employeeName: "lawrence smith" });
    expect(extractEmployeeNames("coaching form for Pat Kearney")).toEqual(["Pat Kearney"]);
  });

  it("a name after '<form> for' is read as given, even when it is also a salon's", () => {
    // The position says a person follows; only replies and correction clauses are read as places.
    expect(extractEmployeeNames("coaching form for lawrence")).toEqual(["lawrence"]);
  });
});

describe("spelling: the manager's own", () => {
  it.each([
    ["coaching form for jane doe", "jane doe"],
    ["COACHING FORM FOR JANE DOE", "JANE DOE"],
    ["coaching form for Jane McDonald", "Jane McDonald"],
    ["coaching form for jd smith", "jd smith"],
  ])("%s", (text, employee) => {
    expect(after(text)).toEqual({ kind: "resolved", employeeName: employee });
  });

  it("only the spacing is tidied", () => {
    expect(tidyTypedName("  jane   doe ")).toBe("jane doe");
    expect(tidyTypedName("JOHN SMITH III")).toBe("JOHN SMITH III");
    expect(tidyTypedName("de la cruz")).toBe("de la cruz");
  });
});
