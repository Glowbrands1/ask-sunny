import { describe, expect, it } from "vitest";

import { coachingDocument } from "./library";
import { draftableFields } from "./responsibility";
import {
  EXPECTATION_LABEL,
  NEXT_STEP_LABEL,
  OBSERVED_LABEL,
  guardNarrative,
  guardNarrativeDraft,
  hasExpectationCue,
  isSchedulingSentence,
  ungroundedSpecifics,
} from "./narrative-draft";

/**
 * WHAT THE COACHING NARRATIVE IS ALLOWED TO SAY.
 *
 * Every fixture here is written the way the model actually failed: a draft that
 * reads well, is the right shape, and quietly asserts something nobody said.
 * The assertions are about GROUNDING rather than wording — the same sentence is
 * kept or removed depending only on whether the manager supplied the fact in
 * it, and several tests below check both halves of that pair so a guard that
 * simply deleted numbers could not pass.
 */

const SOURCE_WITH_EXPECTATION =
  "Sarah was late for her shift this morning. I told her I expect her to arrive on time for every scheduled shift.";

const SOURCE_WITHOUT_EXPECTATION = "Sarah arrived late for her scheduled shift today.";

describe("1. the drafted narrative keeps its two labelled sections", () => {
  it("passes a well-formed Observed/Expectation draft through untouched", () => {
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived late for her scheduled shift today.",
      "",
      EXPECTATION_LABEL,
      "Sarah is expected to arrive on time for every scheduled shift.",
    ].join("\n");

    const result = guardNarrative(draft, SOURCE_WITH_EXPECTATION);
    expect(result.text).toBe(draft);
    expect(result.removed).toEqual([]);
  });

  it("keeps an optional Next step section the manager described", () => {
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived late.",
      "",
      EXPECTATION_LABEL,
      "Sarah is expected to arrive on time.",
      "",
      NEXT_STEP_LABEL,
      "Sarah will set an alarm and text the salon if traffic delays her.",
    ].join("\n");

    const result = guardNarrative(draft, SOURCE_WITH_EXPECTATION);
    expect(result.text).toContain(NEXT_STEP_LABEL);
    expect(result.text).toContain("set an alarm");
  });
});

describe("2. a manager's specific expectation survives as they said it", () => {
  it("does not flatten ten minutes before opening into a general standard", () => {
    const source =
      "Sarah was late again today. I told her I expect her to arrive ten minutes before opening so the salon is ready for the first client.";
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived after her scheduled start time.",
      "",
      EXPECTATION_LABEL,
      "Sarah is expected to arrive ten minutes before opening so the salon is ready for the first client.",
    ].join("\n");

    const result = guardNarrative(draft, source);
    expect(result.text).toContain("ten minutes before opening");
    expect(result.removed).toEqual([]);
  });
});

describe("3. an expectation nobody communicated is not invented", () => {
  it("drops the whole Expectation section when the manager gave none", () => {
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived late for her scheduled shift today.",
      "",
      EXPECTATION_LABEL,
      "Sarah is expected to arrive on time for every scheduled shift.",
    ].join("\n");

    const result = guardNarrative(draft, SOURCE_WITHOUT_EXPECTATION);

    expect(result.text).toBe(`${OBSERVED_LABEL}\nSarah arrived late for her scheduled shift today.`);
    expect(result.text).not.toContain(EXPECTATION_LABEL);
    expect(result.removed).toContain(EXPECTATION_LABEL);
  });

  it("leaves the observation alone rather than emptying the field", () => {
    const result = guardNarrative(
      `${OBSERVED_LABEL}\nSarah arrived late for her scheduled shift today.`,
      SOURCE_WITHOUT_EXPECTATION,
    );
    expect(result.text).toContain("arrived late");
  });

  it("recognises an expectation however the manager phrased it", () => {
    // GUARD ON THE GUARD: a cue list narrow enough to reject these would delete
    // legitimate sections, which is the more damaging failure of the two.
    for (const source of [
      "I told her she needs to be on the floor by nine.",
      "We discussed that greeting every guest is the standard.",
      "I reminded him going forward the room has to be wiped between clients.",
      "I asked her to make sure the new client documents are completed.",
      "Explained that she should offer a tour to every walk-in.",
    ]) {
      expect(hasExpectationCue(source)).toBe(true);
    }

    for (const source of [
      "Sarah arrived late for her scheduled shift today.",
      "The room was not cleaned between clients.",
      "He left twenty minutes before the end of his shift.",
    ]) {
      expect(hasExpectationCue(source)).toBe(false);
    }
  });
});

