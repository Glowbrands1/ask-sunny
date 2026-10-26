import { afterEach, describe, expect, it } from "vitest";

import { readExitFacts } from "./exit-facts";

/**
 * QA, 25 Oct 2026: "Date that notice was fulfilled" stayed blank and the
 * Submitted & Fulfilled Notice box unticked when the manager said the notice
 * was worked; "9/25 gave notice worked it til 10/9" put 10/9 on the notice
 * line. The managers' wording is kept; the people and salon are invented.
 */
const TODAY = "2026-10-25";
const FLAG = "EXIT_NOTICE_FULFILLED_ENABLED";

function withFlag(on: boolean): void {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
}

afterEach(() => withFlag(false));

// conv_mvofnrm5217ss9v, turn 4.
const WORKED_IT_TIL = "9/25 gave notice worked it til 10/9";
// conv_mvodv9bh26p0jf4, turns 1 and 2.
const GAVE_AND_WORKED =
  "create an exit form. employee name is ava pellmore. ava was a tanning consultant at test salon location. on 9-15-26 ava provided her resignation to management and her last day worked was 9-28-26\n\nava gave and worked 2 week notice. ava messaged management her resignation via woven. all salon items were returned and she is eligible for rehire";
// conv_mvofngxg2xy7l11.
const FULFILLED_RUN_ON =
  "exit form ava pellmore tc test salon gave notice 9/25 fulfilled 10/9 other career options items returned no deduct rehire yes";

