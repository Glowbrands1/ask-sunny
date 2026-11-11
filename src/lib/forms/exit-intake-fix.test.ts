import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isExitAnswerPhrase } from "./exit-answer-phrase";
import { exitCorrectionValues, exitDetailValues, inStatedPermanentAddress, readExitDetails, readPermanentAddress } from "./exit-details";
import { readExitFacts } from "./exit-facts";
import { EXIT_OPTION } from "./exit-library";

/**
 * The exit readers behind EXIT_INTAKE_FIX_ENABLED (ported from the sibling app's live QA, 25 Oct 2026). The
 * route-level replay of the sibling managers' turns, in this app's wording, is
 * `src/lib/ai/exit-intake-oct25.test.ts`; these pin each reader, with
 * the flag on and off. Synthetic names and a made-up address.
 */

const TODAY = "2026-10-25";
const FLAG = "EXIT_INTAKE_FIX_ENABLED";
let previous: string | undefined;

beforeEach(() => {
  previous = process.env[FLAG];
  process.env[FLAG] = "true";
});
afterEach(() => {
  if (previous === undefined) delete process.env[FLAG];
  else process.env[FLAG] = previous;
});

describe("a yearless dashed date after an exit cue", () => {
  it('"she resigned, last day 10-24" is the most recent October 24', () => {
    expect(readExitFacts("create an exit form for Test Employee at Lawrence, she resigned, last day 10-24", TODAY).lastDayWorked).toBe(
      "2026-10-24",
    );
  });

  it("a month-day later in the year than today is last year's, as the late-opening reader reads it", () => {
    expect(readExitFacts("her last day was 12-02", TODAY).lastDayWorked).toBe("2025-12-02");
  });

  it('a range is not a date: "worked 10-12 hours" fills nothing', () => {
    const facts = readExitFacts("her last day she worked 10-12 hours", TODAY);
    expect(facts.lastDayWorked).toBeNull();
  });

  it("with a year, unchanged", () => {
    expect(readExitFacts("last day worked 10-17-26", TODAY).lastDayWorked).toBe("2026-10-17");
  });
});

describe('"gave notice 9/25/26 – fulfilled 10/9/26"', () => {
  it("reads the bare 'fulfilled' date as the notice's fulfilled date, and the last day from it", () => {
    const facts = readExitFacts("Gave notice 9/25/26 – fulfilled 10/9/26, resigning to pursue other career options", TODAY);
    expect(facts.noticeGiven).toBe("2026-09-25");
    expect(facts.noticeFulfilled).toBe("2026-10-09");
    expect(facts.lastDayWorked).toBe("2026-10-09");
  });

  it("a bare 'completed 10/9' with no notice in the sentence fills nothing", () => {
    expect(readExitFacts("training completed 10/9/26", TODAY).noticeFulfilled).toBeNull();
  });
});

describe("no call no show in words", () => {
  it('"she did not call in for her last two shifts" ticks No Call No Show and says how she left', () => {
    const text = "She did not call in for her last two shifts. Last day worked 10-20-26";
    expect(readExitFacts(text, TODAY).typeOptions).toContain(EXIT_OPTION.noCallNoShow);
    expect(readExitDetails(text, TODAY).resignationMethod).toBe("No call/no show");
  });

  it('"called in sick for her shift" is not a no call no show', () => {
    expect(readExitFacts("she called in sick for her shift on 10-20-26", TODAY).typeOptions).not.toContain(EXIT_OPTION.noCallNoShow);
  });
});

describe("the Permanent Address", () => {
  const TURN = "create an exit form for Test Employee at Lawrence, permanent address 123 Main St, Lawrence, KS 66044. She did not call in";

  it("is read through the ZIP code and goes on the form's Permanent Address line", () => {
    expect(readPermanentAddress(TURN)).toBe("123 Main St, Lawrence, KS 66044");
    expect(exitDetailValues(readExitDetails(TURN, TODAY)).values.permanent_address).toBe("123 Main St, Lawrence, KS 66044");
  });

  it("without a ZIP, to the end of the sentence; a street with no number is not read", () => {
    expect(readPermanentAddress("her address is 42 Oak Ave Apt 3. last day 10-20-26")).toBe("42 Oak Ave Apt 3");
    expect(readPermanentAddress("permanent address unknown")).toBeNull();
  });

  it("a name inside it is a street, not a person", () => {
    expect(inStatedPermanentAddress("Main St", TURN)).toBe(true);
    expect(inStatedPermanentAddress("Test Employee", TURN)).toBe(false);
  });
});

describe("an explicit edit of the reason", () => {
  it.each([
    ["I need to edit the reason for resignation to: going back to school", "Going back to school."],
    ["change the reason to moving to Denver", "Moving to Denver."],
    ["the reason should be family reasons", "Family reasons."],
  ])("%s", (turn, reason) => {
    expect(readExitDetails(turn, TODAY).resignationReason).toBe(reason);
  });

  it("the later turn wins over the reason first given", () => {
    const text = [
      "create an exit form for Test Employee at Lawrence, she resigned, last day 10-24-26, reason for resignation: moving out of state",
      "I need to edit the reason for resignation to: going back to school",
    ].join("\n\n");
    expect(readExitDetails(text, TODAY).resignationReason).toBe("Going back to school.");
  });

  it("is the manager's correction on a created exit form too", () => {
    expect(exitCorrectionValues("I need to edit the reason for resignation to: going back to school", TODAY)?.values).toEqual({
      resignation_reason: "Going back to school.",
    });
  });
});

describe("an exit answer is not a person", () => {
  it.each(["items returned", "Items Returned", "store items were returned", "key returned", "returned her key", "payroll deduction"])(
    "%s",
    (phrase) => expect(isExitAnswerPhrase(phrase)).toBe(true),
  );

  it.each(["Test Employee", "Jane Doe", "Kim Key", "Bonnie"])("%s is a person", (name) => expect(isExitAnswerPhrase(name)).toBe(false));
});

describe("flag off: read as before", () => {
  beforeEach(() => {
    process.env[FLAG] = "false";
  });

  it("no yearless date, no bare fulfilled date, no address, no no-call, no reason edit, no answer phrase", () => {
    expect(readExitFacts("she resigned, last day 10-24", TODAY).lastDayWorked).toBeNull();
    expect(readExitFacts("Gave notice 9/25/26 – fulfilled 10/9/26", TODAY).noticeFulfilled).toBeNull();
    expect(readPermanentAddress("permanent address 123 Main St, Lawrence, KS 66044")).toBeNull();
    expect(readExitFacts("She did not call in for her last two shifts.", TODAY).typeOptions).toEqual([]);
    expect(readExitDetails("I need to edit the reason for resignation to: going back to school", TODAY).resignationReason).toBeNull();
    expect(isExitAnswerPhrase("items returned")).toBe(false);
  });
});