describe("4. follow-up never appears in the narrative", () => {
  it("removes a check-in sentence even when it names no date", () => {
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived late.",
      "",
      EXPECTATION_LABEL,
      "Sarah is expected to arrive on time. I will check in with Sarah to review her attendance.",
    ].join("\n");

    const result = guardNarrative(draft, SOURCE_WITH_EXPECTATION);
    expect(result.text).toContain("expected to arrive on time");
    expect(result.text).not.toMatch(/check in/i);
  });

  it("removes follow-up talk even when the manager mentioned it themselves", () => {
    /*
     * The one guard that does NOT defer to the manager's words. The follow-up
     * date is instance metadata with its own control; a sentence about it in
     * Details duplicates one fact across two authorities, and they disagree the
     * moment the manager moves the date.
     */
    const source = "Sarah was late. I told her I expect her on time, and I will follow up next week.";
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived late.",
      "",
      EXPECTATION_LABEL,
      "Sarah is expected to arrive on time. We will follow up next week.",
    ].join("\n");

    const result = guardNarrative(draft, source);
    expect(result.text).not.toMatch(/follow up/i);
    expect(result.text).not.toMatch(/next week/i);
  });

  it("keeps the observation, whose wording brushes against scheduling", () => {
    // "scheduled shift" is the observation itself. A keyword guard on the word
    // "schedule" would delete the one sentence that must always survive.
    const result = guardNarrative(
      `${OBSERVED_LABEL}\nSarah arrived late for her scheduled shift today.`,
      SOURCE_WITHOUT_EXPECTATION,
    );
    expect(result.text).toContain("scheduled shift");
    expect(isSchedulingSentence("Sarah arrived late for her scheduled shift today.")).toBe(false);
  });
});

describe("5. specifics the manager never supplied are removed", () => {
  it("removes an invented count of prior occurrences", () => {
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived late today. This is her third occurrence this month.",
    ].join("\n");

    const result = guardNarrative(draft, SOURCE_WITHOUT_EXPECTATION);
    expect(result.text).toContain("arrived late today");
    expect(result.text).not.toMatch(/third occurrence/i);
  });

  it("KEEPS the same count when the manager gave it", () => {
    // The pair that proves this is grounding and not number-deletion.
    const source = "Sarah arrived late today. This is her third occurrence this month.";
    const draft = `${OBSERVED_LABEL}\nSarah arrived late today. This is her third occurrence this month.`;

    const result = guardNarrative(draft, source);
    expect(result.text).toContain("third occurrence");
    expect(result.removed).toEqual([]);
  });

  it("removes an invented consequence, and keeps one the manager stated", () => {
    const invented = guardNarrative(
      `${OBSERVED_LABEL}\nSarah arrived late. Continued lateness will result in a written warning.`,
      SOURCE_WITHOUT_EXPECTATION,
    );
    expect(invented.text).not.toMatch(/written warning/i);

    const stated = guardNarrative(
      `${OBSERVED_LABEL}\nSarah arrived late. Continued lateness will result in a written warning.`,
      "Sarah was late. I told her continued lateness will result in a written warning.",
    );
    expect(stated.text).toContain("written warning");
  });

  it("removes an invented date and an invented amount", () => {
    const result = guardNarrative(
      [
        OBSERVED_LABEL,
        "Sarah arrived late. She missed the Monday opening. The salon lost $250 in walk-in revenue.",
      ].join("\n"),
      SOURCE_WITHOUT_EXPECTATION,
    );
    expect(result.text).toContain("arrived late");
    expect(result.text).not.toMatch(/Monday/);
    expect(result.text).not.toMatch(/\$250/);
  });

  it("keeps an ordinary number the manager supplied", () => {
    const source = "Sarah clocked in twenty minutes after her shift started.";
    const result = guardNarrative(
      `${OBSERVED_LABEL}\nSarah clocked in twenty minutes after her shift started.`,
      source,
    );
    expect(result.text).toContain("twenty minutes");
  });

  it("names the fragments it could not ground", () => {
    expect(ungroundedSpecifics("This is her third tardy.", SOURCE_WITHOUT_EXPECTATION)).toEqual([
      "third tardy",
    ]);
    expect(ungroundedSpecifics("She was late.", SOURCE_WITHOUT_EXPECTATION)).toEqual([]);
  });
});

