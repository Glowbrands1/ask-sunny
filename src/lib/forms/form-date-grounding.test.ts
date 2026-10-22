import { describe, expect, it } from "vitest";

import {
  correctDraftedDates,
  formDateBrief,
  groundedSourceWithFormDate,
  resolveFormDate,
} from "./form-date-grounding";
import { guardNarrativeDraft, ungroundedSpecifics } from "./narrative-draft";

/**
 * ============================================================================
 * THE OBSERVATION MUST NOT GO BLANK BECAUSE THE MODEL MIS-TYPED A DATE
 * ============================================================================
 *
 * QA's finding: the manager answered the intake's third question with "today",
 * the model wrote "On September 10, 2026, …", and the narrative guard —
 * correctly, for the rule it enforces — removed the whole sentence as carrying
 * an ungrounded specific. The Corrective Action Form came back with no
 * Observation of Offense at all.
 *
 * The last block below is the one that matters: the two modules run TOGETHER,
 * because each is right on its own and the defect only existed between them.
 */

const FORM_DATE = "2026-09-10";
const NOTES = [
  "1. Sarah Test",
  "2. Kearny",
  "3.today",
  "4.she was wearing mini skirt today",
  "5. verbal warning",
  "6.this is the first time",
].join("\n");

const OBSERVATION = [{ key: "observation", narrative: "observed_expectation" }];
const NARRATIVE_KEYS = new Set(["observation"]);

describe("1. resolving the form's own date", () => {
  it("reads the stored date without a timezone shifting it", () => {
    const resolved = resolveFormDate(FORM_DATE)!;

    expect(resolved.iso).toBe("2026-09-10");
    expect(resolved.long).toBe("September 10, 2026");
    expect(resolved.weekday).toBe("Thursday");
  });

  /*
   * `new Date("2026-09-10")` is UTC midnight, so a naive `.getDate()` names
   * the 9th for anybody west of Greenwich. A form dated the 10th must not
   * print as the 9th because of where the server is.
   */
  it("names the same day whatever the server's timezone is", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      expect(resolveFormDate(FORM_DATE)!.long).toBe("September 10, 2026");
      process.env.TZ = "Pacific/Kiritimati";
      expect(resolveFormDate(FORM_DATE)!.long).toBe("September 10, 2026");
    } finally {
      process.env.TZ = original;
    }
  });

  it("refuses anything that is not a stored date", () => {
    for (const bad of ["", "today", "10/09/2026", "2026-13-01"]) {
      expect(resolveFormDate(bad), bad).toBeNull();
    }
  });

  it("tells the model the date, and forbids any other", () => {
    const brief = formDateBrief(resolveFormDate(FORM_DATE)!);

    expect(brief).toContain("September 10, 2026");
    expect(brief).toContain("Thursday");
    expect(brief).toMatch(/use exactly "September 10, 2026" and no other date/);
  });
});

describe("2. the resolved date counts as something the manager supplied", () => {
  it("adds every spelling to the grounding source", () => {
    const source = groundedSourceWithFormDate(NOTES, resolveFormDate(FORM_DATE));

    // The manager's own words survive untouched.
    expect(source).toContain("she was wearing mini skirt today");
    // And the resolved date is now supplied too, in the shapes a model writes.
    for (const spelling of ["2026-09-10", "September 10, 2026", "September 10", "9/10/2026"]) {
      expect(source, spelling).toContain(spelling);
    }
  });

  it("changes nothing when the form has no usable date", () => {
    expect(groundedSourceWithFormDate(NOTES, null)).toBe(NOTES);
  });
});

