import { afterEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { applyFullManualAnswer, choosePolicyManuals, type FullManualDocument } from "./full-manual-context";

/**
 * FULL_MANUAL_CARD_PASSAGE_ENABLED (QA, 12 Nov 2026, after round 35): a full-manual answer's source card showed only
 * the section heading and its page, while a retrieval card (and Ask Bubbles' full-manual card) shows the passage. Read
 * through the production JBA Policy Manual (151 rows).
 */
function assembled() {
  const document: FullManualDocument = {
    id: rows.document_ids["ask-sunny"],
    title: rows.title,
    category: "policies_compliance",
    chunks: (rows.chunks as ChunkRow[]).map(manualChunkFromRow),
  };
  const assembly = choosePolicyManuals("Can I use my phone at work?", [document]);
  if (!assembly.ok) throw new Error("manual did not assemble");
  return assembly.manuals;
}

// The cell-phone sentence `full-manual-production-pages.test.ts` cites on page 19 alone.
const ANSWER =
  "It's the employee's responsibility to protect the guest experience — texting, phone calls, or social media use while working jeopardizes that.";

afterEach(() => vi.unstubAllEnvs());

describe("FULL_MANUAL_CARD_PASSAGE_ENABLED", () => {
  it("off: the card is the heading alone, as before", () => {
    vi.stubEnv("FULL_MANUAL_CARD_PASSAGE_ENABLED", "");
    const { citations } = applyFullManualAnswer({ content: ANSWER, manuals: assembled(), sourceCount: 0 });
    expect(citations.length).toBeGreaterThan(0);
    for (const card of citations) expect(card.excerpt).not.toContain(":");
  });

  it("on: the card shows its heading and the first lines of the passage on the cited page, cut at a whole word", () => {
    vi.stubEnv("FULL_MANUAL_CARD_PASSAGE_ENABLED", "true");
    const { citations } = applyFullManualAnswer({ content: ANSWER, manuals: assembled(), sourceCount: 0 });
    expect(citations.length).toBeGreaterThan(0);
    for (const card of citations) {
      const [heading, ...rest] = card.excerpt.split(": ");
      const body = rest.join(": ");
      expect(heading!.length, card.excerpt).toBeGreaterThan(0);
      expect(body.length, `no passage on the card: ${card.excerpt}`).toBeGreaterThan(20);
      expect(body.length).toBeLessThanOrEqual(221);
      expect(body, "the passage repeats its heading").not.toMatch(new RegExp(`^${heading!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
      expect(card.locator).toMatch(/^Page \d+$/);
    }
    // The production manual's page 19, as printed.
    expect(citations.map((card) => card.excerpt)).toContainEqual(
      expect.stringMatching(/^Cell Phone\/Smart Watch Policy: Personal Employee cell phones are permitted in the workplace but must be kept out of sight\./),
    );
  });

  it("on, with EXCERPT_BRAND_FILTER: no card quotes the sibling company", () => {
    vi.stubEnv("FULL_MANUAL_CARD_PASSAGE_ENABLED", "true");
    vi.stubEnv("EXCERPT_BRAND_FILTER_ENABLED", "true");
    const { citations } = applyFullManualAnswer({ content: ANSWER, manuals: assembled(), sourceCount: 0 });
    for (const card of citations) expect(card.excerpt).not.toMatch(/Buff City Soap/i);
  });
});
