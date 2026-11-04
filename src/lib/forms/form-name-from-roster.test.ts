import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareGroundedQuestion, type GroundedPerson } from "@/lib/ai/grounded-entities";
import { formNameFromRosterEnabled } from "@/lib/config/chat-quality-flags";

import { namesSomebody } from "./answer-not-a-name";
import { installPersonRoster } from "./person-guard";
import { readEmployeeMentions } from "./proposal";
import { couldBeOnRoster, rosterShaped } from "./roster-shape";

/**
 * ============================================================================
 * FORM_NAME_FROM_ROSTER_ENABLED (step 5, first piece) — sf-s19, "metrics read
 * as people". Pau, 4 Nov 2026 (ported from Ask Bubbles)
 * ============================================================================
 *
 * "I need a corrective action verbal for <name>. This is for Under Performance
 * on PPTA, LPSVA, Club Average, Club Close %, and Spa %."
 *
 * Here the grounding step never strips a name, but the name reader still took
 * "Club Close" and "Under" for people and the grounding step listed them as
 * unmatched. Every person here is invented (the repository is public).
 */

const say = (name: string) =>
  `I need a corrective action verbal for ${name}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.`;

const person = (id: string, firstName: string, lastName: string, preferredFirstName: string | null = null): GroundedPerson => ({
  id,
  firstName,
  lastName,
  preferredFirstName,
  salonIds: ["loc-0309"],
  title: "Tanning Consultant",
  primaryLocationName: null,
});

const PEOPLE: readonly GroundedPerson[] = [
  person("e-perpetua", "Perpetua", "Thornquist"),
  person("e-leocadia", "Leocadia", "Wexcombe"),
  person("e-ismay", "Ismay", "Cradock", "Izzy"),
];
const NAMES = PEOPLE.map((row) => `${row.preferredFirstName ?? row.firstName} ${row.lastName}`);

const FLAGS = ["FORM_NAME_FROM_ROSTER_ENABLED", "CA_SALES_POLICY_ENABLED", "PERSON_GUARD_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const flag of FLAGS) {
    saved[flag] = process.env[flag];
    delete process.env[flag];
  }
});
afterEach(() => {
  for (const flag of FLAGS) {
    if (saved[flag] === undefined) delete process.env[flag];
    else process.env[flag] = saved[flag];
  }
  installPersonRoster(() => undefined);
});

const on = () => {
  process.env.FORM_NAME_FROM_ROSTER_ENABLED = "true";
  process.env.CA_SALES_POLICY_ENABLED = "true";
};

function prep(question: string) {
  return prepareGroundedQuestion({ question, history: [], people: PEOPLE, saved: null });
}

describe("the flag", () => {
  it("needs CA_SALES_POLICY_ENABLED: alone, the grounding step is as on main", () => {
    process.env.FORM_NAME_FROM_ROSTER_ENABLED = "true";
    expect(formNameFromRosterEnabled()).toBe(false);
    expect(prep(say("Perpetua Thornquist")).unmatched).toEqual(expect.arrayContaining(["Club Close", "Under"]));
    on();
    expect(formNameFromRosterEnabled()).toBe(true);
  });
});

describe("rosterShaped: roster data only", () => {
  it("2+ words: the first word is somebody's first or preferred name", () => {
    expect(rosterShaped("Perpetua Thornqist", PEOPLE)).toBe(true);
    expect(rosterShaped("Izzy Cradock", PEOPLE)).toBe(true);
    expect(rosterShaped("Ismay Cradok", PEOPLE)).toBe(true);
    expect(rosterShaped("Club Close", PEOPLE)).toBe(false);
    expect(rosterShaped("Zuleika Brightwell", PEOPLE)).toBe(false);
  });

  it("one word: somebody's first, preferred or last name", () => {
    expect(rosterShaped("Perpetua", PEOPLE)).toBe(true);
    expect(rosterShaped("Thornquist", PEOPLE)).toBe(true);
    expect(rosterShaped("Izzy", PEOPLE)).toBe(true);
    expect(rosterShaped("Under", PEOPLE)).toBe(false);
  });

  it("couldBeOnRoster also takes a close match of a whole name", () => {
    expect(couldBeOnRoster("Leocadja Wexcombe", NAMES)).toBe(true);
    expect(couldBeOnRoster("Club Close", NAMES)).toBe(false);
    expect(couldBeOnRoster("Under", NAMES)).toBe(false);
    expect(couldBeOnRoster("Club Close", [])).toBe(true);
  });
});

describe("the grounding step, Pau's exact message", () => {
  it("off (main): Club Close and Under are listed as unmatched people; nothing is stripped", () => {
    const prepared = prep(say("Perpetua Thornquist"));
    expect(prepared.unmatched).toEqual(expect.arrayContaining(["Club Close", "Under"]));
    expect(prepared.question).toMatch(/for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %/);
  });

  it("on: no metric is unmatched, nothing is stripped, the employee kept", () => {
    on();
    const prepared = prep(say("Perpetua Thornquist"));
    expect(prepared.unmatched).toEqual([]);
    expect(prepared.question).toMatch(/for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %/);
    expect(prepared.employeeId).toBe("e-perpetua");
  });

  it("on, negative control: a typo with the first name on the roster and a wrong surname is still unmatched", () => {
    on();
    expect(prep(say("Leocadia Marlwoe Ostrander")).unmatched).toContain("Leocadia Marlwoe Ostrander");
  });

  it("off, negative control: a full name nobody on the roster shares is unmatched as before", () => {
    expect(prep(say("Zuleika Brightwell")).unmatched).toContain("Zuleika Brightwell");
  });

  /*
   * Under the flag's rule a full name whose first word is nobody's first name
   * is shaped like nobody on the roster, the same as "Club Close". This app
   * shows nothing from the unmatched list (the reply asks "Who is this form
   * for?" either way), so no manager sees a difference; pinned so a later
   * reader of the list knows.
   */
  it("on: a full name nobody on the roster shares is not unmatched either", () => {
    on();
    expect(prep(say("Zuleika Brightwell")).unmatched).toEqual([]);
  });
});

describe("the name reader, with the person guard's roster", () => {
  beforeEach(() => {
    process.env.PERSON_GUARD_ENABLED = "true";
    installPersonRoster(() => NAMES);
  });

  it("off (main): Club Close and Under are read as names", () => {
    expect(namesSomebody("Club Close")).toBe(true);
    expect(namesSomebody("Under")).toBe(true);
    expect(readEmployeeMentions(say("Perpetua Thornquist")).names).toEqual(expect.arrayContaining(["Club Close", "Under"]));
  });

  it("on: only the employee is read, so a typo is still the one name", () => {
    on();
    expect(namesSomebody("Club Close")).toBe(false);
    expect(namesSomebody("Under")).toBe(false);
    expect(namesSomebody("Leocadja Wexcombe")).toBe(true);
    expect(readEmployeeMentions(say("Leocadia Wexcomb")).names).toEqual(["Leocadia Wexcomb"]);
    expect(readEmployeeMentions(say("Perpetua Thornquist")).names).toEqual(["Perpetua Thornquist"]);
  });

  it("on, with no roster: every candidate is kept", () => {
    on();
    installPersonRoster(() => undefined);
    expect(namesSomebody("Club Close")).toBe(true);
  });
});