describe("6. a draft that survives nothing leaves the field empty", () => {
  it("empties rather than leaving a heading with nothing under it", () => {
    const result = guardNarrative(
      `${OBSERVED_LABEL}\nI will follow up with Sarah next week.`,
      SOURCE_WITHOUT_EXPECTATION,
    );
    expect(result.text).toBe("");
  });

  it("never leaves a bare label behind", () => {
    const result = guardNarrative(
      [OBSERVED_LABEL, "Sarah arrived late.", "", EXPECTATION_LABEL, ""].join("\n"),
      SOURCE_WITH_EXPECTATION,
    );
    expect(result.text).not.toContain(EXPECTATION_LABEL);
    expect(result.text.trim().endsWith("late.")).toBe(true);
  });
});

describe("7. the guard runs only on fields the version marks", () => {
  const fields = [
    { key: "coaching_details", narrative: "observed_expectation" },
    { key: "other_topic" },
  ];

  it("touches the narrative field and leaves the others byte for byte", () => {
    const other = "This is her third occurrence and I will follow up next Monday.";
    const result = guardNarrativeDraft(
      {
        coaching_details: `${OBSERVED_LABEL}\nSarah was late. This is her third occurrence.`,
        other_topic: other,
      },
      fields,
      SOURCE_WITHOUT_EXPECTATION,
    );

    expect(result.values.coaching_details).not.toMatch(/third occurrence/i);
    // Untouched: nothing about this guard may change a field that did not ask.
    expect(result.values.other_topic).toBe(other);
    expect(result.adjusted).toEqual(["coaching_details"]);
    expect(result.emptied).toEqual([]);
  });

  it("reports a field it emptied", () => {
    const result = guardNarrativeDraft(
      { coaching_details: `${OBSERVED_LABEL}\nI will check in with Sarah next week.` },
      fields,
      SOURCE_WITHOUT_EXPECTATION,
    );
    expect(result.emptied).toEqual(["coaching_details"]);
    expect(result.values.coaching_details).toBeUndefined();
  });

  it("changes nothing at all when no field asks for the shape", () => {
    const values = {
      warning_details: "This is her third occurrence and I will follow up on Monday.",
    };
    const result = guardNarrativeDraft(values, [{ key: "warning_details" }], "anything");
    expect(result.values).toEqual(values);
    expect(result.adjusted).toEqual([]);
  });
});

describe("8. the published Coaching Form asks for the shape", () => {
  it("marks coaching_details, and only coaching_details", () => {
    const document = coachingDocument();
    const marked = draftableFields(document, null).filter((field) => field.narrative);

    expect(marked.map((field) => field.key)).toEqual(["coaching_details"]);
    expect(marked[0].narrative).toBe("observed_expectation");
  });

  it("still has exactly one Details field, and no Expectation field", () => {
    // The sections live INSIDE the one field. Brief A is content behaviour, not
    // template structure, and a second field here would be the wrong fix.
    const keys = draftableFields(coachingDocument(), null).map((field) => field.key);
    expect(keys.filter((key) => key === "coaching_details")).toHaveLength(1);
    expect(keys.some((key) => /expectation/i.test(key))).toBe(false);
  });
});

describe("9. the placeholder failure cannot come back through this door", () => {
  it("removes a follow-up sentence that carries no bracket at all", () => {
    /*
     * The original defect was "[Follow-Up Date]", and `drafted-text.ts` catches
     * the brackets. This is the same sentence with a real-looking date in it,
     * which that guard would happily store.
     */
    const draft = `${OBSERVED_LABEL}\nSarah was late. I will check in with Sarah on 2026-09-15 to review her attendance.`;
    const result = guardNarrative(draft, SOURCE_WITHOUT_EXPECTATION);

    expect(result.text).toBe(`${OBSERVED_LABEL}\nSarah was late.`);
    expect(result.text).not.toMatch(/2026-09-15/);
    expect(result.text).not.toMatch(/check in/i);
  });
});
