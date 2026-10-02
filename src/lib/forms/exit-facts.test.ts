import { describe, expect, it } from "vitest";

import { EXIT_OPTION } from "./exit-library";
import { exitFactValues, exitFactsSupplied, readExitFacts } from "./exit-facts";

/** A Monday, so "last Friday" and "yesterday" have one right answer. */
const TODAY = "2026-09-28";
const read = (text: string) => readExitFacts(text, TODAY);

describe("the dates, each on its own line", () => {
  it("reads the last day worked and the notice date from one sentence", () => {
    const facts = read("She gave her two weeks notice on 9/1 and her last day was 9/15.");
    expect(facts.noticeGiven).toBe("2026-09-01");
    expect(facts.lastDayWorked).toBe("2026-09-15");
    expect(facts.noticeFulfilled).toBeNull();
    expect(facts.ambiguities).toEqual([]);
  });

  it("reads them in either order and in written-out months", () => {
    const facts = read("Last day worked was September 15th, after giving notice Sept. 1");
    expect(facts.lastDayWorked).toBe("2026-09-15");
    expect(facts.noticeGiven).toBe("2026-09-01");
  });

  it("reads a date named after the fact, and ISO dates", () => {
    expect(read("2026-09-12 was her last day").lastDayWorked).toBe("2026-09-12");
    expect(read("resigned on 09/02/2026").noticeGiven).toBe("2026-09-02");
  });

  it("reads today, yesterday and the last or next weekday against the business day", () => {
    expect(read("his last shift was yesterday").lastDayWorked).toBe("2026-09-27");
    expect(read("her last day is today").lastDayWorked).toBe("2026-09-28");
    expect(read("Her last day was last Friday").lastDayWorked).toBe("2026-09-25");
    expect(read("put in his notice this past Monday").noticeGiven).toBe("2026-09-21");
    expect(read("final day will be next Friday").lastDayWorked).toBe("2026-10-02");
  });

  it("reads a weekday written beside its date as that date", () => {
    expect(read("Her last day was Friday, September 25").lastDayWorked).toBe("2026-09-25");
  });

  it("reads the fulfilled date only from words that say the notice was fulfilled", () => {
    const facts = read("Gave notice 9/1. She worked out her notice through 9/15.");
    expect(facts.noticeGiven).toBe("2026-09-01");
    // "worked out her notice through 9/15" says when the notice was fulfilled. It does
    // not separately say 9/15 was a day worked, so that line is not filled from it.
    expect(facts.noticeFulfilled).toBe("2026-09-15");
    expect(facts.lastDayWorked).toBeNull();
    expect(read("notice was fulfilled on 9/15").noticeFulfilled).toBe("2026-09-15");
  });

  it("never computes a date from a duration", () => {
    const facts = read("She gave two weeks notice on 9/1.");
    expect(facts.noticeGiven).toBe("2026-09-01");
    expect(facts.noticeFulfilled).toBeNull();
    expect(facts.lastDayWorked).toBeNull();
  });

  it("assigns nothing to a date whose words do not say which line it is", () => {
    const facts = read("She quit on 9/20.");
    expect(facts.lastDayWorked).toBeNull();
    expect(facts.noticeGiven).toBeNull();
    expect(read("Create an STC exit for Sarah, the incident was 9/20").lastDayWorked).toBeNull();
  });

  it("does not read a follow-on sentence's cue into the previous date", () => {
    const facts = read("Her last day was 9/15, she gave notice 9/1");
    expect(facts.lastDayWorked).toBe("2026-09-15");
    expect(facts.noticeGiven).toBe("2026-09-01");
  });

  it("refuses a nonexistent date rather than rolling it over", () => {
    expect(read("last day was 2/30").lastDayWorked).toBeNull();
  });
});

describe("what is genuinely ambiguous is reported, not guessed", () => {
  it("two different last days", () => {
    const facts = read("Her last day was 9/15. Actually her last day was 9/16.");
    expect(facts.lastDayWorked).toBeNull();
    expect(facts.ambiguities).toEqual([
      { kind: "date_conflict", role: "lastDayWorked", dates: ["2026-09-15", "2026-09-16"] },
    ]);
  });

  it("a bare weekday", () => {
    const facts = read("her last day was Friday");
    expect(facts.lastDayWorked).toBeNull();
    expect(facts.ambiguities).toEqual([
      { kind: "weekday", role: "lastDayWorked", phrase: "Friday" },
    ]);
  });

  it("the same date twice is one date", () => {
    expect(read("last day 9/15 — yes, her last day was Sept 15").lastDayWorked).toBe(
      "2026-09-15",
    );
  });
});

