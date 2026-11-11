import { afterEach, describe, expect, it } from "vitest";

import { flaggedCitationWrite } from "./policy-citation-fields";

/**
 * FOLLOW_UP_CITATION_FIELD_ENABLED (QA P5 replay LS-S9, 27 Oct 2026): the
 * Follow-Up Coaching draft's Follow-Up Observation read "Policy reference:
 * Promotions Policy, JBA Policy Manual p.34" — the only thing in a field that
 * stays blank until the follow-up has happened. On, the citation goes with
 * the Original Expectation; off, as main.
 */
const FLAG = "FOLLOW_UP_CITATION_FIELD_ENABLED";
const LATE_CHUNK = {
  chunkIndex: 4,
  page: 16,
  printedPage: 15,
  section: "Late Opening",
  content: "Late Opening\n15 | P a g e\nA salon opens at the posted time.",
  sections: [{ heading: "Late Opening", page: 15 }],
};
const write = () =>
  flaggedCitationWrite({
    enabled: true,
    templateKey: "follow-up-coaching",
    values: { original_expectation: "Open the salon at the posted time.", follow_up_observation: "" },
    notes: "She was late opening the salon.",
    chunks: [LATE_CHUNK],
    manual: { documentId: "doc-manual", documentTitle: "JBA Policy Manual", matchedBy: "tag" as const },
  }).values;

afterEach(() => {
  delete process.env[FLAG];
});

describe(FLAG, () => {
  it("on: the citation goes with the Original Expectation; Follow-Up Observation stays blank", () => {
    process.env[FLAG] = "true";
    const values = write();
    expect(values.original_expectation).toContain("Policy reference: Late Opening Policy, JBA Policy Manual p.15");
    expect(values.follow_up_observation).toBe("");
  });

  it("off: as main, into Follow-Up Observation", () => {
    const values = write();
    expect(values.follow_up_observation).toBe("Policy reference: Late Opening Policy, JBA Policy Manual p.15");
  });

  it("the Coaching Form is unchanged either way", () => {
    process.env[FLAG] = "true";
    const values = flaggedCitationWrite({
      enabled: true,
      templateKey: "coaching",
      values: { coaching_details: "She opened the salon late." },
      notes: "She was late opening the salon.",
      chunks: [LATE_CHUNK],
    }).values;
    expect(values.coaching_details).toContain("Policy reference: Late Opening Policy");
  });
});
