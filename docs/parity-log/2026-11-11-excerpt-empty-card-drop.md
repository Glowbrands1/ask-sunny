## 11 Nov 2026: EXCERPT_EMPTY_CARD_DROP_ENABLED stays Ask Sunny only (Ask Bubbles: EXCERPT_BRAND_HEADING_DROP)

With EXCERPT_BRAND_FILTER on, this app's source card for the JBA Policy Manual's p.43 "Buff City Soap:" holidays block
came out empty and labelled "Page 43 — Buff City Soap" (Coding-5's finding, via QA). EXCERPT_EMPTY_CARD_DROP_ENABLED
drops a card whose excerpt is empty and keeps only the page where the locator names a hidden brand, where the card
lists are built (`ai/server-ask.ts`, `knowledge/providers/supabase.ts`, `api/knowledge/search`), through
`knowledge/empty-card-drop.ts`.

Not ported as such: Ask Bubbles hides the other company's text by a different path, and Coding-5 handles the same
problem there in EXCERPT_BRAND_HEADING_DROP (QA, 11 Nov 2026).