describe("how the person left", () => {
  it("a notice given and worked", () => {
    const facts = read("She gave her two weeks and worked her full two weeks.");
    expect(facts.noticeOptions).toEqual([EXIT_OPTION.submittedFulfilledNotice]);
    expect(facts.typeOptions).toEqual([]);
  });

  it("quitting on the spot, walking out, or resigning effective immediately", () => {
    for (const text of [
      "He quit on the spot",
      "she walked out mid-shift",
      "resigned effective immediately",
      "she quit without notice",
    ]) {
      expect(read(text).typeOptions, text).toEqual([EXIT_OPTION.immediateVoluntary]);
    }
  });

  it("a notice that was not worked", () => {
    const facts = read("She gave notice but didn't finish her two weeks.");
    expect(facts.typeOptions).toEqual([EXIT_OPTION.noticeNotFulfilled]);
    expect(facts.noticeOptions).toEqual([]);
  });

  it("no call no show, however it is typed", () => {
    for (const text of ["No Call No Show Saturday", "she was a no-call/no-show", "NCNS twice"]) {
      expect(read(text).typeOptions, text).toContain(EXIT_OPTION.noCallNoShow);
    }
  });

  const INVOLUNTARY = EXIT_OPTION.immediateInvoluntary;
  const ticksInvoluntary = (text: string) => read(text).typeOptions.includes(INVOLUNTARY);

  it.each([
    "Jane was terminated today.",
    "We fired Jane yesterday.",
    "Jane was let go on Friday.",
    "Jane Smith was terminated today, create the termination paperwork.",
    "we let her go this morning",
    "We had to let Jane Smith go last week.",
    "He got fired yesterday for no call no shows.",
    "The DM terminated her on 9/20.",
    "She has been dismissed.",
    "JANE WAS TERMINATED TODAY",
  ])("a completed employer-initiated separation is ticked: %s", (text) => {
    expect(ticksInvoluntary(text), text).toBe(true);
  });

  it.each([
    "Should we terminate Jane?",
    "We may fire Jane.",
    "We might fire Jane next week.",
    "We're going to let her go.",
    "We are thinking about terminating Jane.",
    "Create termination paperwork for Jane.",
    "Termination form for Jane.",
    "pull up the termination/exit form",
    "What's the termination policy?",
    "Can someone be fired for three no call no shows?",
    "Was Jane fired?",
    "If we fired her, would she get her bonus?",
    "She might have been fired from her last job.",
    "She wasn't fired, she quit on the spot.",
    "We did not let her go.",
    "Employees who were terminated for cause cannot be rehired.",
    "Jane is being terminated tomorrow.",
  ])("intent, a question or the form's name is not the act: %s", (text) => {
    expect(ticksInvoluntary(text), text).toBe(false);
  });

  it("naming the form supplies no fact at all", () => {
    expect(exitFactsSupplied(read("pull up the termination/exit form"))).toBe(false);
  });

  it("a tenure is not a notice", () => {
    expect(read("she only worked 2 weeks before quitting").noticeOptions).toEqual([]);
  });

  it("contradictions are dropped and reported", () => {
    const worked = read("She worked out her notice. She didn't fulfill her notice.");
    expect(worked.noticeOptions).toEqual([]);
    expect(worked.typeOptions).toEqual([]);
    expect(worked.ambiguities.map((entry) => entry.kind)).toEqual(["separation_conflict"]);

    const firedAndQuit = read("He quit on the spot and we fired him");
    expect(firedAndQuit.typeOptions).toEqual([]);
    expect(firedAndQuit.ambiguities.map((entry) => entry.kind)).toEqual(["separation_conflict"]);
  });

  it("NCNS followed by a completed termination ticks both, and asks nothing", () => {
    const facts = read("Three no call no shows so we terminated her.");
    expect(facts.typeOptions).toEqual([EXIT_OPTION.immediateInvoluntary, EXIT_OPTION.noCallNoShow]);
    expect(facts.ambiguities).toEqual([]);
  });

  it("a resignation that was also a firing ticks neither and asks", () => {
    const facts = read("He quit on the spot and we fired him");
    expect(facts.typeOptions).toEqual([]);
    expect(facts.ambiguities).toEqual([
      {
        kind: "separation_conflict",
        described: ["Immediate Voluntary Resignation", "Immediate involuntary separation"],
      },
    ]);
  });
});

