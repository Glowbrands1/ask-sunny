import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { namesSomebody } from "./answer-not-a-name";
import { managerContext, readEmployeeMentions, resolveEmployee } from "./proposal";
import {
  capitalisedListItems,
  installRequestMessage,
  offensePhrases,
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

  it("typedWithOtherSurname: a last initial that starts the surname is the surname (QA, 4 Nov 2026, \"Club Close\" live)", () => {
    on();
    expect(typedWithOtherSurname("perpetua", "Thornquist", [say("Perpetua T")])).toBe(false);
    expect(typedWithOtherSurname("perpetua", "Thornquist", [say("Perpetua T.")])).toBe(false);
    // Another initial is still another surname.
    expect(typedWithOtherSurname("perpetua", "Thornquist", [say("Perpetua K")])).toBe(true);
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

/*
 * QA review (5 Nov 2026): "for Under Performance" is an offense, not a name —
 * as the request slot ("I need a CA for Under Performance on …") and in a
 * later sentence ("I need a corrective action verbal. This is for Under
 * Performance on …"). The policy reader (`readCaPolicy`) decides; no list.
 */
describe("an offense after \"for\" is not a person", () => {
  const NO_NAME = "I need a corrective action verbal. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.";
  const SLOT_OFFENSE = "I need a CA for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.";

  it("on: \"Under Performance\" is an offense phrase, no slot, and \"Under\" is no candidate", () => {
    on();
    expect(offensePhrases(NO_NAME)).toEqual(["Under Performance"]);
    expect(requestSlotNames(SLOT_OFFENSE)).toBeNull();
    expect(outsideRequestSlot("Under", NO_NAME)).toBe(true);
    expect(outsideRequestSlot("Under", SLOT_OFFENSE)).toBe(true);
    expect(outsideRequestSlot("Under Performance", SLOT_OFFENSE)).toBe(true);
    installRequestMessage(() => SLOT_OFFENSE);
    expect(readEmployeeMentions(SLOT_OFFENSE).names).toEqual([]);
    installRequestMessage(() => NO_NAME);
    expect(readEmployeeMentions(NO_NAME).names).toEqual([]);
  });

  it("off (main): \"Under\" is read as a name", () => {
    expect(readEmployeeMentions(NO_NAME).names).toContain("Under");
  });

  it("on, control: a person after \"for\" is still the slot", () => {
    on();
    expect(requestSlotNames(PAU)).toEqual(["Remy Fenn"]);
    expect(outsideRequestSlot("Remy Fenn", PAU)).toBe(false);
  });
});


/*
 * Pau, via QA, 4 Nov 2026: the CORRECTIVE ACTION WINS. QA's production
 * messages (CA_SALES off) named another form where the person goes, and made
 * a Coaching Form card whose employee was "Club Close". Exact wording.
 */
describe("a corrective action for another form's name", () => {
  const A = "Create a Corrective Action for Coaching Form";
  const B = "I need a corrective action for Coaching Form. This is for Under Performance on Club Close % and Spa %.";
  const P1 = say("Coaching Form");

  it("off (main): the named form wins, and \"Club Close\" is a candidate", async () => {
    const { detectTemplateIntent } = await import("./template-intent");
    expect(detectTemplateIntent(B)).toEqual({ kind: "explicit", templateKey: "coaching" });
    installRequestMessage(() => B);
    expect(readEmployeeMentions(B).names).toContain("Club Close");
  });

  it("on: the request is a corrective action, for all three wordings", async () => {
    on();
    const { detectTemplateIntent } = await import("./template-intent");
    for (const text of [A, B, P1]) expect(detectTemplateIntent(text).kind, text).toBe("corrective_action");
  });

  it("on: the form's name is no person, and nothing else in the message is one", () => {
    on();
    expect(requestSlotNames(B)).toEqual([]);
    for (const candidate of ["Coaching Form", "Club Close", "Under"]) expect(outsideRequestSlot(candidate, B), candidate).toBe(true);
    installRequestMessage(() => B);
    expect(readEmployeeMentions(B).names).toEqual([]);
  });

  it("on, controls: a Coaching Form asked for by name, and a corrective action for a person, are unchanged", async () => {
    on();
    const { detectTemplateIntent } = await import("./template-intent");
    expect(detectTemplateIntent("Create a Coaching Form for Perpetua Thornquist")).toEqual({ kind: "explicit", templateKey: "coaching" });
    expect(requestSlotNames("I need a corrective action for Perpetua Thornquist, she was rude to a guest")).toEqual(["Perpetua Thornquist"]);
  });
});
