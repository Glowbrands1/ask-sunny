import { describe, expect, it } from "vitest";

import { coachingDocument } from "./library";
import { draftableFields } from "./responsibility";
import {
  EXPECTATION_LABEL,
  GOING_FORWARD_LABEL,
  OBSERVED_LABEL,
  guardNarrative,
  guardNarrativeDraft,
  isSchedulingSentence,
  ungroundedSpecifics,
} from "./narrative-draft";

/**
 * ============================================================================
 * THE MANAGER SUPPLIES THE INCIDENT; ASK SUNNY SUPPLIES THE COACHING
 * ============================================================================
 *
 * The line these tests hold is FACTS versus GUIDANCE, not "did the manager say
 * it". An inferred expectation is the intended product behaviour and must
 * survive; an invented date, count, amount, consequence or policy citation must
 * not, whichever section it appears in.
 *
 * Several tests below come in PAIRS — the same sentence grounded and
 * ungrounded — because a guard that simply deleted numbers, or simply deleted
 * expectations, would pass one half and fail the other.
 */

/** "Sarah Test was late today." — a bare incident, no expectation anywhere. */
const BARE_INCIDENT = "Sarah Test was late today.";

/** A complete draft of the kind the model should now produce unprompted. */
const FULL_DRAFT = [
  OBSERVED_LABEL,
  "Sarah arrived late for her scheduled shift today.",
  "",
  EXPECTATION_LABEL,
  "Sarah is expected to arrive on time and be ready to work at the start of her scheduled shift.",
  "",
  GOING_FORWARD_LABEL,
  "Sarah should arrive before her scheduled start time so she is prepared when her shift begins, and communicate with her manager if she anticipates being late.",
].join("\n");

describe("TEST A — a bare incident still produces a complete narrative", () => {
  it("keeps an inferred Expectation the manager never stated", () => {
    /*
     * THE REGRESSION THIS FILE EXISTS FOR. An earlier guard required the
     * manager's own words to carry an expectation and dropped the section
     * otherwise, so "Sarah Test was late today." produced a one-line form.
     * Inferring the standard is the job.
     */
    const result = guardNarrative(FULL_DRAFT, BARE_INCIDENT);

    expect(result.text).toBe(FULL_DRAFT);
    expect(result.removed).toEqual([]);
    expect(result.text).toContain(EXPECTATION_LABEL);
    expect(result.text).toContain("expected to arrive on time");
  });

  it("keeps an inferred Going Forward section too", () => {
    const result = guardNarrative(FULL_DRAFT, BARE_INCIDENT);
    expect(result.text).toContain(GOING_FORWARD_LABEL);
    expect(result.text).toContain("before her scheduled start time");
  });

  it("has all three sections, in order", () => {
    const text = guardNarrative(FULL_DRAFT, BARE_INCIDENT).text;
    expect(text.indexOf(OBSERVED_LABEL)).toBeLessThan(text.indexOf(EXPECTATION_LABEL));
    expect(text.indexOf(EXPECTATION_LABEL)).toBeLessThan(text.indexOf(GOING_FORWARD_LABEL));
  });

  it("never asks the manager to supply the expectation", () => {
    // Nothing in the guard can produce a request for wording; the only outputs
    // are the draft, a shorter draft, or an empty field.
    const result = guardNarrative(FULL_DRAFT, BARE_INCIDENT);
    expect(result.text).not.toMatch(/what expectation/i);
    expect(result.text).not.toMatch(/please (?:provide|tell|write)/i);
  });
});

describe("TEST B — the manager's own specifics are preserved", () => {
  it("keeps twenty minutes when the manager said twenty minutes", () => {
    const source = "Sarah Test was 20 minutes late today.";
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived 20 minutes late for her scheduled shift today.",
      "",
      EXPECTATION_LABEL,
      "Sarah is expected to arrive on time and be ready to work when her shift begins.",
    ].join("\n");

    const result = guardNarrative(draft, source);
    expect(result.text).toContain("20 minutes late");
    expect(result.removed).toEqual([]);
  });

  it("removes a count of prior occurrences the manager did not give", () => {
    // The pair to the test above: this is grounding, not number-deletion.
    const draft = `${OBSERVED_LABEL}\nSarah arrived 20 minutes late today. This is her third occurrence this month.`;
    const result = guardNarrative(draft, "Sarah Test was 20 minutes late today.");

    expect(result.text).toContain("20 minutes late");
    expect(result.text).not.toMatch(/third occurrence/i);
  });

  it("keeps a count the manager did give", () => {
    const source = "Sarah was late today. This is her third occurrence this month.";
    const draft = `${OBSERVED_LABEL}\nSarah arrived late today. This is her third occurrence this month.`;
    expect(guardNarrative(draft, source).text).toContain("third occurrence");
  });
});

