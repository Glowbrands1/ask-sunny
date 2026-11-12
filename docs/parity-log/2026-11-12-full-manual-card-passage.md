# Full-manual source card shows its passage — Sunny-only (12 Nov 2026, coding 5)

FULL_MANUAL_CARD_PASSAGE_ENABLED (default off; QA's item after round 35): a full-manual answer's source card showed
only the section heading and page. **Not needed in Ask Bubbles:** its full-manual cards are built by `sourcesOf` /
`excerptForHit` in `ai/full-manual-context.ts`, which already show the passage from its heading (220 characters,
sibling-brand lines left out). This flag gives Sunny's `citationFor` the same: "<heading>: <first lines>".
