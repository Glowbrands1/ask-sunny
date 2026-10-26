import { afterEach, describe, expect, it } from "vitest";

import { readExitDetails } from "./exit-details";
import { readExitFacts } from "./exit-facts";

/**
 * QA, 25 Oct 2026: Eligible for Rehire and Reason for Resignation stayed
 * blank for the way managers type them. The managers' wording is kept; the
 * people and salon are invented.
 */
const TODAY = "2026-10-25";
const FLAG = "EXIT_REHIRE_REASON_ENABLED";

function withFlag(on: boolean): void {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
}

afterEach(() => withFlag(false));

function details(text: string) {
  return readExitDetails(text, TODAY, readExitFacts(text, TODAY));
}

// conv_mvofngxg2xy7l11.
const RUN_ON =
  "exit form ava pellmore tc test salon gave notice 9/25 fulfilled 10/9 other career options items returned no deduct rehire yes";
// conv_mvoepgw32o35rpt, turns 2 and 3.
const NOT_REHIREBLE = "her last day is today she is not rehireble";
const NOT_ELIGABLE =
  "create an exit form for ava pellmore  she in not eligable for rehire because of her performace this month would have been a termination if she did not already ahave her notice in at the time. her last day will be 10/12/2026 and she submited her notice on 9/29/26  she put her notice in because she doesnt have time to work with her basketball schuedule  and school schedule";

describe("EXIT_REHIRE_REASON_ENABLED", () => {
  it("off, main's reading (the reported failures)", () => {
    withFlag(false);
    expect(details(RUN_ON).answers.eligible_for_rehire).toBeUndefined();
    expect(details(RUN_ON).resignationReason).toBeNull();
    expect(details(NOT_REHIREBLE).answers.eligible_for_rehire).toBeUndefined();
    expect(details(NOT_ELIGABLE).answers.eligible_for_rehire).toBeUndefined();
  });

  it('"not rehireble" and "not eligable for rehire" are not eligible', () => {
    withFlag(true);
    expect(details(NOT_REHIREBLE).answers.eligible_for_rehire).toBe("no");
    expect(details(NOT_ELIGABLE).answers.eligible_for_rehire).toBe("no");
  });

  it('a run-on "… rehire yes" is eligible, and "other career options" is the reason', () => {
    withFlag(true);
    const read = details(RUN_ON);
    expect(read.answers).toMatchObject({
      eligible_for_rehire: "yes",
      store_items_returned: "yes",
      payroll_deduction_applicable: "no",
    });
    expect(read.resignationReason).toBe("Other career options.");
  });

  it('"put her notice in because …" is the reason', () => {
    withFlag(true);
    expect(details(NOT_ELIGABLE).resignationReason).toMatch(
      /^She doesnt have time to work with her basketball schuedule\s+and school schedule\.$/,
    );
  });

  for (const on of [false, true]) {
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): rehire, method and items as typed`, () => {
      withFlag(on);
      expect(details("not rehirable").answers.eligible_for_rehire).toBe("no");
      expect(details("do not rehire").answers.eligible_for_rehire).toBe("no");
      expect(details("rehire yes").answers.eligible_for_rehire).toBe("yes");
      expect(
        details("all salon items were returned and she is eligible for rehire")
          .answers,
      ).toMatchObject({
        eligible_for_rehire: "yes",
        store_items_returned: "yes",
      });
      expect(details("she was a no call no show").resignationMethod).toBe(
        "No call/no show",
      );
      expect(
        readExitFacts("she was a no call no show", TODAY).typeOptions,
      ).toEqual(["no_call_no_show"]);
      expect(
        details("payroll deduction does not apply eligible for rehire").answers
          .eligible_for_rehire,
      ).toBe("yes");
    });
  }
});

/* QA, Sunny tester batch 13 (26 Oct 2026), invented names. */
const TERSE =
  "exit form ava pellmore tc test salon resigned 9-15 via woven last day 9-28 2 wk notice worked items returned rehire yes";
const RESIGNED_ON_WOVEN_TURN = "she resigned 9-15 on woven";

/* How managers type (Pau, 26 Oct 2026): all lowercase, and sentence case with names capitalised. */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  [
    "sentence case",
    (text) => {
      const lower = text
        .toLowerCase()
        .split("ava pellmore")
        .join("Ava Pellmore");
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    },
  ],
];

describe.each(REGISTERS)(
  "EXIT_REHIRE_REASON_ENABLED in the managers' register: %s",
  (_register, as) => {
    it("off, the batch-13 rehire and method stay blank (the reported failure)", () => {
      withFlag(false);
      expect(
        details(as(NOT_REHIREBLE)).answers.eligible_for_rehire,
      ).toBeUndefined();
      expect(details(as(RESIGNED_ON_WOVEN_TURN)).resignationMethod).toBeNull();
    });

    it("on, the misspellings, the run-on and the terse line fill their lines", () => {
      withFlag(true);
      expect(details(as(NOT_REHIREBLE)).answers.eligible_for_rehire).toBe("no");
      expect(details(as(NOT_ELIGABLE)).answers.eligible_for_rehire).toBe("no");
      expect(details(as(RUN_ON)).answers.eligible_for_rehire).toBe("yes");
      expect(details(as(RUN_ON)).resignationReason).toBe(
        "Other career options.",
      );
      expect(details(as(TERSE)).answers).toMatchObject({
        eligible_for_rehire: "yes",
        store_items_returned: "yes",
      });
      expect(details(as(TERSE)).resignationMethod).toBe("Woven message");
      expect(details(as(RESIGNED_ON_WOVEN_TURN)).resignationMethod).toBe(
        "Woven message",
      );
    });

    for (const on of [false, true]) {
      it(`NEVER-BREAK (flag ${on ? "on" : "off"}): stated answers and a Woven deadline that names no method`, () => {
        withFlag(on);
        expect(details(as("Do not rehire")).answers.eligible_for_rehire).toBe(
          "no",
        );
        expect(details(as("Rehire yes")).answers.eligible_for_rehire).toBe(
          "yes",
        );
        expect(
          details(
            as("All salon items were returned and she is eligible for rehire"),
          ).answers,
        ).toMatchObject({
          eligible_for_rehire: "yes",
          store_items_returned: "yes",
        });
        expect(details(as("She was a no call no show")).resignationMethod).toBe(
          "No call/no show",
        );
        expect(
          details(as("she missed the woven deadline")).resignationMethod,
        ).toBeNull();
        expect(
          details(as("is she eligible for rehire?")).answers
            .eligible_for_rehire,
        ).toBeUndefined();
      });
    }
  },
);
