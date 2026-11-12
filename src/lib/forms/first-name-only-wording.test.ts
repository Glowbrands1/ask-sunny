import { afterEach, describe, expect, it, vi } from "vitest";

import { draftFacts, leftOutNotice, missingFacts } from "./draft-consistency";

/*
 * FIRST_NAME_ENOUGH_ENABLED (ported from Ask Bubbles), the Corrective Action's wording (QA's r36 live check and ruling (B), 12 Nov 2026;
 * names invented): "create a written CA for Odalys Pemberley, she was 20 minutes late on 11/10, no action plan".
 */
const NOTES = "create a written CA for Odalys Pemberley, she was 20 minutes late on 11/10, no action plan";
function notice(values: Record<string, string>, labels = ["Observation of Offense"]) {
  const keys = Object.keys(values);
  const facts = draftFacts({ employeeName: "Odalys Pemberley", notes: NOTES, today: "2026-11-12" });
  const missing = missingFacts(values, keys, facts);
  return missing.length === 0 ? null : leftOutNotice({ missing, labels, facts, values, narrativeKeys: keys });
}

describe("FIRST_NAME_ENOUGH: a CA Observation that names her by first name", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("on: says she is named by first name only, never \"left out <surname>\"", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "true");
    expect(notice({ observation: "On November 10, 2026, Odalys arrived 20 minutes late." })).toBe(
      "The Observation of Offense names the employee as Odalys only; tell me if you want the full name there.",
    );
  });

  it("on: a date also left out is said as before, then the name line", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "true");
    expect(notice({ observation: "Odalys arrived 20 minutes late." })).toBe(
      "The draft left out 11/10 in Observation of Offense; tell me if you want it added. The Observation of Offense names the employee as Odalys only; tell me if you want the full name there.",
    );
  });

  it("on: no word of her name at all is still \"left out\"", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "true");
    expect(notice({ observation: "On November 10, 2026, the employee arrived 20 minutes late." })).toBe(
      "The draft left out Odalys and Pemberley in Observation of Offense; tell me if you want it added.",
    );
  });

  it("on: two fields", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "true");
    expect(notice({ observation: "On November 10, 2026, Odalys arrived 20 minutes late.", action_plan: "Leadership will coach." }, ["Observation of Offense", "Action Plan"])).toBe(
      "The draft names the employee as Odalys only in Observation of Offense and Action Plan; tell me if you want the full name there.",
    );
  });

  it("on: on the Coaching Form's Details a first name is the name — nothing is said (the sibling app's round 17b)", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "true");
    expect(notice({ coaching_details: "Observed:\nOn November 10, 2026, Odalys arrived 20 minutes late." }, ["Details of Coaching"])).toBeNull();
  });

  it("off: as before", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "");
    expect(notice({ observation: "On November 10, 2026, Odalys arrived 20 minutes late." })).toBe(
      "The draft left out Pemberley in Observation of Offense; tell me if you want it added.",
    );
  });
});