describe("EXIT_NOTICE_FULFILLED_ENABLED", () => {
  it("off, main's reading (the reported failures)", () => {
    withFlag(false);
    expect(readExitFacts(WORKED_IT_TIL, TODAY)).toMatchObject({
      noticeGiven: "2026-10-09",
      lastDayWorked: null,
    });
    expect(readExitFacts(GAVE_AND_WORKED, TODAY).noticeFulfilled).toBeNull();
    expect(readExitFacts(FULFILLED_RUN_ON, TODAY).noticeFulfilled).toBeNull();
  });

  it('"worked it til 10/9" is the last day; "9/25 gave notice" stays the notice date', () => {
    withFlag(true);
    expect(readExitFacts(WORKED_IT_TIL, TODAY)).toMatchObject({
      noticeGiven: "2026-09-25",
      lastDayWorked: "2026-10-09",
      noticeFulfilled: "2026-10-09",
      noticeOptions: ["submitted_fulfilled_notice"],
    });
  });

  it("a worked notice is fulfilled on the last day worked, and the box is ticked", () => {
    withFlag(true);
    expect(readExitFacts(GAVE_AND_WORKED, TODAY)).toMatchObject({
      lastDayWorked: "2026-09-28",
      noticeGiven: "2026-09-15",
      noticeFulfilled: "2026-09-28",
      noticeOptions: ["submitted_fulfilled_notice"],
    });
  });

  it('"gave notice 9/25 fulfilled 10/9" fills the fulfilled date, the last day and the box', () => {
    withFlag(true);
    expect(readExitFacts(FULFILLED_RUN_ON, TODAY)).toMatchObject({
      noticeGiven: "2026-09-25",
      noticeFulfilled: "2026-10-09",
      lastDayWorked: "2026-10-09",
      noticeOptions: ["submitted_fulfilled_notice"],
    });
  });

  it("never invents a fulfilled date: a notice not worked, or no last day, leaves it blank", () => {
    withFlag(true);
    expect(
      readExitFacts(
        "she gave notice 9/25 but did not work her notice, last day 9/30",
        TODAY,
      ),
    ).toMatchObject({
      noticeFulfilled: null,
      noticeOptions: [],
      typeOptions: ["notice_not_fulfilled"],
    });
    expect(
      readExitFacts("ava gave and worked 2 week notice", TODAY),
    ).toMatchObject({
      noticeFulfilled: null,
      lastDayWorked: null,
      noticeOptions: ["submitted_fulfilled_notice"],
    });
  });

  for (const on of [false, true]) {
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): notice given and last day stay as stated`, () => {
      withFlag(on);
      expect(
        readExitFacts(
          "on 9-15-26 ava provided her resignation to management and her last day worked was 9-28-26",
          TODAY,
        ),
      ).toMatchObject({
        noticeGiven: "2026-09-15",
        lastDayWorked: "2026-09-28",
        resignationDate: "2026-09-15",
      });
      expect(readExitFacts("her last day is today", TODAY).lastDayWorked).toBe(
        TODAY,
      );
    });
  }
});

/*
 * QA, Sunny tester batch 13 (26 Oct 2026), invented names: a terse one-liner
 * and an impatient multi-turn chat. Year-less dashed dates ("last day 9-28",
 * "resigned 9-15") take the most recent such day; "2 wk notice worked" and
 * "she worked the notice" are a worked notice.
 */
const TERSE =
  "exit form ava pellmore tc test salon resigned 9-15 via woven last day 9-28 2 wk notice worked items returned rehire yes";
const IMPATIENT = [
  "create an exit form for ava pellmore",
  "tc test salon",
  "she resigned 9-15 on woven",
  "last day 9-28",
  "I already told you she worked the notice",
  "just make it",
].join("\n\n");

/* How managers type (Pau, 26 Oct 2026): all lowercase, and sentence case with names capitalised. */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  [
    "sentence case",
    (text) =>
      text
        .toLowerCase()
        .split("ava pellmore")
        .join("Ava Pellmore")
        .split("\n\n")
        .map((turn) => turn.charAt(0).toUpperCase() + turn.slice(1))
        .join("\n\n"),
  ],
];

const EVERY_WORDING: [string, string][] = [
  ["worked it til", WORKED_IT_TIL],
  ["gave and worked", GAVE_AND_WORKED],
  ["fulfilled run-on", FULFILLED_RUN_ON],
  ["terse", TERSE],
  ["impatient", IMPATIENT],
];

describe.each(REGISTERS)(
  "EXIT_NOTICE_FULFILLED_ENABLED in the managers' register: %s",
  (_register, as) => {
    it("off, the batch-13 wordings leave the dates blank (the reported failure)", () => {
      withFlag(false);
      expect(readExitFacts(as(TERSE), TODAY)).toMatchObject({
        lastDayWorked: null,
        noticeFulfilled: null,
      });
      expect(readExitFacts(as(IMPATIENT), TODAY)).toMatchObject({
        lastDayWorked: null,
        noticeFulfilled: null,
      });
    });

    it("terse: last day 9-28, resigned 9-15, a worked notice fulfilled on 9-28 and the box ticked", () => {
      withFlag(true);
      expect(readExitFacts(as(TERSE), TODAY)).toMatchObject({
        lastDayWorked: "2026-09-28",
        resignationDate: "2026-09-15",
        noticeFulfilled: "2026-09-28",
        noticeOptions: ["submitted_fulfilled_notice"],
      });
    });

    it("impatient: the short year-less replies set the dates, and the worked notice is fulfilled on the last day", () => {
      withFlag(true);
      expect(readExitFacts(as(IMPATIENT), TODAY)).toMatchObject({
        lastDayWorked: "2026-09-28",
        resignationDate: "2026-09-15",
        noticeFulfilled: "2026-09-28",
        noticeOptions: ["submitted_fulfilled_notice"],
      });
    });

    it.each(EVERY_WORDING)(
      "%s reads the same in this register as typed",
      (_name, wording) => {
        withFlag(true);
        expect(readExitFacts(as(wording), TODAY)).toEqual(
          readExitFacts(wording, TODAY),
        );
      },
    );

    for (const on of [false, true]) {
      it(`NEVER-BREAK (flag ${on ? "on" : "off"}): a stated notice date and last day stay; no notice worked, no fulfilled date`, () => {
        withFlag(on);
        expect(
          readExitFacts(
            as(
              "on 9-15-26 ava provided her resignation to management and her last day worked was 9-28-26",
            ),
            TODAY,
          ),
        ).toMatchObject({
          noticeGiven: "2026-09-15",
          lastDayWorked: "2026-09-28",
        });
        expect(
          readExitFacts(as("she quit on 9/20"), TODAY).lastDayWorked,
        ).toBeNull();
        expect(
          readExitFacts(
            as("she only worked 2 weeks before quitting, last day 9/30"),
            TODAY,
          ),
        ).toMatchObject({
          noticeFulfilled: null,
          noticeOptions: [],
        });
        expect(
          readExitFacts(as("she worked 10-12 hours a week"), TODAY)
            .lastDayWorked,
        ).toBeNull();
      });
    }
  },
);
