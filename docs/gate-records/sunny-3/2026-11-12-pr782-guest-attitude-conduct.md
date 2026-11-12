# Gate-Sunny-3 — #782 GUEST_ATTITUDE_CONDUCT_ENABLED — GO

- Head `3d0d2e0c` (Coding-5). Gated merged onto main `a7b9ef69` (clean, tsc clean). It also merges clean onto current
  main `40ec11436` (tsc clean).
- 1 OFF + 1 ON, full suite, production flags in the env. ON adds `GUEST_ATTITUDE_CONDUCT_ENABLED`.

| | tests | passed | failed |
|---|---|---|---|
| OFF | 21,808 | 20,413 | 1,261 |
| ON  | 21,808 | 20,412 | 1,262 |

Status changes ON vs OFF:
- replay `nov10-sf-b5-guest-attitude-cites-conduct` OPEN arm: it now holds (the card cites Standards of Conduct
  p.12). INTENDED. Parity's first-half child run: INTENDED-HARNESS.
- `guest-attitude-conduct.test.ts` "… with the flag on; as before off": fails with the flag on in the env. Its "off"
  half reads the flag from the environment, and `afterEach` deletes it only after the test. INTENDED-HARNESS (passes
  2/2 in a clean env). Tidy-up: set the flag off explicitly in that half.
- chat-trace.migration ×2: failed → passed (noise, seen in other runs).

Replay text: 19 records differ, all passing cards or the target. Every one is an account where the
guest/customer "said she was giving her an attitude". The card gains "**Policy:** "… giving her an attitude" reads as
the policy manual's **Standards of Conduct** (page 12)", and the plan names Standards of Conduct instead of "the
applicable company policy". Cases: the target (3 records), `nov4-scan-sf-b5-typo-name-rude-to-customer` (open arm,
still open for its own reason), and the nov5-r2-dm-in-passing-* / nov7-complaint-in-passing / nov7-*-delphine* cases
(9 + 7 records), which replay the same sf-b5 sentence. INTENDED-ADJACENT. The guard
`nov10-guest-attitude-control-coworker` is unchanged. 0 REGRESSION.

Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

**GO.** The case that now holds is `nov10-sf-b5-guest-attitude-cites-conduct`.
