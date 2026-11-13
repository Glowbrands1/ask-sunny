import { afterEach, describe, expect, it, vi } from "vitest";

import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";

import { namedManualSection, namesHeading } from "./named-policy-section";

/*
 * HEADING_DISTINCTIVE_WORDS (QA, 13 Nov 2026, from the 17s live check): "ca for <A> for violating the retaliaton policy"
 * named no section, and neither did "retaliation", because "Retaliation is Prohibited" wanted "is prohibited" said too.
 */
afterEach(() => vi.unstubAllEnvs());

describe("HEADING_DISTINCTIVE_WORDS", () => {
  it("flag off: \"retaliation\" names no heading (as on main)", () => {
    vi.stubEnv("HEADING_DISTINCTIVE_WORDS_ENABLED", "");
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "");
    expect(namedManualSection({ text: "ca for avery for violating the retaliation policy", chunks: JBA_MANUAL_CA_CHUNKS })).toBeNull();
  });

  it("flag on: \"retaliation\" names Retaliation is Prohibited; with close spelling, \"retaliaton\" too", () => {
    vi.stubEnv("HEADING_DISTINCTIVE_WORDS_ENABLED", "true");
    expect(namedManualSection({ text: "ca for avery for violating the retaliation policy", chunks: JBA_MANUAL_CA_CHUNKS })?.section.heading).toBe("Retaliation is Prohibited");
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(namedManualSection({ text: "ca for avery for violating the retaliaton policy", chunks: JBA_MANUAL_CA_CHUNKS })?.section.heading).toBe("Retaliation is Prohibited");
  });

  it("flag on: the singular \"requirement\" may be left off; \"standards\" may not (Standards of Conduct stays with ca-policy)", () => {
    vi.stubEnv("HEADING_DISTINCTIVE_WORDS_ENABLED", "true");
    expect(namesHeading("emergency situation notification", "Emergency Situation Notification Requirement")).toBe(true);
    expect(namesHeading("conduct", "Standards of Conduct")).toBe(false);
  });

  it("flag on: a distinctive word two headings share names neither", () => {
    vi.stubEnv("HEADING_DISTINCTIVE_WORDS_ENABLED", "true");
    expect(namesHeading("retaliation", "Retaliation is Prohibited")).toBe(true);
    expect(namesHeading("retaliation", "Retaliation Reporting is Required")).toBe(false);
  });
});
