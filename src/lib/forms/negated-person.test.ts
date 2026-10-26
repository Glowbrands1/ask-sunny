import { afterEach, describe, expect, it, vi } from "vitest";

import { firstUnnegatedPerson, negatedPeople, withoutNegatedPeople } from "./negated-person";
import type { RosterEmployee } from "./employee-match";
import { employeeNamedOnPurpose } from "./roster-validated-name";

/** NEGATED_PERSON_NO_CARD_ENABLED (QA-6, 26 Oct 2026). Rowan Pell and Corvin Mallow are invented names. */
const ROSTER: RosterEmployee[] = [
  { id: "corvin", firstName: "Corvin", lastName: "Mallow", preferredFirstName: null, salonIds: ["loc-0309"] },
  { id: "rowan", firstName: "Rowan", lastName: "Pell", preferredFirstName: null, salonIds: ["loc-0309"] },
];
const registers = (text: string) => [text.toLowerCase(), text.charAt(0).toUpperCase() + text.slice(1), text.toUpperCase()];
const NEGATED = [...registers("never one for Rowan Pell"), ...registers("do not make one for Rowan Pell")];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("negated-person helpers", () => {
  it("flag off: nothing is negated and the text is unchanged", () => {
    expect(negatedPeople("never one for Rowan Pell", ["Rowan Pell"])).toEqual([]);
    expect(firstUnnegatedPerson("one for Rowan Pell, not Corvin Mallow", ["Corvin Mallow", "Rowan Pell"])).toBeNull();
    expect(withoutNegatedPeople("never one for Rowan Pell", ["Rowan Pell"])).toBe("never one for Rowan Pell");
  });

  it("flag on: the negated person is found and blanked, the rest of the text keeps its place", () => {
    vi.stubEnv("NEGATED_PERSON_NO_CARD_ENABLED", "true");
    expect(negatedPeople("no, not for Rowan Pell, for Corvin Mallow", ["Rowan Pell", "Corvin Mallow", null])).toEqual(["Rowan Pell"]);
    expect(firstUnnegatedPerson("one for Rowan Pell, not Corvin Mallow", ["Corvin Mallow", "Rowan Pell"])).toBe("Rowan Pell");
    const masked = withoutNegatedPeople("no, not for Rowan Pell, for Corvin Mallow", ["Rowan Pell"]);
    expect(masked).toBe(`no, not for ${" ".repeat("Rowan Pell".length)}, for Corvin Mallow`);
  });
});

describe("the open-form reader (employeeNamedOnPurpose), card open for Corvin Mallow", () => {
  it.each(NEGATED)("flag on: %s renames nobody", (text) => {
    vi.stubEnv("NEGATED_PERSON_NO_CARD_ENABLED", "true");
    expect(employeeNamedOnPurpose(text, "Corvin Mallow", ROSTER, [])).toBeNull();
    expect(employeeNamedOnPurpose(text, null, ROSTER, [])).toBeNull();
  });

  it.each(registers("no, not for Rowan Pell, for Corvin Mallow"))("flag on: %s keeps Corvin Mallow", (text) => {
    vi.stubEnv("NEGATED_PERSON_NO_CARD_ENABLED", "true");
    expect(employeeNamedOnPurpose(text, "Corvin Mallow", ROSTER, [])).toBeNull();
    expect(employeeNamedOnPurpose(text, null, ROSTER, [])).toBe("Corvin Mallow");
  });

  it.each(registers("now one for Rowan Pell"))("flag on: %s still names Rowan Pell (positive control)", (text) => {
    vi.stubEnv("NEGATED_PERSON_NO_CARD_ENABLED", "true");
    expect(employeeNamedOnPurpose(text, "Corvin Mallow", ROSTER, [])).toBe("Rowan Pell");
  });

  // Flag off: as on main, pinned (the negated turns rename to Rowan Pell; the ALL CAPS "MAKE" is main's reading).
  it.each([
    ["never one for rowan pell", "Rowan Pell", "Rowan Pell"],
    ["Never one for Rowan Pell", "Rowan Pell", "Rowan Pell"],
    ["NEVER ONE FOR ROWAN PELL", "Rowan Pell", "Rowan Pell"],
    ["do not make one for rowan pell", "Rowan Pell", "Rowan Pell"],
    ["Do not make one for Rowan Pell", "Rowan Pell", "Rowan Pell"],
    ["DO NOT MAKE ONE FOR ROWAN PELL", "Make", "Rowan Pell"],
    ["no, not for rowan pell, for corvin mallow", "Rowan Pell", "Rowan Pell"],
    ["No, not for Rowan Pell, for Corvin Mallow", "Rowan Pell", "Rowan Pell"],
    ["NO, NOT FOR ROWAN PELL, FOR CORVIN MALLOW", "Rowan Pell", "Rowan Pell"],
    ["now one for rowan pell", "Rowan Pell", "Rowan Pell"],
    ["One for Rowan Pell, not Corvin Mallow", null, "Rowan Pell"],
    ["ONE FOR ROWAN PELL, NOT CORVIN MALLOW", "Rowan", "Corvin Mallow"],
  ])("flag off: %s → %s (no card open: %s)", (text, renamed, named) => {
    expect(employeeNamedOnPurpose(text, "Corvin Mallow", ROSTER, [])).toBe(renamed);
    expect(employeeNamedOnPurpose(text, null, ROSTER, [])).toBe(named);
  });
});