describe("3. a date the manager never gave is corrected, not carried", () => {
  const resolved = resolveFormDate(FORM_DATE);

  it("rewrites the model's invented date to the form's own", () => {
    const result = correctDraftedDates(
      {
        observation:
          "Observed: On September 8, 2026, Sarah Test was observed wearing a mini skirt.",
      },
      NARRATIVE_KEYS,
      NOTES,
      resolved,
    );

    expect(result.values.observation).toBe(
      "Observed: On September 10, 2026, Sarah Test was observed wearing a mini skirt.",
    );
    expect(result.corrected).toEqual(["observation"]);
  });

  it("leaves a date the manager actually wrote exactly as they wrote it", () => {
    const notes = "She was late on 9/8 and left early the next day.";
    const values = { observation: "Observed: Sarah arrived late on 9/8." };

    const result = correctDraftedDates(values, NARRATIVE_KEYS, notes, resolved);

    expect(result.values.observation).toBe(values.observation);
    expect(result.corrected).toEqual([]);
  });

  it("leaves a sentence naming two invented dates for the narrative guard", () => {
    // Not a formatting slip — an account of events nobody described. Rewriting
    // both to the same day would produce nonsense.
    const values = {
      observation: "Observed: Sarah was late on September 2, 2026 and again on September 4, 2026.",
    };

    const result = correctDraftedDates(values, NARRATIVE_KEYS, NOTES, resolved);

    expect(result.values.observation).toBe(values.observation);
    expect(result.corrected).toEqual([]);
  });

  it("touches no field outside the narrative set", () => {
    const values = { action_plan: "Reviewed with her on September 8, 2026." };

    const result = correctDraftedDates(values, NARRATIVE_KEYS, NOTES, resolved);

    expect(result.values.action_plan).toBe(values.action_plan);
    expect(result.corrected).toEqual([]);
  });

  it("preserves the labelled-section shape", () => {
    const values = {
      observation: [
        "Observed:",
        "On September 8, 2026, Sarah wore a mini skirt.",
        "",
        "Expectation:",
        "Sarah meets the salon's appearance standards.",
      ].join("\n"),
    };

    const result = correctDraftedDates(values, NARRATIVE_KEYS, NOTES, resolved);

    expect(result.values.observation).toContain("On September 10, 2026, Sarah wore a mini skirt.");
    expect(result.values.observation.split("\n")).toHaveLength(5);
    expect(result.values.observation).toContain("Expectation:");
  });

  it("does nothing at all when the form has no usable date", () => {
    const values = { observation: "Observed: On September 8, 2026, Sarah wore a mini skirt." };

    expect(correctDraftedDates(values, NARRATIVE_KEYS, NOTES, null)).toEqual({
      values,
      corrected: [],
    });
  });
});

/* ==================================================================== */
/*  THE TWO GUARDS TOGETHER — WHERE THE DEFECT ACTUALLY LIVED           */
/* ==================================================================== */

describe("4. the observation survives, whatever date the model writes", () => {
  const resolved = resolveFormDate(FORM_DATE);
  const source = groundedSourceWithFormDate(NOTES, resolved);

  /** The route's order: correct the date, then run the narrative guard. */
  function chain(observation: string) {
    const dated = correctDraftedDates({ observation }, NARRATIVE_KEYS, NOTES, resolved);
    return guardNarrativeDraft(dated.values, OBSERVATION, source);
  }

  it("keeps a correctly-dated observation, which used to be enough to lose it", () => {
    const result = chain(
      [
        "Observed:",
        "On September 10, 2026, Sarah Test was observed wearing a mini skirt at the Kearny salon.",
        "",
        "Expectation:",
        "Sarah meets the salon's appearance standards for every scheduled shift.",
      ].join("\n"),
    );

    expect(result.values.observation).toContain("wearing a mini skirt at the Kearny salon");
    expect(result.values.observation).toContain("September 10, 2026");
    expect(result.emptied).toEqual([]);
  });

  /*
   * THE EXACT QA REPLAY. Before this work the whole Observed sentence was
   * deleted and the form carried no observation at all.
   */
  it("recovers rather than blanking when the model invents a date", () => {
    const result = chain(
      [
        "Observed:",
        "On September 8, 2026, Sarah Test was observed wearing a mini skirt at the Kearny salon.",
        "",
        "Expectation:",
        "Sarah meets the salon's appearance standards for every scheduled shift.",
      ].join("\n"),
    );

    // The fact survives, and the invented date never reaches the record.
    expect(result.values.observation).toContain("wearing a mini skirt at the Kearny salon");
    expect(result.values.observation).toContain("September 10, 2026");
    expect(result.values.observation).not.toContain("September 8");
    expect(result.emptied).toEqual([]);
  });

  it("still rejects an ungrounded specific that is not a date", () => {
    // The date fix must not become a way for anything else to get through.
    const result = chain(
      ["Observed:", "This was Sarah's third occurrence this month."].join("\n"),
    );

    expect(result.values.observation ?? "").not.toContain("third occurrence");
  });
});

