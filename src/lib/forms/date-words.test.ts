import { afterEach, describe, expect, it, vi } from "vitest";

import {
  protectDateDots,
  restoreDateDots,
  stepCuedInDateChange,
  unreadDateQuestion,
  unreadDateTokens,
  wideDatesInText,
} from "./date-words";
import { withUnreadDateQuestion } from "./unread-date-question";
import { readExitFacts } from "./exit-facts";
import { datesInText, formDateChange, formDateChangeUnclear, listIncidentDates } from "./form-date-answer";

/**
 * DATE_READER_WIDE_ENABLED — QA-6's probes of main's date readers (26 Oct
 * 2026, today = 2026-10-26), word for word. The shapes main drops are read;
 * the shapes main reads are read exactly as before (NEVER-BREAK); with the
 * flag off `datesInText` is main's. The route-level cells are in
 * `src/app/api/chat/date-matrix-e2e.test.ts`.
 */

const TODAY = "2026-10-26";
const isos = (text: string) => datesInText(text, TODAY).map((found) => found.iso);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the shapes main drops are read", () => {
  it.each([
    ["late on 2 october", "2026-10-02"],
    ["late on 2nd of october", "2026-10-02"],
    ["late on october second", "2026-10-02"],
    ["late on 2-Oct", "2026-10-02"],
    ["late on Oct-2", "2026-10-02"],
    ["late on 10-2", "2026-10-02"],
    ["late on 10.2", "2026-10-02"],
    ["late on 1002", "2026-10-02"],
    ["late on the 2nd", "2026-10-02"],
    ["late on 16 october", "2026-10-16"],
    ["late on 16 Oct", "2026-10-16"],
    ["late on the 16th", "2026-10-16"],
    ["late on the 30th", "2026-09-30"],
    ["late on 5th of october", "2026-10-05"],
    ["late on october twenty-first", "2026-10-21"],
    ["late on the second of october", "2026-10-02"],
    ["late on 2 october 2025", "2025-10-02"],
    ["late on 12-20", "2025-12-20"],
    ["follow up on 11-2", "2026-11-02"],
    ["follow up on 2 november", "2026-11-02"],
  ])("%s → %s", (text, iso) => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(isos(text)).toEqual([iso]);
    for (const casing of [text.toLowerCase(), text.toUpperCase()]) expect(isos(casing)).toEqual([iso]);
  });

  it('keeps every date in a list: "late on 2 october and 10/9 and 10/16"', () => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(isos("late on 2 october and 10/9 and 10/16")).toEqual(["2026-10-02", "2026-10-09", "2026-10-16"]);
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "");
    expect(isos("late on 2 october and 10/9 and 10/16")).toEqual(["2026-10-09", "2026-10-16"]);
  });
});

describe("NEVER-BREAK: what main reads is read the same, flag on or off", () => {
  it.each([
    "late on 10/2",
    "late on 10/2/26",
    "late on 10.2.26",
    "late on 10/02/2026",
    "late on 2026-10-02",
    "late on October 2",
    "late on Oct 2nd",
    "late on oct. 2",
    "late on Oct 2nd 2026",
    "late on fri 10/2",
    "late on 10-16-26 and 10/20",
  ])("%s", (text) => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "");
    const off = datesInText(text, TODAY);
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(datesInText(text, TODAY)).toEqual(off);
  });
});

describe("what is not a date stays unread", () => {
  it.each([
    "she was 10-15 minutes late",
    "worked 3.5 hours",
    "the drawer was short $3.25",
    "it was the 2nd time she was late",
    "she works the 3rd shift",
    "rated 4.5 stars",
    "counted 1002 items",
    "she was late on friday",
    "Payroll deduction amount: 3.25.",
    "payroll deduct applies and 3.25 will be deducted from check",
  ])("%s", (text) => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(wideDatesInText(text, TODAY, datesInText(text, TODAY).filter(() => false))).toEqual([]);
  });

  it("the flag off is main", () => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "");
    expect(isos("late on 2 october, 10-2, the 2nd")).toEqual([]);
  });
});

describe("a date that cannot be read is asked about once", () => {
  it.each([
    ["she was late on 13/45", "13/45"],
    ["she was late on 32 october", "32 october"],
    ["she was late on october 45", "october 45"],
    ["she was late on 1345", "on 1345"],
    ["change the date to 1002", "1002"],
    ["her last day was 1002", "1002"],
  ])("%s", (text, typed) => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(unreadDateTokens(text, datesInText(text, TODAY))).toEqual([typed]);
  });

  it("a read date is not asked about, nor a range", () => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    for (const text of ["late on 2 october", "late on 10-2", "she was 10-15 minutes late", "short $3.25", "Payroll deduction amount: 3.25."]) {
      expect(unreadDateTokens(text, datesInText(text, TODAY))).toEqual([]);
    }
  });

  it("the question", () => {
    expect(unreadDateQuestion("13/45")).toBe('I couldn\'t read the date "13/45" — which date did you mean?');
  });
});

