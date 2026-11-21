import { describe, expect, it } from "vitest";

import { withSectionSpacing } from "./outline-sections";

/** STEP_B_SECTION_SPACING_ENABLED (ported from Ask Bubbles; QA's live draft test, 8 Nov 2026). The person is invented. */
const OLD = "Observed:\nOttoline missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline attends every meeting.\n\nGoing Forward:\nOttoline puts meetings on her calendar.";

describe("withSectionSpacing", () => {
  it("puts back the blank line before each heading the field had", () => {
    expect(withSectionSpacing(OLD, OLD.replace(/\n\n/g, "\n"))).toBe(OLD);
  });

  it("a field that never had blank lines is left as written", () => {
    const tight = OLD.replace(/\n\n/g, "\n");
    expect(withSectionSpacing(tight, tight)).toBe(tight);
  });

  it("never adds a blank line before the first heading, and keeps one, not two", () => {
    const next = `${OLD.replace("\n\nExpectation:", "\n\n\nExpectation:")}`;
    expect(withSectionSpacing(OLD, next)).toBe(OLD);
  });
});

/* QA's Ask Sunny r37 live check (12 Nov 2026; names invented): "make that update: he also ignored a second client". */
describe("withSectionSpacing: labels stay on their own line, and Policy reference keeps its blank line (r37)", () => {
  const OLD =
    "Observed:\nOn 11/9, Dorian Vell was rude to a client.\n\nExpectation:\nDorian Vell is expected to greet every client politely.\n\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p.12";
  const SAVED_LIVE =
    "Observed: On 11/9, Dorian Vell was rude to a client and ignored a second client.\n\nExpectation: Dorian Vell is expected to greet every client politely.\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p.12";

  it("the live write is put back in the field's own layout", () => {
    expect(withSectionSpacing(OLD, SAVED_LIVE)).toBe(
      "Observed:\nOn 11/9, Dorian Vell was rude to a client and ignored a second client.\n\nExpectation:\nDorian Vell is expected to greet every client politely.\n\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p.12",
    );
  });

  it("a field whose labels were inline keeps them inline, and one with no blank before Policy reference gets none", () => {
    const inline = "Observed: On 11/9, Dorian Vell was rude to a client.\n\nExpectation: Dorian Vell is expected to greet every client politely.\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p.12";
    expect(withSectionSpacing(inline, SAVED_LIVE)).toBe(SAVED_LIVE);
  });
});
