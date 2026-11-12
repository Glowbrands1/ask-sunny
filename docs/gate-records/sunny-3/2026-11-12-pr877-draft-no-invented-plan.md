# Gate-Sunny-3 — #877 DRAFT_NO_INVENTED_PLAN_ENABLED — GO on behaviour; fix 2 test files before the flip

- Head: `cb1f314a89` (Coding-6). Gated merged onto main `a7b9ef69`: the only conflict was flags-off-parity (kept both
  sides); tsc clean.
- Re-merged onto current main `05576461`: conflicts in flags-off-parity and chat-quality-flags (kept both sides). The
  overlap needed the closing `}` of `wovenFailedRetryEnabled` restored by hand; then tsc is clean. **Coding-6 should
  rebase so the PR merges clean.**
- Method: 1 OFF + 1 ON, full `npx vitest run` with production's flags in the env. ON adds `DRAFT_NO_INVENTED_PLAN_ENABLED`.

## Results

| | tests | passed | failed |
|---|---|---|---|
| main a7b9ef69 | 21,802 | 20,409 | 1,259 |
| PR OFF | 21,859 | 20,466 | 1,259 |
| PR ON  | 21,859 | 20,423 | 1,302 |

PR OFF vs main: 57 new tests, all pass; nothing else changed. The PR's three edited tests (qa-oct21-audit,
corrective-action-revision-5, pm-draft-route) are made flag-aware, with their OFF expectations unchanged and a comment
explaining each.

PR ON vs OFF: +43 failures.

| Tests | Count | Class |
|---|---|---|
| replay `nov10-draft-no-invented-plan-ca-observation` OPEN arm (now holds), plus parity's first-half child run | 2 | INTENDED / INTENDED-HARNESS |
| `src/app/api/forms/draft-never-blank-oct26-e2e.test.ts`: every "flag on: never blank …", "never-break: a draft that fills is identical …", "six Create presses at once", "time budget control" case | 38 | **INTENDED, but the expectations are stale**: they compare the exact draft text, which still ends with the model's `Going Forward:` block (e.g. "Odalys should pay for any product before taking it."). The flag removes that block, as designed. |
| `src/app/api/chat/account-only-policy-query-e2e.test.ts` ("a draft with no invented detail is kept as written", "the drafted Observed says no opening nobody wrote …") | 2 | Same: the expectations include "Going Forward: The employee is expected to arrive on time …" |
| `src/lib/ai/chat-trace.migration.test.ts` "rejects a view that inserts the cache columns before error_subtype" | 1 | noise: passes alone with the flag on (9/9) |

Replay text OFF vs ON (1,592 records): **1 differs**, the target case's open arm, which now holds. The system prompts
are the same. 0 REGRESSION in behaviour.

Eval (`evals/flags.json` on = `DRAFT_NO_INVENTED_PLAN_ENABLED`): 63/63; 42/51 cases pass off and on, and no case
changes outcome.

## Verdict

**GO on behaviour.** The open case that now holds is `nov10-draft-no-invented-plan-ca-observation`.

**Before the flip**, make the two test files above flag-aware, the way the PR already did for pm-draft-route: with the
flag on, expect no model `Going Forward:` block. Otherwise 40 tests go red the moment the suite runs with the flag on,
for example when production-flags.json lists it and a suite reads that file, or in a gate run.

## Test-only delta, head 706441f6a (contains main 40ec11436) — GO, flip-ready

- Since cb1f314a: `ab21ecd77` (test-only: draft-never-blank-oct26-e2e and account-only-policy-query-e2e made
  flag-aware) and a merge of main. Checked that the PR's product patch against main (draft route, narrative-draft.ts)
  is identical to cb1f314a's. tsc clean.
- The 5 affected test files (draft-never-blank-oct26, account-only-policy-query, pm-draft-route,
  corrective-action-revision-5, qa-oct21-audit), with production flags in the env:
  - main 05576461: 374 tests, 48 failed (main's own baseline failures under production flags)
  - PR OFF: 376 tests, 48 failed, the **same 48**
  - PR ON: 376 tests, 48 failed, the **same 48**; the 40 flag-on failures from cb1f314a are gone
- Verdict: **GO**, with no test left stale for the flip.
