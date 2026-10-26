import { afterEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { groundConductPolicy, readCaPolicy } from "@/lib/forms/ca-policy";
import { EVERYDAY_ONE_WORD, sectionsNamedIn } from "@/lib/forms/policy-change";

import { attachFormTurnSources } from "@/lib/ai/form-card-slots";

/**
 * ============================================================================
 * "PROMOTIONS" IS NOT THE PROMOTIONS SECTION (POLICY_EVERYDAY_HEADING_ENABLED)
 * ============================================================================
 *
 * QA item 6, 25 Oct 2026 (conv_mvoe0zgh20z4krm, names invented): "help me
 * create a coaching form" / "… it's for october promotions …" put "Promotions
 * Policy, JBA Policy Manual p.34" (the HR section on promoting employees) on a
 * coaching about sales offers, on every turn.
 *
 * Fails with the flag off and passes with it on.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("POLICY_EVERYDAY_HEADING_ENABLED", "true");

function cardLines(turns: readonly string[]): string[] {
  return attachFormTurnSources({
    content: "",
    citations: [],
    notes: turns.join("\n"),
    chunks: CHUNKS,
    documentId: "manual",
    documentTitle: "JBA Policy Manual",
  })
    .content.split("\n")
    .filter((line) => /JBA Policy Manual p\.\d+/.test(line));
}

const PROMOTIONS = [
  "help me create a coaching form",
  "1.  Can I keep this field blank to use this coaching form with multiple staff?\n2. October 1st\n3. it's for october promotions, can i upload the pdf to read off of?\n4. tanning consultant",
  "1. employee name is blank\n2. knowledge on october promotions",
];

const lower = (turns: readonly string[]) => turns.map((turn) => turn.toLowerCase());
const sentence = (turns: readonly string[]) => turns.map((turn) => turn.charAt(0).toUpperCase() + turn.slice(1).toLowerCase());

describe("conv_mvoe0zgh20z4krm: sales promotions are not the Promotions section", () => {
  it("flag off: Promotions p.34 is cited (the bug)", () => {
    expect(cardLines(PROMOTIONS).join("\n")).toMatch(/Promotions/);
  });

  it.each([PROMOTIONS, lower(PROMOTIONS), sentence(PROMOTIONS)])("flag on: no Promotions section (%#)", (...turns) => {
    on();
    expect(cardLines(turns).join("\n")).not.toMatch(/Promotions/);
  });

  it.each(["add the promotions policy", "Add the promotions policy", "cite the section on promotions"])("flag on: %s still names it", (turn) => {
    on();
    expect(sectionsNamedIn({ text: turn, chunks: CHUNKS }).map((section) => section.heading)).toContain("Promotions");
  });
});

/*
 * QA, 25 Oct 2026 (via Code 2's cross-person note): a Woven-acknowledgement
 * coaching cited "Orientation p.33" because the account says "orientation".
 */
describe("an onboarding orientation is not the Orientation section", () => {
  const TURN = "create a coaching form for wren okafor, she didnt finish her woven policy acknowledgements from orientation";

  it("flag off: Orientation p.33 is cited (the bug)", () => {
    expect(cardLines([TURN]).join("\n")).toMatch(/Orientation/);
  });

  it.each([TURN, TURN.charAt(0).toUpperCase() + TURN.slice(1)])("flag on: no Orientation section (%s)", (turn) => {
    on();
    expect(cardLines([turn]).join("\n")).not.toMatch(/Orientation/);
  });
});

/*
 * QA-3 on this PR, 26 Oct 2026: pin what must not move. The acknowledgement
 * account still reads as the Standards of Conduct p.12 (only the Orientation
 * line goes), a sales "promotions" coaching cites no policy at all, and every
 * everyday word is a heading in this app's copy of the manual.
 */
describe("NEVER-BREAK with the flag off and on", () => {
  const ACKNOWLEDGEMENT = "create a coaching form for wren okafor, she didnt finish her woven policy acknowledgements from orientation";

  it.each(["", "true"])("the acknowledgement account is Standards of Conduct p.12 (flag %j)", (value) => {
    vi.stubEnv("POLICY_EVERYDAY_HEADING_ENABLED", value);
    for (const turn of [ACKNOWLEDGEMENT, ACKNOWLEDGEMENT.charAt(0).toUpperCase() + ACKNOWLEDGEMENT.slice(1)]) {
      const reading = readCaPolicy(turn);
      expect(reading.suggestion).toBe("standards_of_conduct");
      const grounded = groundConductPolicy({ reading, chunks: CHUNKS });
      expect(grounded.ok && `${grounded.section.heading} p.${grounded.section.page}`).toBe("Standards of Conduct p.12");
    }
  });

  it.each([PROMOTIONS, lower(PROMOTIONS), sentence(PROMOTIONS)])("flag on: the sales promotions coaching cites no policy at all (%#)", (...turns) => {
    on();
    expect(cardLines(turns)).toEqual([]);
    expect(readCaPolicy(turns.join("\n")).suggestion).toBeNull();
  });

  it("every everyday word is a one-word heading in this app's manual", () => {
    type Row = { metadata?: { sections?: { heading?: string }[] } | null };
    const headings = new Set(
      (rows.chunks as Row[]).flatMap((row) => row.metadata?.sections ?? []).map((entry) => (entry.heading ?? "").toLowerCase()),
    );
    for (const word of EVERYDAY_ONE_WORD) {
      expect(headings.has(word) || headings.has(word.replace(/s$/, "")) || headings.has(`${word}s`), word).toBe(true);
    }
  });
});
