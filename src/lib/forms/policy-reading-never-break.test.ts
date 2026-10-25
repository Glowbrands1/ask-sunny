import { describe, expect, it } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { caPolicyProposalLine, groundConductPolicy, readCaPolicy } from "./ca-policy";
import { findManualSection, type ManualChunk } from "./official-policy-manual";
import { nextPolicySections, readPolicyChange, sectionsNamedIn } from "./policy-change";

/**
 * ============================================================================
 * POLICY READING: THE NEVER-BREAK LIST
 * ============================================================================
 *
 * What already works on main, locked before any policy-reading change (QA,
 * 25 Oct 2026). Every case runs against the production JBA Policy Manual rows,
 * read the way the app reads them, so the page each assertion names is the
 * page the live card would print. Each later policy-reading flag must leave
 * every line here green with its flag on and off.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);

const cited = (text: string) => accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`);
const section = (heading: string) => findManualSection(CHUNKS, [heading])!;

describe("never-break: the policy a manager's words already resolve", () => {
  it('"violating the standards of conduct" is Standards of Conduct p.12', () => {
    const text = "create a written ca for Test Employee for violating the standards of conduct";
    expect(readCaPolicy(text).stated).toBe("standards_of_conduct");
    expect(cited(text)).toContain("Standards of Conduct p.12");
  });

  it('"opening the salon late" is Late Opening p.15', () => {
    const text = "Test Employee was opening the salon late on 10-1-26";
    expect(cited(text)).toContain("Late Opening p.15");
  });

  it("being late is Attendance p.14", () => {
    expect(cited("Test Employee was 20 minutes late to her shift on 10-2-26")).toContain("Attendance p.14");
  });

  it("dress code is Dress Code p.15", () => {
    const text = "Test Employee violated the dress code on 10-3-26";
    expect(readCaPolicy(text).stated).toBe("dress_code");
    expect(cited(text)).toContain("Dress Code for The Company p.15");
  });

  it("a missed sanitize clean resolves Care and Cleaning p.21 when that section is cited", () => {
    expect(section("Care and Cleaning of Equipment and Facilities").page).toBe(21);
  });

  it("the break-room charging rule is on p.19 and PTO on p.41", () => {
    expect(section("Cell Phone/Smart Watch Policy").page).toBe(19);
    expect(section("Paid time Off (PTO)").page).toBe(41);
  });

  it('"add dress code" with a draft open keeps both policies', () => {
    const current = [section("Attendance")];
    const turn = "add the dress code policy";
    expect(readPolicyChange(turn)).toBe("add");
    const next = nextPolicySections({ mode: "add", current, named: sectionsNamedIn({ text: turn, chunks: CHUNKS }) });
    expect(next.map((entry) => entry.heading)).toEqual(["Attendance", "Dress Code for The Company"]);
  });

  it("a Standards of Conduct swap on request cites only Standards of Conduct", () => {
    const current = [section("Attendance")];
    const turn = "use the standards of conduct policy instead";
    expect(readPolicyChange(turn)).toBe("replace");
    const next = nextPolicySections({ mode: "replace", current, named: sectionsNamedIn({ text: turn, chunks: CHUNKS }) });
    expect(next.map((entry) => `${entry.heading} p.${entry.page}`)).toEqual(["Standards of Conduct p.12"]);
  });

  it("a missed Woven deadline reads as Standards of Conduct, grounded on the manual's own line", () => {
    const reading = readCaPolicy("Test Employee missed the woven deadline on 10-15-26");
    expect(reading.suggestion).toBe("standards_of_conduct");
    expect(caPolicyProposalLine(reading)).toContain("**Standards of Conduct**");
    const grounded = groundConductPolicy({ reading, chunks: CHUNKS });
    expect(grounded.ok && grounded.section.page).toBe(12);
  });
});
