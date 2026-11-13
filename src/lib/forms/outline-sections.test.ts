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