describe("the values the draft carries", () => {
  it("only what was established, keyed like the stored version", () => {
    const facts = read("She gave notice on 9/1, worked out her notice, last day 9/15.");
    expect(exitFactValues(facts)).toEqual({
      values: { notice_given_date: "2026-09-01", last_day_worked: "2026-09-15" },
      checked: { resignation_notice: [EXIT_OPTION.submittedFulfilledNotice] },
    });
  });

  it("nothing at all for a bare request", () => {
    expect(exitFactValues(read("create an STC exit for Sarah"))).toEqual({
      values: {},
      checked: {},
    });
  });
});

/*
 * ============================================================================
 * HR FEEDBACK, 30 SEP 2026 — THE COLENE EXIT FORM
 * ============================================================================
 *
 * HR's words: "Sunny did not check the box for submitted & fulfilled notice or
 * fill in the dates for notice given and fulfilled, which were provided." The
 * manager's turns below are the ones typed in Production. The date came first
 * and the handing-in after it ("On 9-15-26, she provided her resignation"), and
 * the notice was "gave and worked a two week notice" — no owner word.
 */
describe("HR feedback 30 Sep: the Colene exit form", () => {
  const PRODUCTION_TURNS = [
    "create an exit form. employee name is colene schildt. colene was a tanning consultant at manhattan location. on 9-15-26 colene provided her resignation to management and her last day worked was 9-28-26",
    "colene gave and worked 2 week notice. colene messaged management her resignation via woven. all salon items were returned and she is eligible for rehire",
  ].join("\n\n");
  const FEEDBACK_WORDING =
    "On 9-15-26, she provided her resignation to management, sending the message via Woven. She gave and worked a two week notice, and her last day worked was 9-28-26.";

  it.each([
    ["the Production turns", PRODUCTION_TURNS],
    ["the feedback's own wording", FEEDBACK_WORDING],
  ])("%s: notice given, Submitted & Fulfilled, last day worked", (_label, text) => {
    const facts = read(text);
    expect(facts.noticeGiven).toBe("2026-09-15");
    expect(facts.resignationDate).toBe("2026-09-15");
    expect(facts.lastDayWorked).toBe("2026-09-28");
    expect(facts.noticeOptions).toEqual([EXIT_OPTION.submittedFulfilledNotice]);
    expect(facts.typeOptions).toEqual([]);
    expect(facts.ambiguities).toEqual([]);
  });

  /*
   * UNCHANGED ON PURPOSE, pending HR: the notice-fulfilled date is never taken
   * from the last day worked, even when the notice was worked in full. Whether
   * it should be is HR's decision, not a parsing fix.
   */
  it("still leaves the notice-fulfilled date to the manager", () => {
    expect(read(FEEDBACK_WORDING).noticeFulfilled).toBeNull();
    expect(read(PRODUCTION_TURNS).noticeFulfilled).toBeNull();
  });

  it.each([
    "On 9-15-26, she provided her resignation to management.",
    "on 9/15 colene provided her resignation",
    "On 9/15 she gave her two weeks notice.",
    "She provided her resignation on 9/15.",
    "Colene provided her two week notice on 9-15-26.",
  ])("reads the notice date from %s", (text) => {
    expect(read(text).noticeGiven).toBe("2026-09-15");
  });

  it("the employer's act is not the employee's notice", () => {
    expect(read("On 9/1 we gave her notice that her hours were cut.").noticeGiven).toBeNull();
    expect(read("On 9/1 management sent her a schedule.").noticeGiven).toBeNull();
  });

  it.each([
    "She gave and worked a two week notice.",
    "She worked her two week notice.",
    "She gave and worked 2 week notice.",
    "He worked a 2 weeks notice.",
    "She gave and worked her two weeks.",
  ])("ticks Submitted & Fulfilled Notice for %s", (text) => {
    expect(read(text).noticeOptions).toEqual([EXIT_OPTION.submittedFulfilledNotice]);
  });

  it.each([
    "she only worked 2 weeks before quitting",
    "She didn't work a two week notice.",
    "She never worked her two week notice.",
  ])("does not tick it for %s", (text) => {
    expect(read(text).noticeOptions).toEqual([]);
  });
});