/*
 * District Manager feedback, 21 Oct 2026: a date the manager gave in one
 * spelling — "by the 10-15-26 deadline" — drafted in the form's own ("October
 * 15, 2026") was taken for an invented one and rewritten to the form's date,
 * and the model was told the form's date was the only one to use.
 */
describe("a date the manager gave is never replaced by the form's", () => {
  const formDate = resolveFormDate("2026-10-21")!;
  const keys = new Set(["observation"]);

  it("keeps the manager's dates in the form's own spelling", () => {
    const notes =
      "create corrective action for tess varga for violating standards of conduct policy on 10-20-26. tess failed to acknowledge policies in woven by the 10-15-26 deadline.";
    const drafted = {
      observation:
        "Observed:\nOn October 20, 2026, Tess Varga did not acknowledge the policies in Woven by the October 15, 2026 deadline.",
    };
    const corrected = correctDraftedDates(drafted, keys, notes, formDate);
    expect(corrected.values.observation).toBe(drafted.observation);
    expect(corrected.corrected).toEqual([]);
    expect(ungroundedSpecifics(drafted.observation, groundedSourceWithFormDate(notes, formDate))).toEqual([]);
  });

  it("keeps a deadline on a form dated by the incident", () => {
    const incident = resolveFormDate("2026-10-20")!;
    const notes =
      "create corrective action for tess varga for violating standards of conduct policy on 10-20-26. tess failed to acknowledge policies in woven by the 10-15-26 deadline.";
    const drafted = {
      observation: "Observed:\nTess Varga had not acknowledged the policies in Woven by the October 15, 2026 deadline.",
    };
    expect(correctDraftedDates(drafted, keys, notes, incident).values.observation).toBe(drafted.observation);
  });

  it("still replaces a date nobody gave", () => {
    const corrected = correctDraftedDates(
      { observation: "Observed:\nOn September 30, 2026, Tess was late." },
      keys,
      "tess was late today",
      formDate,
    );
    expect(corrected.values.observation).toBe("Observed:\nOn October 21, 2026, Tess was late.");
  });

  it("tells the model the form's date is not the incident's when the manager gave another", () => {
    const brief = formDateBrief(formDate, ["2026-10-20", "2026-10-15"]);
    expect(brief).toContain('"October 20, 2026", "October 15, 2026"');
    expect(brief).toMatch(/not necessarily the date of the incident/);
    expect(brief).toMatch(/Never write the form date in place of a date the manager gave/);
    expect(brief).not.toMatch(/This is the date of the incident/);
  });

  it("keeps the old line where the form's date is the only date given, or none was", () => {
    expect(formDateBrief(formDate, ["2026-10-21"])).toMatch(/This is the date of the incident and of this form/);
    expect(formDateBrief(formDate)).toMatch(/This is the date of the incident and of this form/);
  });
});

/*
 * QA audit, 22 Oct 2026, replaying what the drafting model wrote on the
 * production forms of 21 Oct (names replaced).
 */
describe("the form's date is only the manager's when they gave it", () => {
  const keys = new Set(["observation"]);
  const DEADLINE_NOTES =
    "create corrective action for sela brandt for violating standards of conduct policy on 10-20-26. sela failed to acknowledge policies in woven by the 10-15-26 deadline.";

  it("a form dated the day it is created does not make that day the deadline: it is the 10-15 the manager gave", () => {
    const corrected = correctDraftedDates(
      { observation: "Observed:\nSela did not acknowledge the required policies in Woven by the October 21, 2026 deadline." },
      keys,
      DEADLINE_NOTES,
      resolveFormDate("2026-10-21"),
    );
    expect(corrected.values.observation).toBe(
      "Observed:\nSela did not acknowledge the required policies in Woven by the October 15, 2026 deadline.",
    );
    expect(corrected.corrected).toEqual(["observation"]);
  });

  it("and a date the model put on the incident is the incident's, by the words around it", () => {
    const corrected = correctDraftedDates(
      { observation: "Observed:\nOn October 21, 2026, Sela violated the standards of conduct policy." },
      keys,
      DEADLINE_NOTES,
      resolveFormDate("2026-10-21"),
    );
    expect(corrected.values.observation).toBe(
      "Observed:\nOn October 20, 2026, Sela violated the standards of conduct policy.",
    );
  });

  it('"today" makes the day the form is created the manager\'s date', () => {
    const drafted = { observation: "Observed:\nOn October 21, 2026, Sela arrived 20 minutes late." };
    const corrected = correctDraftedDates(drafted, keys, "sela was 20 minutes late today", resolveFormDate("2026-10-21"));
    expect(corrected.values.observation).toBe(drafted.observation);
    expect(corrected.corrected).toEqual([]);
  });

  it("with no date given at all, the form's date stands, as before", () => {
    const drafted = { observation: "Observed:\nOn October 21, 2026, Sela arrived 20 minutes late." };
    const corrected = correctDraftedDates(drafted, keys, "sela was 20 minutes late", resolveFormDate("2026-10-21"));
    expect(corrected.values.observation).toBe(drafted.observation);
  });
});

