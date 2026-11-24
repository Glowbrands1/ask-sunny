import { describe, expect, it } from "vitest";

import { matchEmployeeName, possessiveRead, rosterNameNamedIn, type RosterEmployee } from "./employee-match";
import { readEmployeeMentions } from "./proposal";

/* Synthetic people only. QA, 22 Oct 2026: see `rosterNameNamedIn`. */
const person = (id: string, firstName: string, lastName: string, preferredFirstName: string | null = null) =>
  ({ id, firstName, lastName, preferredFirstName, salonIds: [] }) as unknown as RosterEmployee;
const ROSTER = [
  person("1", "Tess", "Varga"),
  person("2", "Remy", "Calder"),
  person("3", "Theodora", "Lind", "Teddy"),
  person("4", "Tess", "Varga"),
];

describe("the one person on the roster the words name in full", () => {
  it.each([
    ["write up tess varga, written warning", "Tess Varga"],
    ["can you write up REMY CALDER? she skipped the meeting", "Remy Calder"],
    ["teddy lind missed the woven deadline", "Theodora Lind"],
  ])("%s", (text, name) => {
    expect(rosterNameNamedIn(text, ROSTER)).toBe(name);
  });

  it.each([
    ["two people named", "write up tess varga and remy calder"],
    ["a first name alone", "write up remy for missing the meeting"],
    ["part of a longer word", "tess vargas came in late"],
    ["nobody", "write up the notes from the meeting"],
    ["a coworker in the account", "write up tess for skipping the meeting, her coworker remy calder saw it"],
    ["a witness", "remy calder told me tess skipped the meeting, written CA"],
  ])("%s → nobody", (_why, text) => {
    expect(rosterNameNamedIn(text, ROSTER)).toBeNull();
  });

  it("two people sharing one name is one name; the name check then asks which", () => {
    expect(rosterNameNamedIn("write up tess varga", ROSTER)).toBe("Tess Varga");
  });
});

describe("a reason after \"for\" is not a name", () => {
  it.each([
    ["Tess Varga needs a written CA for missing the meeting", ["Tess Varga"]],
    ["written CA for violating the cell phone policy", []],
    ["CA for leaving early on 10/20", []],
  ])("%s", (text, names) => {
    expect(readEmployeeMentions(text).names).toEqual(names);
  });

  it("a name that ends in -ing is still a name where nothing a verb takes follows it", () => {
    expect(readEmployeeMentions("CA for sterling hayes, late today").names).toEqual(["sterling hayes"]);
  });
});

/*
 * The 266-chat run's 053/116/117/138/237/239 (QA, 22 Nov 2026): "Odalys Brindle's, today, - …" carded "Odalys Brindle's"
 * off the roster. The possessive is grammar: it leaves only when the name without it is the one the roster matches.
 */
describe("a typed name's trailing possessive", () => {
  const WITH_ROSS = [...ROSTER, person("5", "Juno", "Ross")];

  it.each([
    ["Remy Calder's", "Remy Calder"],
    ["Remy Calder\u2019s", "Remy Calder"],
    ["remy calder's", "remy calder"],
  ])("%s is read as %s", (typed, read) => {
    expect(possessiveRead(typed, ROSTER)).toBe(read);
  });

  it("matches the roster person exactly", () => {
    const match = matchEmployeeName("Remy Calder's", ROSTER);
    expect(match.kind).toBe("exact");
    expect(match.kind === "exact" ? match.name : null).toBe("Remy Calder");
  });

  it.each([
    ["Juno Ross", WITH_ROSS],
    ["Juno Ross's", [...WITH_ROSS, person("6", "Juno", "Ross's")]],
    ["Zelda Quinn's", ROSTER],
    ["Calders", ROSTER],
  ])("control: %s is kept as typed (a surname ending in s, a name the roster has with the 's, or nobody without it)", (typed, roster) => {
    expect(possessiveRead(typed, roster as RosterEmployee[])).toBe(typed);
  });

  it("control: a real surname ending in s still matches exactly", () => {
    const match = matchEmployeeName("Juno Ross", WITH_ROSS);
    expect(match.kind === "exact" ? match.name : null).toBe("Juno Ross");
  });
});

/*
 * The 266-chat run's 117 (QA, 22 Nov 2026): "Brindle Tavish" for the roster's Tavish Brindle. The roster's own
 * "<last> <first>" order is read only when the typed order matches nobody, and only for one person.
 */
describe("a typed name in the roster's last-first order", () => {
  it.each([
    ["Calder Remy", "Remy Calder"],
    ["calder remy", "Remy Calder"],
    ["Lind Teddy", "Theodora Lind"],
  ])("%s is %s", (typed, name) => {
    const match = matchEmployeeName(typed, ROSTER);
    expect(match.kind).toBe("exact");
    expect(match.kind === "exact" ? match.name : null).toBe(name);
  });

  it("control: two people with that name in reverse is no exact match", () => {
    expect(matchEmployeeName("Varga Tess", ROSTER).kind).not.toBe("exact");
  });

  it("control: the typed order wins when it matches someone", () => {
    const both = [...ROSTER, person("7", "Calder", "Remy")];
    const match = matchEmployeeName("Calder Remy", both);
    expect(match.kind === "exact" ? match.employee.id : null).toBe("7");
  });

  it("control: a reversed name nobody has stays no match", () => {
    expect(matchEmployeeName("Quinn Zelda", ROSTER).kind).toBe("none");
  });
});