describe('"change the date to …" (QA-6 date-edit probes)', () => {
  it('"change the date to 10-20, verbal was 9/15" is 10/20, never 9/15', () => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(formDateChange("change the date to 10-20, verbal was 9/15", TODAY)).toBe("2026-10-20");
    expect(formDateChange("change the date to 2 october, verbal was 9/15", TODAY)).toBe("2026-10-02");
    expect(formDateChange("change the date to 10/20, written was 9/15", TODAY)).toBe("2026-10-20");
    expect(formDateChange("change the date to 10/20, coaching was 9/1", TODAY)).toBe("2026-10-20");
    const said = "change the date to 10-20, verbal was 9/15";
    expect(stepCuedInDateChange(said, said.indexOf("9/15"))).toBe(true);
    expect(stepCuedInDateChange(said, said.indexOf("10-20"))).toBe(false);
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "");
    expect(formDateChange("change the date to 10-20, verbal was 9/15", TODAY)).toBe("2026-09-15");
  });

  it.each([
    ["change the date to 10-2", "2026-10-02"],
    ["change the date to 10-20", "2026-10-20"],
    ["change the date to 10.2", "2026-10-02"],
    ["change the date to 2 october", "2026-10-02"],
    ["change the date to 2-Oct", "2026-10-02"],
    ["change the date to the 2nd", "2026-10-02"],
  ])("%s → %s", (text, iso) => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(formDateChange(text, TODAY)).toBe(iso);
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "");
    expect(formDateChange(text, TODAY)).toBeNull();
  });

  it('"change the date to 10-20 and 10-21" asks which, once', () => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(formDateChange("change the date to 10-20 and 10-21", TODAY)).toBeNull();
    expect(formDateChangeUnclear("change the date to 10-20 and 10-21", TODAY)).toEqual({ offered: ["2026-10-20", "2026-10-21"] });
  });
});

describe("QA-3 (26 Oct 2026): a day and a short month name, and a yearless exit date", () => {
  const SAID = "written ca for Rowan Pell, late to open 20 oct. prior verbal 25 jun, written 28 jul";
  const casings = (text: string) => [text.toLowerCase(), text.replace(/(^|\.\s+)([a-z])/g, (_all, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`), text.toUpperCase()];

  it.each([
    ["late on 20 oct", "2026-10-20"],
    ["late on 25 jun", "2026-06-25"],
    ["late on 28 jul", "2026-07-28"],
  ])("%s → %s, in every casing", (text, iso) => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    for (const typed of casings(text)) expect(isos(typed)).toEqual([iso]);
  });

  it('"late to open 20 oct. prior … 25 jun … 28 jul": the priors are dates, and never the form\'s', () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    for (const typed of casings(SAID)) {
      vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
      expect(isos(typed)).toEqual(["2026-10-20", "2026-06-25", "2026-07-28"]);
      expect(listIncidentDates(typed, TODAY).map((found) => found.iso)).toEqual(["2026-10-20"]);
      vi.stubEnv("DATE_READER_WIDE_ENABLED", "");
      expect(isos(typed)).toEqual([]);
    }
  });

  it.each([
    ["create an exit form for Rowan Pell, she resigned and her last day was 20 oct", "lastDayWorked", "2026-10-20"],
    ["create an exit form for Rowan Pell, she resigned and her last day was 10-20", "lastDayWorked", "2026-10-20"],
    ["create an exit form for Rowan Pell, she quit on 25 jun", "resignationDate", "2026-06-25"],
    ["create an exit form for Rowan Pell, she quit on 10-20", "resignationDate", "2026-10-20"],
  ] as const)("%s → %s %s", (text, role, iso) => {
    for (const typed of casings(text)) {
      vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
      expect(readExitFacts(typed, TODAY)[role]).toBe(iso);
      vi.stubEnv("DATE_READER_WIDE_ENABLED", "");
      expect(readExitFacts(typed, TODAY)[role]).toBeNull();
    }
  });
});

describe("a dot inside a date ends no sentence (QA's live date run, 26 Oct 2026)", () => {
  const split = (text: string) =>
    protectDateDots(text)
      .split(/[.!?;]+(?=\s|$)/)
      .map((part) => restoreDateDots(part).trim())
      .filter(Boolean);

  it.each([
    ["she was late on 10.5.26", ["she was late on 10.5.26"]],
    ["she was late on oct. 5", ["she was late on oct. 5"]],
    ["She was late on Sept. 5. She did not call.", ["She was late on Sept. 5", "She did not call"]],
    ["SHE WAS LATE ON OCT. 5. SHE DID NOT CALL", ["SHE WAS LATE ON OCT. 5", "SHE DID NOT CALL"]],
    ["the drawer was short $3.25. she paid it back", ["the drawer was short $3.25", "she paid it back"]],
  ])("%s", (text, sentences) => {
    expect(split(text)).toEqual(sentences);
  });

  it("restores exactly what it masked", () => {
    const text = "late on 10.5.26 and oct. 5, short $3.25. Done.";
    expect(restoreDateDots(protectDateDots(text))).toBe(text);
  });
});

describe("the one question for a date no reader can place", () => {
  const card = { content: "Here is the Corrective Action Form.", formProposal: { templateKey: "dpoa" } };

  it("is added once to a turn that makes a card, only with the flag", () => {
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "1");
    expect(withUnreadDateQuestion(card, "ca for Rowan Pell, she was late on 13/45", TODAY).content).toBe(
      'Here is the Corrective Action Form.\n\nI couldn\'t read the date "13/45" — which date did you mean?',
    );
    expect(withUnreadDateQuestion(card, "ca for Rowan Pell, she was late on 2 october", TODAY)).toBe(card);
    const asked = { ...card, content: "Which date goes on the form?" };
    expect(withUnreadDateQuestion(asked, "late on 13/45", TODAY)).toBe(asked);
    expect(withUnreadDateQuestion({ content: "An answer." }, "what about 13/45", TODAY).content).toBe("An answer.");
    vi.stubEnv("DATE_READER_WIDE_ENABLED", "");
    expect(withUnreadDateQuestion(card, "ca for Rowan Pell, she was late on 13/45", TODAY)).toBe(card);
  });
});
