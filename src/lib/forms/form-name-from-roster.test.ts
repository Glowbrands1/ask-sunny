import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareGroundedQuestion, type GroundedPerson } from "@/lib/ai/grounded-entities";
import { formNameFromRosterEnabled } from "@/lib/config/chat-quality-flags";

import { namesSomebody } from "./answer-not-a-name";
import { installPersonRoster } from "./person-guard";
import { readEmployeeMentions } from "./proposal";
import { messageAnchoredOnRoster } from "./roster-anchor-store";
import { couldBeOnRoster, installRosterAnchor, lowercaseNobody, lowercaseRosterFirstNameIn, rosterShaped } from "./roster-shape";

/**
 * ============================================================================
 * FORM_NAME_FROM_ROSTER_ENABLED (step 5, first piece) — sf-s19, "metrics read
 * as people". Pau, 4 Nov 2026 (ported from the sibling app)
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
  installRosterAnchor(() => undefined);
});

const on = () => {
  process.env.FORM_NAME_FROM_ROSTER_ENABLED = "true";
  process.env.CA_SALES_POLICY_ENABLED = "true";
};

function prep(question: string) {
  return prepareGroundedQuestion({ question, history: [], people: PEOPLE, saved: null });
}

describe("the flag", () => {
  /*
   * CHANGED ON PURPOSE (QA, 4 Nov 2026): the flag used to need
   * CA_SALES_POLICY_ENABLED and, alone, left the grounding step as on main.
   * Production made a Coaching Form card for "Club Close" with the sales
   * policy off, so the flag now works without it.
   */
  it("works without CA_SALES_POLICY_ENABLED", () => {
    expect(formNameFromRosterEnabled()).toBe(false);
    expect(prep(say("Perpetua Thornquist")).unmatched).toEqual(expect.arrayContaining(["Club Close", "Under"]));
    process.env.FORM_NAME_FROM_ROSTER_ENABLED = "true";
    expect(formNameFromRosterEnabled()).toBe(true);
    expect(prep(say("Perpetua Thornquist")).unmatched).not.toEqual(expect.arrayContaining(["Club Close"]));
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
   * THE MIDDLE GROUND (QA, 4 Nov 2026). A nobody-shaped candidate is set aside
   * only beside somebody on the roster. "Zuleika Brightwell" typed alone names
   * nobody on the roster, so the message is read as before.
   */
  it("on: a full name nobody on the roster shares, typed alone, is unmatched as before", () => {
    on();
    const prepared = prep(say("Zuleika Brightwell"));
    expect(prepared.unmatched).toContain("Zuleika Brightwell");
    expect(prepared.rosterAnchored).toBeUndefined();
  });

  it("on: Pau's message names somebody on the roster, so the metrics are set aside", () => {
    on();
    expect(prep(say("Perpetua Thornquist")).rosterAnchored).toBe(true);
  });

  /*
   * WHAT IS STILL OPEN, PINNED. Metric words with no roster name beside them:
   * nothing anchors the message, so it is read as before, flag on or off, and
   * "under" (from "for under performance") is still an unmatched candidate.
   * This app shows nothing from that list. Put to Pau, 4 Nov 2026.
   */
  it("on: metrics with no roster name are read as before", () => {
    const question = "CA for under performance on Club Close % and Spa %";
    const off = prep(question);
    on();
    const prepared = prep(question);
    expect(prepared).toEqual(off);
    expect(prepared.rosterAnchored).toBeUndefined();
    expect(prepared.unmatched).toEqual(["under"]);
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

  it("on, beside a roster name: only the employee is read, so a typo is still the one name", () => {
    on();
    installRosterAnchor(() => true);
    expect(namesSomebody("Club Close")).toBe(false);
    expect(namesSomebody("Under")).toBe(false);
    expect(namesSomebody("Leocadja Wexcombe")).toBe(true);
    expect(readEmployeeMentions(say("Leocadia Wexcomb")).names).toEqual(["Leocadia Wexcomb"]);
    expect(readEmployeeMentions(say("Perpetua Thornquist")).names).toEqual(["Perpetua Thornquist"]);
  });

  it("on, with no roster name in the message: every candidate is kept", () => {
    on();
    installRosterAnchor(() => false);
    expect(namesSomebody("Club Close")).toBe(true);
    expect(readEmployeeMentions(say("Zuleika Brightwell")).names).toEqual(expect.arrayContaining(["Zuleika Brightwell", "Club Close", "Under"]));
  });

  it("on, with no roster: every candidate is kept", () => {
    on();
    installRosterAnchor(() => true);
    installPersonRoster(() => undefined);
    expect(namesSomebody("Club Close")).toBe(true);
  });
});

/*
 * APPROVED (QA for Pau, 4 Nov 2026): "CA for under performance on Club Close %
 * and Spa %" with CA_SALES_POLICY_ENABLED on made the card "for **under**".
 * One word typed all in lowercase that is nobody's first, preferred or last
 * name on the roster is never the employee, beside a roster name or not.
 */
describe("a lowercase word that is nobody on the roster", () => {
  it("lowercaseNobody: how it was typed and the roster only", () => {
    expect(lowercaseNobody("under", NAMES)).toBe(true);
    expect(lowercaseNobody("perpetua", NAMES)).toBe(false);
    expect(lowercaseNobody("thornquist", NAMES)).toBe(false);
    expect(lowercaseNobody("izzy", NAMES)).toBe(false);
    expect(lowercaseNobody("Under", NAMES)).toBe(false);
    expect(lowercaseNobody("corin bellweather", NAMES)).toBe(false);
    expect(lowercaseNobody("under", [])).toBe(false);
  });

  it("off (main): \"under\" is the one name the reader takes", () => {
    process.env.PERSON_GUARD_ENABLED = "true";
    installPersonRoster(() => NAMES);
    expect(namesSomebody("under")).toBe(true);
    expect(readEmployeeMentions("CA for under performance on Club Close % and Spa %").names).toContain("under");
  });

  it("on: \"under\" is not a name, with no roster name in the message; a lowercase roster first name still is", () => {
    process.env.PERSON_GUARD_ENABLED = "true";
    installPersonRoster(() => NAMES);
    on();
    installRosterAnchor(() => false);
    expect(namesSomebody("under")).toBe(false);
    expect(readEmployeeMentions("CA for under performance on Club Close % and Spa %").names).not.toContain("under");
    expect(namesSomebody("perpetua")).toBe(true);
  });

  it("on, with no roster: kept as before", () => {
    process.env.PERSON_GUARD_ENABLED = "true";
    on();
    expect(namesSomebody("under")).toBe(true);
  });
});

/*
 * APPROVED by QA (4 Nov 2026): "I need a corrective action verbal for
 * perpetua. This is for Under Performance on …" made the card "for **Club
 * Close**" with the three flags on. A single word typed in lowercase that is
 * somebody's first or preferred name on the roster anchors the message.
 */
describe("a roster first name typed in lowercase anchors the message", () => {
  const LOWER = "I need a corrective action verbal for perpetua. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.";
  const NOT_ON = "I need a corrective action verbal for zuleika. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.";

  it("lowercaseRosterFirstNameIn: a lowercase first or preferred name; roster data and how it was typed only", () => {
    expect(lowercaseRosterFirstNameIn(LOWER, PEOPLE)).toBe(true);
    expect(lowercaseRosterFirstNameIn("a CA for izzy, late again", PEOPLE)).toBe(true);
    expect(lowercaseRosterFirstNameIn(NOT_ON, PEOPLE)).toBe(false);
    expect(lowercaseRosterFirstNameIn("a CA for thornquist", PEOPLE)).toBe(false);
    expect(lowercaseRosterFirstNameIn("a CA for Perpetua", PEOPLE)).toBe(false);
    expect(lowercaseRosterFirstNameIn(LOWER, [])).toBe(false);
  });

  it("messageAnchoredOnRoster: \"perpetua\" anchors; \"zuleika\", nobody on the roster, does not", () => {
    expect(messageAnchoredOnRoster(LOWER, PEOPLE)).toBe(true);
    expect(messageAnchoredOnRoster(say("Perpetua Thornquist"), PEOPLE)).toBe(true);
    expect(messageAnchoredOnRoster(NOT_ON, PEOPLE)).toBe(false);
    expect(messageAnchoredOnRoster(say("Zuleika Brightwell"), PEOPLE)).toBe(false);
  });

  it("on: the grounding step sets the metrics aside beside \"perpetua\"", () => {
    expect(prep(LOWER).unmatched).toEqual(expect.arrayContaining(["Club Close", "Under"]));
    on();
    const prepared = prep(LOWER);
    expect(prepared.rosterAnchored).toBe(true);
    expect(prepared.unmatched).toEqual([]);
    expect(prepared.question).toBe(LOWER);
  });

  it("on, negative control: a lowercase word that is nobody on the roster is no anchor — read as before", () => {
    const off = prep(NOT_ON);
    on();
    const prepared = prep(NOT_ON);
    expect(prepared.rosterAnchored).toBeUndefined();
    expect(prepared).toEqual(off);
  });
});

