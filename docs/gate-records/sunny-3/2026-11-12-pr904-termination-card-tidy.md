# Gate-Sunny-3 — #904 TERMINATION_CARD_TIDY_ENABLED — GO (head a794cf714)

- Head `a794cf714` (contains main `7e8dcdb6f`; no conflicts; tsc clean). 1 OFF + 1 ON, full suite, production flags
  in the env; ON adds TERMINATION_CARD_TIDY_ENABLED.
- Change: `ai/termination-stated.ts`. The card's Action Plan regex ends with `[ \t]*$` instead of `\s*$`, so it no
  longer swallows the line break after the plan.

| | tests | passed | failed |
|---|---|---|---|
| main 7e8dcdb6f | 22,164 | 20,766 | 1,264 |
| PR OFF | 22,166 | 20,772 | 1,260 |
| PR ON | 22,166 | 20,768 | 1,264 |

- **Replay text is byte-identical** for main vs PR OFF and for PR OFF vs ON (1,673 records). The plan is the card's
  last line today, as the PR says, so nothing runs on in production's cards either way.
- The 2 new `termination-card-tidy.test.ts` tests pass (off: runs on; on: keeps the blank line).
- ON-only failures: create-currency-audit (P4, 1) and chat-trace.migration (3). Run alone, create-currency-audit plus
  termination-card-tidy give 5 failed / 62 passed OFF and ON (the production-env baseline). Load noise. The main vs
  PR OFF flips (card-change, exit-title-label-words, dm-feedback) are the same noise files seen in #905.
- Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

0 REGRESSION. **GO.** No replay case is tied to the flag; it's a latent-format guard ported from the sibling app.
