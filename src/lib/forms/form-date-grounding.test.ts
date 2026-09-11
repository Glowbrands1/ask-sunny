import { describe, expect, it } from "vitest";

import {
  correctDraftedDates,
  formDateBrief,
  groundedSourceWithFormDate,
  resolveFormDate,
} from "./form-date-grounding";
import { guardNarrativeDraft } from "./narrative-draft";

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
