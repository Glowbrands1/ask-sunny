import { afterEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";
import { namedManualSection, namedPolicies } from "./named-policy-section";
import type { ManualChunk } from "./official-policy-manual";
import { sectionsNamedIn } from "./policy-change";
import { correctPolicyTypos, policyWordFor } from "./policy-typos";

/**
 * ============================================================================
 * A MISSPELLED POLICY NAME IS STILL THAT POLICY (POLICY_NAME_TYPOS_ENABLED)
 * ============================================================================
 *
 * QA item 8, 25 Oct 2026. Live turns, typed as the manager typed them (names
 * and places invented):
 *
 *   "creat ca form for <name> for violating attendence policy on 10-20-26.
 *   verbl. no payrol deduct. jba manuel 1-1-26 for previous coachng, …"
 *     → "Woven does not see a section … for 'attendence' … so I won't cite one"
 *   "need a ca for <name> … out of dres code oct 11 verbl warning …"
 *   "… for openning salon late on 9-28-26. writen. verbl ca was 9-1-26"
 *
 * Fails with the flag off and passes with it on.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);
const ATTENDENCE =
  "creat ca form for Rhea Calder for violating attendence policy on 10-20-26. verbl. no payrol deduct. jba manuel 1-1-26 for previous coachng, at the salon, team member";
const DRES = "need a ca for Rhea Calder at the salon out of dres code oct 11 verbl warning no payrol deduct";
const OPENNING = "creat a ca form for Rhea Calder, team memeber, for openning salon late on 9-28-26. writen. verbl ca was 9-1-26";

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("POLICY_NAME_TYPOS_ENABLED", "true");
const cited = (text: string) => accountManualSections(text, CHUNKS).map((s) => `${s.heading} p.${s.page}`);

/** The reply's policy line, as the proposal builds it from a named policy. */
function policyLine(text: string): string | null {
  const reading = readCaPolicy(text);
  const phrase = namedPolicies(text).at(-1)?.phrase ?? null;
  const found = reading.stated === null ? namedManualSection({ text, chunks: CHUNKS }) : null;
  const named =
    reading.stated !== null || !phrase
      ? null
      : found
        ? { phrase, lookup: "found" as const, heading: found.section.heading, page: found.section.page, offenseKey: found.offenseKey }
        : { phrase, lookup: "missing" as const };
  return caPolicyProposalLine(reading, named);
}

describe("flag off: the misspelling defeats the lookup (the bug)", () => {
  it('"attendence" is answered with no section', () => {
    expect(policyLine(ATTENDENCE)).toContain(`Woven does not see a section of the current policy manual for "attendence"`);
    expect(cited(ATTENDENCE)).not.toContain("Attendance p.14");
  });

  it('"openning salon late" is not read as a late opening', () => {
    expect(cited(OPENNING)).not.toContain("Late Opening p.15");
  });
});

describe("flag on: the policy the manager meant", () => {
  it('"violating attendence policy" is Attendance p.14', () => {
    on();
    expect(readCaPolicy(ATTENDENCE).stated).toBe("attendance");
    expect(policyLine(ATTENDENCE)).toBe(
      "**Policy:** Attendance, as you said. I'll quote that section from the current policy manual on the draft.",
    );
    expect(cited(ATTENDENCE)).toContain("Attendance p.14");
  });

  it.each([
    [DRES, DRES.replace("dres code", "dress code").replace("verbl", "verbal")],
    [OPENNING, OPENNING.replace("openning", "opening").replace("verbl", "verbal")],
  ])("%s reads as the policy it would spelled right", (typed, spelled) => {
    on();
    // The same reading as the right spelling. (An unframed "out of dress code" reads no policy
    // even spelled right; that is a separate reading, not a typo.)
    expect(cited(typed)).toEqual(cited(spelled));
    expect(readCaPolicy(typed)).toEqual(readCaPolicy(spelled));
  });

  it('"openning salon late" is Late Opening p.15', () => {
    on();
    expect(cited(OPENNING)).toContain("Late Opening p.15");
  });

  it('"add the attendence policy" with a form open names Attendance', () => {
    on();
    expect(sectionsNamedIn({ text: "add the attendence policy", chunks: CHUNKS }).map((s) => s.heading)).toEqual(["Attendance"]);
  });

  it('"verbl" reads as "verbal" for any reader that uses the correction', () => {
    on();
    expect(correctPolicyTypos("verbl warning")).toBe("verbal warning");
  });
});

describe("flag on: what is not a misspelling", () => {
  it.each(["warming", "herbal", "police", "clearing", "uniforms", "cleaned", "opened", "manager", "verbally"])("%s", (word) => {
    on();
    expect(policyWordFor(word)).toBeNull();
  });

  it("text with no slip is returned exactly", () => {
    on();
    const text = "Rhea Calder called the police after the store opened.";
    expect(correctPolicyTypos(text)).toBe(text);
  });
});
