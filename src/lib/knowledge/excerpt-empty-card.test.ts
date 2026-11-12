import { afterEach, describe, expect, it, vi } from "vitest";

import type { MatchedChunkRow } from "./mappers";
import { rowToCitation } from "./mappers";
import { shownCitations } from "./empty-card-drop";

/*
 * EXCERPT_EMPTY_CARD_DROP_ENABLED (QA via Coding-5, 11 Nov 2026). With EXCERPT_BRAND_FILTER on, the JBA Policy Manual's
 * p.43 "Buff City Soap:" holidays block filters to nothing, and rowToCitation gave
 * {"locator":"Page 43 — Buff City Soap","excerpt":"",…}: an empty source card labelled with the sibling company. The row
 * is Coding-5's, verbatim.
 */
const ROW = {
  chunk_id: "chunk-43",
  document_id: "doc-jba",
  document_title: "2025 JBA Policy Manual - Edited 5-2025",
  category: "policies_compliance",
  locator: "Page 43 — Buff City Soap",
  page: 43,
  section: "Buff City Soap",
  content:
    "Buff City Soap:\nBuff City Soap is closed on the below listed holidays. These holidays are paid holidays for\nsalaried managers and full-time staff:\no Independence Day\no Thanksgiving Day\no Christmas Day\no New Years Day\no Easter",
  similarity: 0.8,
} as unknown as MatchedChunkRow;
const OTHER = {
  ...ROW,
  chunk_id: "chunk-42",
  locator: "Page 42 — Paid Time Off",
  section: "Paid Time Off",
  content: "Full-time employees accrue paid time off each pay period.",
} as unknown as MatchedChunkRow;

describe("EXCERPT_EMPTY_CARD_DROP_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("with the brand filter on: no card with an empty excerpt, and no card labelled with the sibling company", () => {
    vi.stubEnv("EXCERPT_BRAND_FILTER_ENABLED", "true");
    vi.stubEnv("EXCERPT_EMPTY_CARD_DROP_ENABLED", "true");
    const cards = shownCitations([ROW, OTHER].map(rowToCitation));
    expect(cards.some((card) => card.excerpt.trim() === "")).toBe(false);
    expect(cards.some((card) => /Buff\s+City/i.test(card.locator ?? ""))).toBe(false);
    expect(cards.map((card) => card.locator)).toEqual(["Page 42 — Paid Time Off"]);
  });

  it("a card whose locator names the sibling company but whose excerpt keeps text loses the label, not the card", () => {
    vi.stubEnv("EXCERPT_BRAND_FILTER_ENABLED", "true");
    vi.stubEnv("EXCERPT_EMPTY_CARD_DROP_ENABLED", "true");
    const mixed = { ...ROW, content: `${ROW.content}\n\nAll salons follow the same posted schedule.` } as unknown as MatchedChunkRow;
    const [card] = shownCitations([rowToCitation(mixed)]);
    expect(card?.excerpt).toMatch(/posted schedule/);
    expect(card?.locator).toBe("Page 43");
  });

  it("off: the cards as built", () => {
    vi.stubEnv("EXCERPT_BRAND_FILTER_ENABLED", "true");
    vi.stubEnv("EXCERPT_EMPTY_CARD_DROP_ENABLED", "");
    const cards = [ROW, OTHER].map(rowToCitation);
    expect(shownCitations(cards)).toBe(cards);
  });
});
