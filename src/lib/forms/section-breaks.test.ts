import { describe, expect, it } from "vitest";

import { withSectionBreaks } from "./section-breaks";

const OLD = "Observed:\nMarnie left the front desk unattended on 11/6/26.\n\nExpectation:\nMarnie is expected to keep it covered.";

describe("withSectionBreaks (SECTION_BREAKS_KEPT, QA's live round 15)", () => {
  it("a one-line account over a sectioned field gets its sections back", () => {
    const flat = "Observed: Marnie showed up late on 10/14/26. Expectation: Marnie is expected to arrive on time. Going Forward: Marnie will clock in on time.";
    expect(withSectionBreaks(OLD, flat)).toBe(
      "Observed:\nMarnie showed up late on 10/14/26.\n\nExpectation:\nMarnie is expected to arrive on time.\n\nGoing Forward:\nMarnie will clock in on time.",
    );
  });
  it("a text already in sections is left as it is", () => {
    const sectioned = "Observed:\nMarnie showed up late.\n\nExpectation:\nOn time.";
    expect(withSectionBreaks(OLD, sectioned)).toBe(sectioned);
  });
  it("a field not written in sections is left as it is", () => {
    const flat = "Observed: late. Expectation: on time.";
    expect(withSectionBreaks("Marnie was late.", flat)).toBe(flat);
  });
  it("one heading alone is never split", () => {
    expect(withSectionBreaks(OLD, "Observed: Marnie showed up late.")).toBe("Observed: Marnie showed up late.");
  });
  it("\"Also observed:\" in the manager's words is not a heading (QA's Bubbles gate, nov7-refusal-bub-phone-trace)", () => {
    const added = "Observed:\nWrenna missed the October 15, 2026 Woven deadline.\nAlso observed: Wrenna was on her phone.\nExpectation:\nWoven deadlines are met on time.";
    expect(withSectionBreaks(OLD, added)).toBe(added);
  });
  it("a one-line account keeps \"Also observed:\" and a lower-case \"observed:\" inside its sections", () => {
    const flat = "Observed: Marnie showed up late on 10/14/26. Also observed: she was on her phone, as was observed: twice. Expectation: Marnie is expected to arrive on time.";
    expect(withSectionBreaks(OLD, flat)).toBe(
      "Observed:\nMarnie showed up late on 10/14/26. Also observed: she was on her phone, as was observed: twice.\n\nExpectation:\nMarnie is expected to arrive on time.",
    );
  });
  it("a label inside a sentence is not a heading", () => {
    const flat = "Observed: Marnie said the Expectation: was unclear. She was late.";
    expect(withSectionBreaks(OLD, flat)).toBe(flat);
  });
});