describe("TEST C — other issues get their own neutral expectation", () => {
  it("keeps a cleaning expectation inferred from a cleaning incident", () => {
    const source = "Sarah forgot to complete her assigned closing cleaning tasks.";
    const draft = [
      OBSERVED_LABEL,
      "Sarah did not complete her assigned closing cleaning tasks.",
      "",
      EXPECTATION_LABEL,
      "Assigned cleaning responsibilities are expected to be completed accurately and within the scheduled shift.",
      "",
      GOING_FORWARD_LABEL,
      "Sarah should complete assigned cleaning tasks before the end of the shift and confirm completion when appropriate.",
    ].join("\n");

    expect(guardNarrative(draft, source).text).toBe(draft);
  });

  it("keeps a client-engagement expectation inferred from that incident", () => {
    const source = "Sarah was not engaging clients during tours today.";
    const draft = [
      OBSERVED_LABEL,
      "Sarah did not consistently engage clients during interactions.",
      "",
      EXPECTATION_LABEL,
      "Employees are expected to actively engage clients, ask relevant questions and provide appropriate recommendations.",
    ].join("\n");

    expect(guardNarrative(draft, source).text).toBe(draft);
  });
});

describe("TEST D — no policy claim and no consequence is invented", () => {
  it("removes a sentence citing company policy the manager never mentioned", () => {
    const draft = [
      OBSERVED_LABEL,
      "Sarah arrived late today.",
      "",
      EXPECTATION_LABEL,
      "Sarah is expected to arrive on time. According to company policy, three late arrivals result in a written warning.",
    ].join("\n");

    const result = guardNarrative(draft, BARE_INCIDENT);
    expect(result.text).toContain("expected to arrive on time");
    expect(result.text).not.toMatch(/company policy/i);
    expect(result.text).not.toMatch(/written warning/i);
  });

  it("removes attendance points, handbooks and policy sections", () => {
    for (const claim of [
      "This incident adds two attendance points to her record.",
      "The employee handbook requires punctuality.",
      "Policy section 4.2 covers scheduled start times.",
      "HR will review her attendance record.",
    ]) {
      const result = guardNarrative(`${OBSERVED_LABEL}\nSarah was late. ${claim}`, BARE_INCIDENT);
      expect(result.text, claim).toBe(`${OBSERVED_LABEL}\nSarah was late.`);
    }
  });

  it("does NOT remove an expectation that merely mentions a policy in passing", () => {
    /*
     * GUARD ON THE GUARD. The rule is against CITING a written rule, not
     * against the word "policy" — an expectation to follow the attendance
     * policy is ordinary coaching and must survive, or the guard would delete
     * the guidance it is supposed to protect.
     */
    const draft = `${EXPECTATION_LABEL}\nSarah is expected to follow the salon's attendance policy and arrive on time.`;
    expect(guardNarrative(draft, BARE_INCIDENT).text).toBe(draft);
  });

  it("keeps a consequence the manager themselves stated", () => {
    const source = "Sarah was late. I told her the next one is a written warning.";
    const draft = `${OBSERVED_LABEL}\nSarah arrived late. The next occurrence is a written warning.`;
    expect(guardNarrative(draft, source).text).toContain("written warning");
  });
});

describe("TEST E — the assistant's own earlier words are not facts", () => {
  it("removes a consequence that came from the assistant, not the manager", () => {
    /*
     * The source handed to this guard is built from MANAGER turns only — see
     * `draft-notes.ts`. So an assistant turn saying "she should receive a
     * written warning" is not in it, and a draft that picked the phrase up from
     * its own history cannot ground it.
     */
    const managerOnly = "Sarah Test was late today.";
    const draft = `${OBSERVED_LABEL}\nSarah arrived late today. She should receive a written warning.`;

    const result = guardNarrative(draft, managerOnly);
    expect(result.text).toBe(`${OBSERVED_LABEL}\nSarah arrived late today.`);
    expect(result.text).not.toMatch(/written warning/i);
  });
});

