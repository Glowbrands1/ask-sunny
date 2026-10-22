# Ask Sunny — the two timing-sensitive chat UI test files: root cause and the applied fix

**Status: fixed on the feature branch (`52fceb0`), under your authorization to fix test-harness issues without weakening assertions.** No assertion, test, `waitFor` timeout or product code changed; nothing skipped.

## The tests
| File | Test | What it checks |
|---|---|---|
| `src/features/chat/rollout-fixes.dom.test.tsx` | "does not carry an open rating form into another conversation" | Opening the rating form on conversation Alpha, then switching to Beta, leaves no open form on Beta |
| same | "does not carry a typed complaint onto another conversation's turn" | Alpha's typed complaint and 2-star choice are not carried onto Beta's rating (which would file a rating against the wrong conversation) |
| `src/features/chat/rating-stays-in-place.dom.test.tsx` | "opening Rate this conversation does not navigate" | Opening the rating keeps the chat where it was |
| same | "clicking each star from 1 to 5 navigates nowhere…" | Each star changes only the rating |

## Root cause
`renderChat()` in both files imports `@/app/providers` and `./chat-screen` **inside the test**, so the **first test in each file** pays for importing the whole Sunny chat-screen module graph. Measured over 20 runs: the first test of each file takes **4.6–6.2 s**, every later test **1–3 s**. The default test timeout is 5 s, so the first test fails by chance. A timed-out test also leaves its render behind, so the next test sometimes cannot find "Rate this conversation" (a cascade; never seen when that test runs alone). Ask Bubbles' copies of the same files run in about 2 s (its chat screen imports less) and need nothing.

This is a test-timing problem, not a product defect: every failure was a timeout or that cascade; with more time all 22 tests pass every time.

## Evidence
| Run set | Unpatched | With the fix |
|---|---|---|
| Phase 2 (5 runs each, baseline `9548afb` vs branch) | 11/110 and 6/110 failed executions | — |
| 10 alternating runs of both files (`evidence/pre-release/ui-*-run*.json`) | **17 of 220** failed executions (7 + 5 on the two first tests, 4 + 1 cascades) | **0 of 220** |
| Sunny full suite | 1 failed (this timeout) at `9e84273`; 1–2 in earlier runs | **12,356 passed, 0 failed** |

## The change (both files)
```ts
vi.setConfig({ testTimeout: 20_000 });
```
with a comment giving the cause and the evidence — the same headroom `import-every-role.dom.test.tsx` already has on Sunny `main` (`7b3edea`). 24 lines added, 0 removed.

## Not changed
- The `waitFor`/`findBy` timeouts (`asyncUtilTimeout`), so every "the element appears" check is exactly as strict.
- Bubbles (not needed).
