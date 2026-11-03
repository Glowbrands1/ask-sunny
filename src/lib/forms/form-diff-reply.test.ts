import { describe, expect, it } from "vitest";

import { NOTHING_CHANGED, REPLY_VALUE_MAX, replyFromDiff } from "./form-diff-reply";

/** Step B (FORM_REPLY_FROM_DIFF_ENABLED): the reply says what changed, and never "Updated". */

const LABELS = { observation: "Observation", payroll_amount: "Amount", level: "Level", prior_actions: "Prior Actions" };

describe("replyFromDiff", () => {
  it("an empty diff says nothing changed", () => {
    expect(replyFromDiff({ changed: [] }, LABELS)).toBe("I didn't change anything on the form.");
    expect(NOTHING_CHANGED).toBe("I didn't change anything on the form.");
  });

  // Expectation changed on purpose (QA, 3 Nov 2026, Step B flip): the line says what changed — filled in, added,
  // from/to — with each line quoted whole, never the whole value ";"-joined and cut.
  it("says what changed per field, never Updated", () => {
    const reply = replyFromDiff(
      {
        changed: [
          { key: "payroll_amount", before: "", after: "$3.25" },
          { key: "level", before: [], after: ["written"] },
          { key: "prior_actions", before: "", after: "Verbal warning — signed 05/12/2025\nCoaching — signed 01/01/2026" },
          { key: "unlabelled", before: "a", after: "b" },
        ],
      },
      LABELS,
    );
    expect(reply).toBe(
      [
        'Filled in Amount: "$3.25".',
        "Level is now written.",
        'Filled in Prior Actions: "Verbal warning — signed 05/12/2025" and "Coaching — signed 01/01/2026".',
        'Changed unlabelled from "a" to "b".',
      ].join("\n"),
    );
    expect(reply.toLowerCase()).not.toContain("updated");
  });

  it("a cleared field says so", () => {
    expect(replyFromDiff({ changed: [{ key: "observation", before: "x", after: "" }] }, LABELS)).toBe("Cleared Observation.");
  });

  // Expectation changed on purpose (QA, 3 Nov 2026): a long value is described, not cut mid-sentence with "…".
  it("a long value is described, never cut", () => {
    const long = `${"word ".repeat(60)}end`;
    const reply = replyFromDiff({ changed: [{ key: "observation", before: "", after: long }] }, LABELS);
    expect(reply).toBe("Filled in Observation.");
    expect(reply).not.toContain("…");
    expect(REPLY_VALUE_MAX).toBeGreaterThan(0);
  });

  /*
   * QA, 3 Nov 2026 (Step B flip, Ask Sunny): "set the daily stats to 3 of 4 shifts on time" and "Add that she
   * Must Practice the sanitizing checklist every shift." both replied 'Changed Details of Coaching to
   * "Observed:; Dana Lane was late to open the location today.; Expectation:; Dana is expected to arrive on time
   * and be…"' — the whole field, ";" for line breaks, cut, and not what was added. Invented person.
   */
  it("QA's report: an added line is named, not the whole field", () => {
    const before = "Observed:\nDana Lane was late to open the location today.\nExpectation:\nDana is expected to arrive on time and be ready to open.";
    const after = `${before}\nShe must practice the sanitizing checklist every shift.`;
    const reply = replyFromDiff({ changed: [{ key: "observation", before, after }] }, LABELS);
    expect(reply).toBe('Added to Observation: "She must practice the sanitizing checklist every shift.".');
    expect(reply).not.toMatch(/;|…/);
  });

  it("text added at the end of a line is what the reply quotes", () => {
    const reply = replyFromDiff(
      { changed: [{ key: "observation", before: "She was late on Monday", after: "She was late on Monday and was also late on Tuesday." }] },
      LABELS,
    );
    expect(reply).toBe('Added to Observation: "and was also late on Tuesday.".');
  });

  it("a line taken out is named", () => {
    const reply = replyFromDiff({ changed: [{ key: "observation", before: "One.\nTwo.", after: "One." }] }, LABELS);
    expect(reply).toBe('Removed from Observation: "Two.".');
  });
});
