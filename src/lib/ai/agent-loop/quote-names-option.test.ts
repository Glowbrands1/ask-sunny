import { describe, expect, it } from "vitest";

import { quoteNamesOption } from "./tools";

/* QA's round 2 (22 Nov 2026, U24; found in Ask Bubbles): "Immediate Vol Resignation … resigned via phone call" was filed as No Call No Show. */
describe("quoteNamesOption (U24)", () => {
  it("words that name the option's label keep it", () => {
    expect(quoteNamesOption("Immediate Vol Resignation", "Immediate Voluntary Resignation")).toBe(true);
    expect(quoteNamesOption("immideate volunatary termination", "Immediate Voluntary Resignation")).toBe(true);
    expect(quoteNamesOption("she didn't call or show up", "No Call No Show")).toBe(true);
    expect(quoteNamesOption("didn't fulfill her notice", "Did not fulfill required 14 day / 30 day notice")).toBe(true);
  });

  it("words that do not name it never do", () => {
    expect(quoteNamesOption("resigned via phone call", "No Call No Show")).toBe(false);
    expect(quoteNamesOption("I didn't come in", "No Call No Show")).toBe(false);
    expect(quoteNamesOption("resigned via phone call", "Immediate Voluntary Resignation")).toBe(false);
  });
});
