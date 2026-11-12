# Gate-Sunny-3 — #876 + #834 (EXCERPT_BRAND_FILTER + EXCERPT_EMPTY_CARD_DROP, one delta) — GO

- Heads: #876 `619dd2c3`, #834 `0e4c4ef8` (stacked on #876; gated as one delta, as Coding-5 asked)
- Base: merged onto Sunny main `a5b96f4d` with no conflicts; tsc clean. Main moved to `a7b9ef69` during the run, so the
  pair was re-merged onto `a7b9ef69` (no conflicts, tsc clean). The commits in between (DRAFT_WROTE_NOTHING_NOTICE,
  FULL_POSITION_TITLE, the instead-of-policy guard) don't touch knowledge search or citations.
- Flags (ON arm): `EXCERPT_BRAND_FILTER_ENABLED`, `EXCERPT_EMPTY_CARD_DROP_ENABLED`
- Method: 1 OFF + 1 ON, full `npx vitest run` with production's flags (`on` + `assumedOn`) in the env.

## Results

| | tests | passed | failed |
|---|---|---|---|
| main OFF (a5b96f4d) | 21,797 | 20,404 | 1,259 |
| PR OFF | 21,830 | 20,437 | 1,259 |
| PR ON  | 21,830 | 20,437 | 1,259 |

- PR OFF vs main OFF: 33 new tests (excerpt-brand-filter, excerpt-empty-card, excerpt-empty-card-route), all pass.
  0 other status changes. Replay text: 0 of 1,585 records differ.
- PR ON vs PR OFF: 0 status changes. Replay text: 0 of 1,585 differ, as expected: the pack stubs knowledge search,
  so no manual chunks reach a source card. The unit tests cover both flags on and off.
- flags-off-parity: unchanged.

## Extra check: what the filter drops from Sunny's own manual

I ran `withoutBrandLines` over all 151 chunks of the production JBA manual fixture
(`src/test/fixtures/jba-manual-production-151.json`). 8 chunks change. Every dropped line names the sibling brand
("Buff City Soap", "BCS") or sits under a "Buff City Soap:" label: the p.24 contact block (phone line), the p.43
holiday block with its holiday-pay paragraph (the chunk's section heading is Buff City Soap), the brands' discount
bullets, and a dropped bullet's wrapped line ("wear under their branded apron."). Nothing from Sun Tan City or a shared
policy is lost. INTENDED.

Eval (`evals/flags.json` on = both flags): 63/63 tests; 51 cases, 42 pass off and 42 on, and no case changes outcome.

0 REGRESSION. No open replay case moves (no replay case exists for this; Coding-5 noted the pack can't reach it).

## Verdict

**GO** for #876 + #834 together. Don't turn on EXCERPT_BRAND_FILTER without EXCERPT_EMPTY_CARD_DROP: alone it leaves
an empty "Page 43 — Buff City Soap" card.
