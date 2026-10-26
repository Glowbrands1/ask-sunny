import { describe, expect, it } from "vitest";

import { onlyNegatedLateness, withoutNegatedLatenessTopic } from "./negated-lateness";

/**
 * QA tester 2, 26 Oct 2026 (invented name): "coaching form for rory vance, she
 * was not late today" ticked Topic of Coaching "Other: Punctuality".
 * Lowercase, sentence case and ALL CAPS.
 */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  ["sentence case", (text) => {
    const named = text.toLowerCase().split("rory vance").join("Rory Vance");
    return named.charAt(0).toUpperCase() + named.slice(1);
  }],
  ["ALL CAPS", (text) => text.toUpperCase()],
];

const DRAFTED = {
  values: { coaching_details: "Observed:\nRory was not late today.", other_topic: "Punctuality" },
  checked: { coaching_topics: ["other"] },
};

describe.each(REGISTERS)("negated lateness (%s)", (_register, as) => {
  it("the reported turn and its kin deny the lateness", () => {
    for (const notes of [
      "coaching form for rory vance, she was not late today",
      "coaching form for rory vance, she was NOT late today",
      "coaching form for rory vance, she is never late",
      "coaching form for rory vance, she was on time today",
    ]) {
      expect(onlyNegatedLateness(as(notes)), notes).toBe(true);
      expect(withoutNegatedLatenessTopic(DRAFTED, as(notes)), notes).toEqual({
        values: { coaching_details: "Observed:\nRory was not late today." },
        checked: { coaching_topics: [] },
      });
    }
  });

  it("NEVER-BREAK: real lateness, another attendance problem, or another topic stays as drafted", () => {
    for (const notes of [
      "coaching form for rory vance, she was late today",
      "coaching form for rory vance, she was not late but left early",
      "coaching form for rory vance, she was not late today but was late yesterday",
      "coaching form for rory vance, no call no show, not late before",
    ]) {
      expect(withoutNegatedLatenessTopic(DRAFTED, as(notes)), notes).toBe(DRAFTED);
    }
    const otherTopic = { values: { other_topic: "Product knowledge" }, checked: { coaching_topics: ["other"] } };
    expect(withoutNegatedLatenessTopic(otherTopic, as("coaching form for rory vance, she was not late today"))).toBe(otherTopic);
  });
});
