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

  // QA-6, 26 Oct 2026: a negated, undone or other-subject "effective" fills nothing.
  it("on, an effective date that is negated, undone or about something else fills nothing", () => {
    withFlag(true);
    for (const text of [
      "exit for ava pellmore not effective october 2",
      "exit for ava pellmore, the resignation was never effective october 2",
      "exit for ava pellmore, do not make it effective october 2",
      "exit for ava pellmore effective october 2 was cancelled, she stayed",
      "exit for ava pellmore not effective 11/1",
      "not effective 11/1",
      "exit for ava pellmore not effective until october 2",
      "the new dress code is effective october 1, exit for ava pellmore",
      "exit for ava pellmore, transfer to the other location effective october 2",
      // QA-6 round 2: withdrawn before the date, and undo phrases after it.
      "resignation withdrawn effective october 2",
      "resignation for ava pellmore, withdrawn, it was effective october 2",
      "exit for ava pellmore effective october 2 but she changed her mind",
      "exit for ava pellmore effective october 2, scratch that",
      "exit for ava pellmore effective october 2 is wrong",
      "exit for ava pellmore effective october 2 was rescinded",
      // No departure word in the sentence or the one before: not read.
      "effective as of 10/2",
      "effective date: october 2",
    ]) {
      expect(read(as(text)).lastDayWorked, text).toBeNull();
    }
  });

  it("on, the working cases stay", () => {
    withFlag(true);
    expect(read(as("exit form for ava pellmore effective 11/1 at the other location")).lastDayWorked).toBe("2026-11-01");
    expect(read(as("exit for ava pellmore effective 11/1 but last day 10/30")).lastDayWorked).toBe("2026-10-30");
    expect(read(as("exit for ava pellmore effective 11/1 and effective 11/8")).lastDayWorked).toBeNull();
    expect(read(as("ava pellmore resigned effective october 2")).lastDayWorked).toBe("2026-10-02");
    // A sentence that opens with "effective" belongs to the exit named in the one before it.
    expect(read(as("Exit form for Ava Pellmore. Effective 11/1.")).lastDayWorked).toBe("2026-11-01");
    expect(read(as("exit form for ava pellmore\n\neffective 11/1")).lastDayWorked).toBe("2026-11-01");
  });

  // QA-6 / QA-4, 26 Oct 2026: two dates joined by "or", and an unreadable second effective date.
  it("on, two effective dates joined by \"or\" are asked about, not the first one taken", () => {
    withFlag(true);
    for (const text of ["exit for ava pellmore effective october 2 or 11/1", "exit for ava pellmore effective 10/2 or 11/1"]) {
      const facts = read(as(text));
      expect(facts.lastDayWorked, text).toBeNull();
      expect(facts.ambiguities, text).toContainEqual({ kind: "date_conflict", role: "lastDayWorked", dates: ["2026-10-02", "2026-11-01"] });
    }
  });

  it("on, an unreadable effective date next to a readable one picks neither", () => {
    withFlag(true);
    for (const text of [
      "exit for ava pellmore effective 2 october and effective 11/8",
      "exit for ava pellmore effective the 2nd of october and effective 11/8",
    ]) {
      expect(read(as(text)).lastDayWorked, text).toBeNull();
    }
  });

  it("on, two different effective dates are not guessed between", () => {
    withFlag(true);
    expect(
      read(as("exit for ava pellmore effective october 2, or maybe effective october 9")).lastDayWorked,
    ).toBeNull();
  });
});
