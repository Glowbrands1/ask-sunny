import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManualChunk } from "./official-policy-manual";
import { closePolicyQuestion, namedManualSection } from "./named-policy-section";

/**
 * CLEANING_POLICY_IS_CARE_AND_CLEANING_ENABLED (QA's ruling, 14 Nov 2026): "the cleaning policy" names the manual's one
 * heading with "cleaning" in it; "the sanitation policy" is asked about it. Read from the manual's own headings: a
 * manual with no such heading is unchanged. Gate-Bubbles-5's wording: "for violating the cleaning policy, she did not do
 * the sanitation".
 */
const sheet = (chunkIndex: number, heading: string, page: number): ManualChunk => ({
  chunkIndex,
  page: page + 1,
  printedPage: page,
  sections: [{ heading, page }],
  section: heading,
  content: `${heading}\nText of the section.`,
});
const MANUAL = [sheet(30, "Standards of Conduct", 12), sheet(60, "Care and Cleaning of Equipment and Facilities", 21)];
const NO_CLEANING = [sheet(30, "Standards of Conduct", 12), sheet(33, "Attendance", 14)];
const SAID = "create a ca for pat rivera for violating the cleaning policy, she did not do the sanitation";

afterEach(() => vi.unstubAllEnvs());

describe("off, as before", () => {
  it('"the cleaning policy" names no section', () => {
    vi.stubEnv("CLEANING_POLICY_IS_CARE_AND_CLEANING_ENABLED", "false");
    expect(namedManualSection({ text: SAID, chunks: MANUAL })).toBeNull();
  });
});

describe("on", () => {
  const on = () => vi.stubEnv("CLEANING_POLICY_IS_CARE_AND_CLEANING_ENABLED", "true");

  for (const said of [SAID, "ca for pat rivera for violating the cleaning duties policy", "she broke our cleaning procedures policy"]) {
    it(`"${said}" names Care and Cleaning of Equipment and Facilities, p.21`, () => {
      on();
      const found = namedManualSection({ text: said, chunks: MANUAL });
      expect(found?.section.heading).toBe("Care and Cleaning of Equipment and Facilities");
      expect(found?.section.page).toBe(21);
    });
  }

  it("a manual with no heading with \"cleaning\" in it cites nothing, as before", () => {
    on();
    expect(namedManualSection({ text: SAID, chunks: NO_CLEANING })).toBeNull();
  });

  it('"the sanitation policy" is not cited; it is asked about Care and Cleaning (page 21)', () => {
    on();
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(namedManualSection({ text: "for violating the sanitation policy", chunks: MANUAL })).toBeNull();
    expect(closePolicyQuestion("sanitation", MANUAL)).toMatch(/Did you mean \*\*Care and Cleaning of Equipment and Facilities\*\* \(page 21\)\?/);
    expect(closePolicyQuestion("sanitation", NO_CLEANING)).toBeNull();
  });
});
