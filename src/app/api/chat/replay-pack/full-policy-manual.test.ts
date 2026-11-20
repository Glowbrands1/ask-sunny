import { describe, expect, it } from "vitest";

import { manualSectionHeadings } from "@/lib/forms/official-policy-manual";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import { fullPolicyManualChunks } from "@/test/fixtures/jba-manual-full";

/*
 * QA (20 Nov 2026): Runner 2's c259, c242 and c091 findings were the replay pack's CA-only manual, not production. With
 * REPLAY_FULL_POLICY_MANUAL=1 the pack reads the 151 production rows; these are the headings the loop then accepts.
 */
describe("the full production policy manual for replay runs", () => {
  const headings = manualSectionHeadings(fullPolicyManualChunks());

  it("has every chunk, in order, mapped as the provider maps them", () => {
    const chunks = fullPolicyManualChunks();
    expect(chunks).toHaveLength(151);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([...chunks.map((chunk) => chunk.chunkIndex)].sort((a, b) => a - b));
    expect(Object.keys(chunks[0]!).sort()).toEqual(Object.keys(JBA_MANUAL_CA_CHUNKS[0]!).sort());
  });

  it("has the headings the CA-only fixture lacks (c259, c242: Time Records; c091: Dress Code)", () => {
    const fixture = manualSectionHeadings(JBA_MANUAL_CA_CHUNKS);
    expect(fixture).not.toContain("Time Records");
    expect(headings).toContain("Time Records");
    expect(headings.some((heading) => /dress code/i.test(heading)), headings.join(" | ")).toBe(true);
    for (const heading of fixture) expect(headings, `the full manual lost ${heading}`).toContain(heading);
  });
});
