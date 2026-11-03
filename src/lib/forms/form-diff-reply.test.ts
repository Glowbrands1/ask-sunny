import { describe, expect, it } from "vitest";

import { NOTHING_CHANGED, REPLY_VALUE_MAX, replyFromDiff } from "./form-diff-reply";

/** Step B (FORM_REPLY_FROM_DIFF_ENABLED): the reply says what changed, and never "Updated". */

const LABELS = { observation: "Observation", payroll_amount: "Amount", level: "Level", prior_actions: "Prior Actions" };

describe("replyFromDiff", () => {
  it("an empty diff says nothing changed", () => {
    expect(replyFromDiff({ changed: [] }, LABELS)).toBe("I didn't change anything on the form.");
    expect(NOTHING_CHANGED).toBe("I didn't change anything on the form.");
  });

  it("says Changed <Label> to <value> per change, never Updated", () => {
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
        'Changed Amount to "$3.25".',
        'Changed Level to "written".',
        'Changed Prior Actions to "Verbal warning — signed 05/12/2025; Coaching — signed 01/01/2026".',
        'Changed unlabelled to "b".',
      ].join("\n"),
    );
    expect(reply.toLowerCase()).not.toContain("updated");
  });

  it("a cleared field says so", () => {
    expect(replyFromDiff({ changed: [{ key: "observation", before: "x", after: "" }] }, LABELS)).toBe("Cleared Observation.");
  });

  it("cuts a long value at a word", () => {
    const long = `${"word ".repeat(60)}end`;
    const reply = replyFromDiff({ changed: [{ key: "observation", before: "", after: long }] }, LABELS);
    const quoted = reply.slice('Changed Observation to "'.length, -2);
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(REPLY_VALUE_MAX + 1);
    expect(quoted.slice(0, -1).endsWith("word")).toBe(true);
    expect(reply.toLowerCase()).not.toContain("updated");
  });
});
