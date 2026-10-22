# Phase 2 — Sunny chat UI test failures: baseline vs branch (evidence)

**Files:** `src/features/chat/rating-stays-in-place.dom.test.tsx`, `src/features/chat/rollout-fixes.dom.test.tsx` (22 tests).
**Commits:** baseline `9548afb` (before any QA fix) vs final branch `f8c4464`. **Settings identical:** `npx vitest run <both files>`, repo vitest config, default 5000 ms test timeout, same machine (4 vCPU), runs alternated base/branch, idle start (load 0.54 before run 1). Raw: `base-run{1..5}.json|log`, `branch-run{1..5}.json|log`, `isolated-*`, `summary.txt`.

## 1. Repeated runs of both files (5 each, alternating)
| Run | Baseline 9548afb | Branch f8c4464 |
|---|---|---|
| 1 | 1 failed / 21 passed (17.2 s) | 2 failed / 20 passed (17.3 s) |
| 2 | 1 / 21 (16.2 s) | 2 / 20 (16.2 s) |
| 3 | 3 / 19 (15.9 s) | **0 / 22** (16.0 s) |
| 4 | 2 / 20 (15.8 s) | 2 / 20 (16.4 s) |
| 5 | 4 / 18 (15.9 s) | **0 / 22** (14.4 s) |
| **Total failed test executions** | **11 / 110** | **6 / 110** |

## 2. Which tests, how long, which error
| Test | Baseline fails | Branch fails | Duration in every run (ms) |
|---|---|---|---|
| rollout-fixes › rating is scoped… › does not carry an open rating form into another conversation | 5/5 | 3/5 | base 5034–5161; branch 4671–5026 |
| rating-stays-in-place › … › opening Rate this conversation does not navigate | 3/5 | 2/5 | base 4886–5164; branch 4411–5157 |
| rollout-fixes › … › does not carry a typed complaint onto another conversation's turn | 2/5 | 1/5 | 987–1533 (when it follows a passing test) |
| rating-stays-in-place › … › clicking each star from 1 to 5 | 1/5 | 0/5 | 1276–2105 |

Error types — baseline: 8 × timeout ("Test timed out in 5000ms", reported as `STACK_TRACE_ERROR` in JSON), 2 × `Unable to find … button "/rate this conversation/i"`, 1 × `Unable to find … radio "/^2 —/"`. Branch: 5 × timeout, 1 × `Unable to find … "/rate this conversation/i"`.

**The two top tests take ~5 s even when they pass** — on both commits — so each run is a coin-flip against the 5 s default.

## 3. The missing "Rate this conversation" element, isolated
`-t "does not carry a typed complaint onto another"` alone, 5× each: baseline 4 failed / 1 passed, branch 3 failed / 2 passed. **Every isolated failure is `Test timed out in 5000ms`** (run alone it is the first test and pays the module-load + first render, ~4.6–5.3 s). **The "Unable to find … Rate this conversation" error never occurs in isolation**; it occurs only when the test runs immediately after a test that timed out — the timed-out test's render is not torn down before the next test queries the DOM (cascade), the same mechanism the chat-UI port worker noted on `main`.

Earlier evidence (same session): both files on the branch with `--testTimeout=30000` → 22/22 pass.

## Classification (from the evidence above)
- **Pre-existing**: present on the untouched baseline at a higher rate (11 vs 6 failed executions). **Not a regression** of the QA branch.
- **Root cause: timing-bound tests**, not product behavior: their normal duration (≈4.4–5.2 s) sits on the 5 s default timeout; failures are timeouts plus one cascade symptom. **Not "environment only"**: they fail on a near-idle machine.
- **Impact**: CI will be intermittently red on these two files on any branch, including `main`.
- **Recommended fix (needs authorization — it changes test configuration, which this QA was told not to do to make tests pass):** per-file timeout headroom as in Sunny `7b3edea` (`vi.setConfig({ testTimeout: 20_000 })` in these two files), or make the first render cheaper. No assertion would change.
