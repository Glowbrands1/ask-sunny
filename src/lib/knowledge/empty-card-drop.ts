import { EXCERPT_HIDDEN_BRANDS } from "@/lib/brand/knowledge";
import { excerptEmptyCardDropEnabled } from "@/lib/config/chat-quality-flags";
import type { SourceCitation } from "@/types";

/**
 * ============================================================================
 * NO EMPTY SOURCE CARD, AND NONE LABELLED WITH THE SIBLING COMPANY
 * ============================================================================
 *
 * EXCERPT_EMPTY_CARD_DROP_ENABLED (QA via Coding-5, 11 Nov 2026; default off; ships with EXCERPT_BRAND_FILTER). With the
 * brand filter on, the JBA Policy Manual's p.43 "Buff City Soap:" holidays block filters to nothing, and its card came
 * out as "Page 43 — Buff City Soap" with an empty excerpt. On: a card whose excerpt is empty is not shown, and a card
 * whose locator names a hidden brand keeps only its page ("Page 43"). The cards are numbered by their place in this list
 * and the prose's [S#] markers are stripped before display, so nothing else needs renumbering. Off: the list as built.
 */
const HIDDEN = new RegExp(String.raw`\b(?:${EXCERPT_HIDDEN_BRANDS.join("|")})\b`, "i");

function withoutHiddenBrandLabel(card: SourceCitation): SourceCitation {
  const locator = card.locator;
  if (!HIDDEN.test(locator)) return card;
  const page = /^(Page\s+\d+)/i.exec(locator)?.[1] ?? null;
  return { ...card, locator: page ?? "" };
}

/** The cards to show: none with an empty excerpt, none labelled with a hidden brand. */
export function shownCitations(cards: SourceCitation[]): SourceCitation[] {
  if (!excerptEmptyCardDropEnabled()) return cards;
  return cards.filter((card) => (card.excerpt ?? "").trim() !== "").map(withoutHiddenBrandLabel);
}
