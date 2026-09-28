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

  it("a firing is reported and never ticked", () => {
    const facts = read("We terminated him yesterday after the investigation.");
    expect(facts.involuntaryDescribed).toBe(true);
    expect(facts.typeOptions).not.toContain(EXIT_OPTION.immediateInvoluntary);
    expect(exitFactValues(facts).checked).toEqual({});
    expect(read("she was let go").involuntaryDescribed).toBe(true);
  });

  it("a negated firing is not one", () => {
    expect(read("she wasn't fired, she quit on the spot").involuntaryDescribed).toBe(false);
  });

  it("naming the form is not describing a termination", () => {
    expect(read("pull up the termination/exit form").involuntaryDescribed).toBe(false);
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

  it("NCNS followed by a termination keeps the NCNS tick and reports the rest", () => {
    const facts = read("Three no call no shows so we terminated her.");
    expect(facts.typeOptions).toEqual([EXIT_OPTION.noCallNoShow]);
    expect(facts.involuntaryDescribed).toBe(true);
    expect(facts.ambiguities).toEqual([]);
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
