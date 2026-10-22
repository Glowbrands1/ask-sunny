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

describe("F-09: a role before the name names the subject", () => {
  it.each([
    ["Create a CA for the manager Jane Doe, she was late", ["Jane Doe"]],
    ["coaching for her coworker Amy Lee", ["Amy Lee"]],
    ["create a coaching form for my assistant manager Jane Doe", ["Jane Doe"]],
    ["coaching form for my assistant manager jane doe", ["jane doe"]],
    ["coaching form for team member Jane Doe", ["Jane Doe"]],
    ["coaching form for team member jane doe", ["jane doe"]],
    ["create a corrective action for our salon director dana moss", ["dana moss"]],
    ["coaching form for the new employee jordan lee, late twice", ["jordan lee"]],
  ])("%s", (text, names) => {
    expect(extractEmployeeNames(text)).toEqual(names);
  });

  describe("somebody else in the account is still somebody else", () => {
    it.each([
      ["Create a coaching form for Jane Smith. Her coworker Amy Lee covered her shift", ["Jane Smith"]],
      ["create verbal ca for pat rivera, she let her friend Sam Jones behind the counter", ["pat rivera"]],
      ["CA for Dana Moss. A client Amy Lee complained about her", ["Dana Moss"]],
    ])("%s", (text, names) => {
      expect(extractEmployeeNames(text)).toEqual(names);
    });
  });

  describe("a role with no name after it names nobody", () => {
    it.each(["coaching form for the manager", "coaching form for my employee", "coaching form for the team", "coaching form for her coworker"])(
      "%s",
      (text) => {
        expect(extractEmployeeNames(text)).toEqual([]);
      },
    );
  });

  it("a multi-turn intake keeps the role-led subject", () => {
    expect(after("Create a CA for the manager Jane Doe, she was late", "verbal")).toEqual({
      kind: "resolved",
      employeeName: "Jane Doe",
    });
  });
});

describe("F-06: two people in one request is a question, never a choice", () => {
  it.each([
    "coaching form for pat rivera and sam jones, both late",
    "coaching form for pat rivera & sam jones",
    "coaching form for Pat Rivera and Sam Jones, both late",
    "corrective action for the manager pat rivera and sam jones",
  ])("%s", (text) => {
    const resolution = after(text);
    expect(resolution.kind).toBe("ambiguous");
    expect(resolution.kind === "ambiguous" ? resolution.candidates.map((name) => name.toLowerCase()) : []).toEqual([
      "pat rivera",
      "sam jones",
    ]);
  });

  it("naming one of them next proceeds for that person", () => {
    expect(after("coaching form for pat rivera and sam jones, both late", "pat rivera")).toEqual({
      kind: "resolved",
      employeeName: "pat rivera",
    });
    expect(after("coaching form for pat rivera and sam jones, both late", "sam")).toEqual({
      kind: "resolved",
      employeeName: "sam jones",
    });
  });

  it("'both' does not pick one", () => {
    expect(after("coaching form for pat rivera and sam jones, both late", "both").kind).toBe("ambiguous");
  });

  it("'and' followed by something that is not a person adds nobody", () => {
    expect(after("coaching form for pat rivera and her attendance")).toEqual({ kind: "resolved", employeeName: "pat rivera" });
    expect(after("coaching form for pat rivera and the late openings")).toEqual({ kind: "resolved", employeeName: "pat rivera" });
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