describe("one invented date, written twice, is one slip, and the date is stated once", () => {
  const keys = new Set(["observation"]);
  const NOTES_5 =
    "create ca form for marlo quist for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching";

  it("the production observation keeps its sentence, dated 20 Oct, with the date once", () => {
    const corrected = correctDraftedDates(
      {
        observation:
          "Observed:\nOn October 21, 2026, Marlo was reported as having violated the attendance policy on October 21, 2026.\n\nExpectation:\nMarlo is expected to arrive on time.",
      },
      keys,
      NOTES_5,
      resolveFormDate("2026-10-20"),
    );
    expect(corrected.values.observation).toBe(
      "Observed:\nOn October 20, 2026, Marlo was reported as having violated the attendance policy.\n\nExpectation:\nMarlo is expected to arrive on time.",
    );
  });

  it("the manager's own date, written twice in a sentence, is written once", () => {
    const corrected = correctDraftedDates(
      { observation: "Observed:\nOn October 20, 2026, Marlo did not follow the attendance policy on October 20, 2026." },
      keys,
      NOTES_5,
      resolveFormDate("2026-10-20"),
    );
    expect(corrected.values.observation).toBe("Observed:\nOn October 20, 2026, Marlo did not follow the attendance policy.");
  });

  it("two DIFFERENT invented dates are still left for the narrative guard", () => {
    const drafted = { observation: "Observed: Marlo was late on September 2, 2026 and again on September 4, 2026." };
    const corrected = correctDraftedDates(drafted, keys, "marlo keeps being late", resolveFormDate("2026-10-20"));
    expect(corrected.values.observation).toBe(drafted.observation);
  });

  it("two different dates the manager gave are both kept", () => {
    const drafted = { observation: "Observed:\nOn October 20, 2026, Sela had not acknowledged the policies due October 15, 2026." };
    const corrected = correctDraftedDates(
      drafted,
      keys,
      "on 10-20-26 sela had not acknowledged the policies due 10-15-26",
      resolveFormDate("2026-10-21"),
    );
    expect(corrected.values.observation).toBe(drafted.observation);
  });
});

/* Review, 22 Oct 2026: a day stated twice is trimmed only where nothing is left hanging. */
describe("a day stated twice is trimmed only as a trailing \"on <day>\"", () => {
  const keys = new Set(["observation"]);
  it.each([
    "Observed:\nOn October 20, 2026, she was told to finish the training by October 20, 2026.",
    "Observed:\nThe schedule from October 20, 2026 to October 20, 2026 was posted.",
  ])("leaves %j as written", (observation) => {
    const corrected = correctDraftedDates({ observation }, keys, "on 10-20-26 she missed the training", resolveFormDate("2026-10-20"));
    expect(corrected.values.observation).toBe(observation);
  });
});

/* Review, 22 Oct 2026: an earlier step's date is never put on the incident. */
describe("an earlier step's date never stands in for the incident's", () => {
  const keys = new Set(["observation"]);
  it("a prior verbal warning dated 10-01-26 leaves the form's date on what happened", () => {
    const drafted = { observation: "Observed:\nOn October 22, 2026, Maria arrived late." };
    const corrected = correctDraftedDates(
      drafted,
      keys,
      "Maria arrived late again. She got a verbal warning on 10-01-26 for arriving late.",
      resolveFormDate("2026-10-22"),
    );
    expect(corrected.values.observation).toBe(drafted.observation);
  });
});