describe("TEST F — follow-up never appears in the narrative", () => {
  it("removes a check-in sentence from Going Forward", () => {
    const draft = [
      GOING_FORWARD_LABEL,
      "Sarah should arrive before her scheduled start time. I will check in with Sarah next week to review her attendance.",
    ].join("\n");

    const result = guardNarrative(draft, BARE_INCIDENT);
    expect(result.text).toContain("before her scheduled start time");
    expect(result.text).not.toMatch(/check in/i);
    expect(result.text).not.toMatch(/next week/i);
  });

  it("removes follow-up talk even when the manager mentioned it themselves", () => {
    // The one guard that does not defer to the manager: follow-up is instance
    // metadata with its own control, and two authorities for one date disagree.
    const source = "Sarah was late. I will follow up with her in two weeks.";
    const draft = `${GOING_FORWARD_LABEL}\nSarah should arrive on time. We will follow up in two weeks.`;

    const result = guardNarrative(draft, source);
    expect(result.text).not.toMatch(/follow up/i);
    expect(result.text).not.toMatch(/two weeks/i);
  });

  it("removes a placeholder-free follow-up sentence carrying a real date", () => {
    const draft = `${OBSERVED_LABEL}\nSarah was late. I will check in with Sarah on 2026-09-15.`;
    expect(guardNarrative(draft, BARE_INCIDENT).text).toBe(`${OBSERVED_LABEL}\nSarah was late.`);
  });

  it("keeps the observation, whose wording brushes against scheduling", () => {
    // "scheduled shift" is the observation itself. A keyword guard on the word
    // "schedule" would delete the one sentence that must always survive.
    expect(isSchedulingSentence("Sarah arrived late for her scheduled shift today.")).toBe(false);
    expect(
      isSchedulingSentence("Sarah should arrive on time for her next shift."),
    ).toBe(false);
    expect(isSchedulingSentence("I will check in with Sarah next week.")).toBe(true);
  });
});

describe("the guard reports what it removed, and touches nothing else", () => {
  it("names the fragments it could not ground", () => {
    expect(ungroundedSpecifics("This is her third tardy.", BARE_INCIDENT)).toEqual(["third tardy"]);
    expect(ungroundedSpecifics("She was late.", BARE_INCIDENT)).toEqual([]);
  });

  it("runs only on fields the version marks", () => {
    const fields = [
      { key: "coaching_details", narrative: "observed_expectation" },
      { key: "other_topic" },
    ];
    const other = "This is her third occurrence and I will follow up next Monday.";

    const result = guardNarrativeDraft(
      {
        coaching_details: `${OBSERVED_LABEL}\nSarah was late. This is her third occurrence.`,
        other_topic: other,
      },
      fields,
      BARE_INCIDENT,
    );

    expect(result.values.coaching_details).not.toMatch(/third occurrence/i);
    expect(result.values.other_topic).toBe(other);
    expect(result.adjusted).toEqual(["coaching_details"]);
  });

  it("changes nothing at all when no field asks for the shape", () => {
    const values = { warning_details: "This is her third occurrence and I will follow up Monday." };
    const result = guardNarrativeDraft(values, [{ key: "warning_details" }], "anything");
    expect(result.values).toEqual(values);
    expect(result.adjusted).toEqual([]);
  });

  it("leaves a complete draft untouched, byte for byte", () => {
    const result = guardNarrativeDraft(
      { coaching_details: FULL_DRAFT },
      [{ key: "coaching_details", narrative: "observed_expectation" }],
      BARE_INCIDENT,
    );
    expect(result.values.coaching_details).toBe(FULL_DRAFT);
    expect(result.adjusted).toEqual([]);
    expect(result.emptied).toEqual([]);
  });

  it("never leaves a bare label behind", () => {
    const result = guardNarrative(
      [OBSERVED_LABEL, "Sarah arrived late.", "", GOING_FORWARD_LABEL, "I will follow up."].join("\n"),
      BARE_INCIDENT,
    );
    expect(result.text).not.toContain(GOING_FORWARD_LABEL);
    expect(result.text.trim().endsWith("late.")).toBe(true);
  });
});

describe("the published Coaching Form asks for the shape", () => {
  it("marks coaching_details, and only coaching_details", () => {
    const marked = draftableFields(coachingDocument(), null).filter((field) => field.narrative);
    expect(marked.map((field) => field.key)).toEqual(["coaching_details"]);
  });

  it("still has one Details field, and no Expectation or Going Forward field", () => {
    // The sections live INSIDE the one field. This is content behaviour, not
    // template structure, and a second field here would be the wrong fix.
    const keys = draftableFields(coachingDocument(), null).map((field) => field.key);
    expect(keys.filter((key) => key === "coaching_details")).toHaveLength(1);
    expect(keys.some((key) => /expectation|going_forward/i.test(key))).toBe(false);
  });
});
