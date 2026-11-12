# Gate-Sunny-3 — #883 FULL_POSITION_TITLE label fix — GO

- Head: `15b20568` (Coding-5). Its branch already contains main `a7b9ef69`, so no merge was needed; tsc is clean.
- FULL_POSITION_TITLE is already on in production (round 33, in `production-flags.json` on main), so the comparison is
  **main `a7b9ef69` vs the PR head, both on production flags** (`on` + `assumedOn`), not flag OFF/ON. 1 + 1, full
  `npx vitest run`.

## Results

| | tests | passed | failed |
|---|---|---|---|
| main a7b9ef69 | 21,802 | 20,409 | 1,259 |
| PR head 15b20568 | 21,807 | 20,414 | 1,259 |

Status changes: 5 new tests, all pass (12 other rows are the Woven safety test titled by worktree path). Nothing else
changed status.
- replay `nov12-r33-full-position-title-labelled`: holds with production's flags, and holds with
  FULL_POSITION_TITLE on (fix arm)
- 3 `title-of-another-person.test.ts` cases ("Position:" is a field label, not a person; a person named before the
  title still owns it; off shows the bug)

Replay text: 1,590 → 1,592 records. The only additions are the new case's two arms; **0 existing records differ**.
INTENDED. 0 REGRESSION.

Eval on the PR head (default `evals/flags.json`): 63/63. The off column equals `baseline.json` with FULL_POSITION_TITLE on
in production-flags; 42/51 cases pass, and no case changes outcome.

## Verdict

**GO.** The new case `nov12-r33-full-position-title-labelled` holds on production flags; no existing case changes.
