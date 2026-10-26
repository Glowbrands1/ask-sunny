import { afterEach, describe, expect, it } from "vitest";

import { readExitFacts } from "./exit-facts";

/**
 * EXIT_EFFECTIVE_DATE_ENABLED (QA tester, 26 Oct 2026): "Exit for <name>
 * effective october 2" filled nothing on the exit form. The manager's wording
 * is kept; the person is invented.
 */
const FLAG = "EXIT_EFFECTIVE_DATE_ENABLED";
const TODAY = "2026-10-26";

function withFlag(on: boolean): void {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
}

afterEach(() => withFlag(false));

const read = (text: string) => readExitFacts(text, TODAY);

/* How managers type (Pau, 26 Oct 2026): all lowercase, and sentence case with the name capitalised. */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  [
    "sentence case",
    (text) => {
      const lower = text.toLowerCase().split("ava pellmore").join("Ava Pellmore");
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    },
  ],
  ["ALL CAPS", (text) => text.toUpperCase()],
];

const REPORTED = "Exit for ava pellmore effective october 2";

describe.each(REGISTERS)("EXIT_EFFECTIVE_DATE_ENABLED, %s", (_register, as) => {
  it("off, the effective date fills nothing (the reported failure)", () => {
    withFlag(false);
    expect(read(as(REPORTED)).lastDayWorked).toBeNull();
  });

  it("on, the effective date is the last day worked", () => {
    withFlag(true);
    const facts = read(as(REPORTED));
    expect(facts.lastDayWorked).toBe("2026-10-02");
    expect(facts.ambiguities).toEqual([]);
  });

  it("on, the other ways of writing it", () => {
    withFlag(true);
    expect(read(as("exit for ava pellmore effective 10/2")).lastDayWorked).toBe("2026-10-02");
    expect(read(as("exit for ava pellmore effective on 10/2")).lastDayWorked).toBe("2026-10-02");
    expect(read(as("exit for ava pellmore, effective as of oct 2")).lastDayWorked).toBe("2026-10-02");
    expect(read(as("exit for ava pellmore effective date: 10/2/26")).lastDayWorked).toBe("2026-10-02");
  });

  for (const on of [false, true]) {
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): "effective immediately" names no date`, () => {
      withFlag(on);
      expect(read(as("exit for ava pellmore she resigned effective immediately")).lastDayWorked).toBeNull();
    });

    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): a stated last day wins`, () => {
      withFlag(on);
      expect(
        read(as("exit for ava pellmore effective october 2, her last day worked was 9/28")).lastDayWorked,
      ).toBe("2026-09-28");
      expect(read(as("exit for ava pellmore last day was 9/30")).lastDayWorked).toBe("2026-09-30");
    });
  }

  it("on, two different effective dates are not guessed between", () => {
    withFlag(true);
    expect(
      read(as("exit for ava pellmore effective october 2, or maybe effective october 9")).lastDayWorked,
    ).toBeNull();
  });
});
