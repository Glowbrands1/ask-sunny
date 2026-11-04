import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { namesSomebody } from "./answer-not-a-name";
import { managerContext, readEmployeeMentions, resolveEmployee } from "./proposal";
import {
  capitalisedListItems,
  installRequestMessage,
  outsideRequestSlot,
  requestSlotNames,
  typedWithOtherSurname,
} from "./request-slot";

/**
 * FORM_NAME_FROM_ROSTER_ENABLED, step 5 part 2 (QA for Pau, 5 Nov 2026). The
 * live re-flip asked "Which of them is this Corrective Action Form for — Remy
 * Fenn, Club Close or Under?" for Pau's message 1 with somebody not on the
 * roster. "Remy Fenn" is the live script's invented name; the others here are
 * invented too.
 */

const say = (name: string) =>
  `I need a corrective action verbal for ${name}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.`;
const PAU = say("Remy Fenn");
const TWO = "CA for Wilhelmina Corvina and Peregrine Varnholt for being late";
const METRICS = "CA for under performance on Club Close % and Spa %";

const FLAGS = ["FORM_NAME_FROM_ROSTER_ENABLED", "CA_SALES_POLICY_ENABLED"] as const;
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
  installRequestMessage(() => undefined);
});

const on = () => {
  process.env.FORM_NAME_FROM_ROSTER_ENABLED = "true";
  process.env.CA_SALES_POLICY_ENABLED = "true";
};

describe("the message's shape, roster-free", () => {
  it("the request slot: the names the first sentence asks a form for", () => {
    expect(requestSlotNames(PAU)).toEqual(["Remy Fenn"]);
    expect(requestSlotNames(TWO)).toEqual(["Wilhelmina Corvina", "Peregrine Varnholt"]);
    expect(requestSlotNames(METRICS)).toBeNull();
    // A first sentence that asks for no form has no slot.
    expect(requestSlotNames("This is for Under Performance on PPTA, LPSVA and Spa %.")).toBeNull();
  });

  it("a list of three or more: its capitalised items", () => {
    expect(capitalisedListItems(PAU)).toEqual(["PPTA", "LPSVA", "Club Average", "Club Close", "Spa"]);
    expect(capitalisedListItems(TWO)).toEqual([]);
  });

  it("outsideRequestSlot: the metrics are out, the slot's name and its first name are in", () => {
    on();
    expect(outsideRequestSlot("Club Close", PAU)).toBe(true);
    expect(outsideRequestSlot("Under", PAU)).toBe(true);
    expect(outsideRequestSlot("Club Average", PAU)).toBe(true);
    expect(outsideRequestSlot("Remy Fenn", PAU)).toBe(false);
    expect(outsideRequestSlot("Remy", PAU)).toBe(false);
    expect(outsideRequestSlot("Wilhelmina Corvina", TWO)).toBe(false);
    expect(outsideRequestSlot("Peregrine Varnholt", TWO)).toBe(false);
    // No request slot: only the list rule applies.
    expect(outsideRequestSlot("Club Close", METRICS)).toBe(false);
  });

  it("off: nothing is ruled out", () => {
    expect(outsideRequestSlot("Club Close", PAU)).toBe(false);
    expect(outsideRequestSlot("Under", PAU)).toBe(false);
  });

  it("typedWithOtherSurname: \"Remy Fenn\" is not Remy Calder; a close surname or a first name alone is", () => {
    on();
    expect(typedWithOtherSurname("remy", "Calder", [PAU])).toBe(true);
    expect(typedWithOtherSurname("remy", "Calder", ["CA for Remy Caldr for being late"])).toBe(false);
    expect(typedWithOtherSurname("remy", "Calder", ["remy was late again"])).toBe(false);
    // A capital after the sentence ends is not a surname.
    expect(typedWithOtherSurname("perpetua", "Thornquist", [say("perpetua")])).toBe(false);
  });
});

describe("the name readers, with the turn's message", () => {
  it("off (main): Pau's message reads the metrics as people", () => {
    installRequestMessage(() => PAU);
    expect(readEmployeeMentions(PAU).names).toEqual(expect.arrayContaining(["Remy Fenn", "Club Close", "Under"]));
    expect(resolveEmployee(managerContext([], { content: PAU })).kind).toBe("ambiguous");
  });

  it("on: Remy Fenn is the only candidate, so there is no \"Which of them\"", () => {
    on();
    installRequestMessage(() => PAU);
    expect(namesSomebody("Club Close")).toBe(false);
    expect(namesSomebody("Under")).toBe(false);
    expect(namesSomebody("Remy Fenn")).toBe(true);
    expect(readEmployeeMentions(PAU).names).toEqual(["Remy Fenn"]);
    expect(resolveEmployee(managerContext([], { content: PAU })).kind).not.toBe("ambiguous");
  });

  it("on, control: two people named on purpose are still both candidates", () => {
    on();
    installRequestMessage(() => TWO);
    expect(readEmployeeMentions(TWO).names).toEqual(expect.arrayContaining(["Wilhelmina Corvina", "Peregrine Varnholt"]));
  });
});
