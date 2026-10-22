# Final QA verdict — Ask Sunny (JB & Associates / Sun Tan City) — 22 Oct 2026

## Recommendation: **CONDITIONAL PASS**

The branch fixes every authorized defect and your findings A, B and C, introduces no regression on any probe, and passes typecheck, lint, build, the local-stack integration suite and the browser run. The condition is CI stability: two chat-UI DOM test files time out intermittently (pre-existing on the baseline at a higher rate — not caused by this branch), so a PR's CI can go red by chance until they get timeout headroom, which needs your authorization. Remaining product defects are Low and pre-existing.

Status: **ON HOLD.** No pull request opened, nothing merged, nothing deployed. No production or historical HR record read or changed.

## 1. Commits
| | SHA |
|---|---|
| Base (`origin/main`) | `1feaa75` |
| **Final feature-branch head** (`claude/lucid-shannon-v79zju`, pushed) | **`4ee4c1b971c8e825bef5bb4dcc84382e7a47ce6e`** |
| QA baseline before the fix round | `9548afb` |

Fix-round commits (first-parent): `4fb664d` docs/CI corrections · `67a084c` W1 (F-01 payroll `5b208c5`, F-04 intent `38f9290`) · `2790542` W3 (F-11 `7ef0e1a`, F-05 `de490a3`) · `4171a5e` W4 (F-03 `7c4fa18`, F-07/F-08 `23b285a`) · `d52a3fa` F-11 follow-up · `e6ce884` W2 (spelling `cf8bdd6`, F-02 `8ae0147`, F-09 `d0e197a`, F-06 `b24882e`) · `f8c4464` F-12 (`1ebbf60`) · `2eaf93e` F-03d · `4ee4c1b` X2.

## 2. Tests — exact counts (final head `4ee4c1b`)
| Check | Result | Evidence |
|---|---|---|
| Full suite `npm test`, run 1 (sequential, alone) | **12,324 passed · 1 failed · 131 skipped** (12,456) — files 515 passed · 1 failed · 12 skipped (528) — 379 s. The failure: `rollout-fixes.dom.test.tsx › does not carry an open rating form into another conversation` — **timeout at 5,354 ms** (UI-T below) | `evidence/full-suite/ask-sunny-full.{log,json}` |
| Full suite `npm test`, run 2 (confirmation) | 12,323 passed · **2 failed** · 131 skipped (12,456) — 410 s. Both failures are the same file, both **timeouts** (5,019 ms and 5,102 ms, reported as `STACK_TRACE_ERROR`): `does not carry an open rating form into another conversation` and `does not carry a typed complaint onto another conversation's turn` (UI-T). Note: `eslint` on Bubbles ran during this run's first minute | `ask-sunny-full-rerun.{log,json}` |
| Baseline before QA fixes (`9548afb`) | 11,929 passed · 0 failed · 131 skipped (12,060) | `evidence/baseline/sunny-full.log` |
| Skipped tests | **131 skipped tests / 12 skipped files — unchanged from baseline**; all environment-gated (local stack, live Woven, reporting workbooks, Performance-Framework source document not in the repo); none is a `.skip` in code; no skipped file differs from `main` | `evidence/baseline/skipped-tests.md` |
| Typecheck `tsc --noEmit` | exit 0 | `ask-sunny-tsc.log` |
| Lint `eslint .` | exit 0 — 0 errors, 3 warnings (the same count as `main`) | `ask-sunny-eslint.log` |
| `next build` (live mode) | exit 0 | `evidence/browser/sunny-build.log` |
| Local-stack integration (`test:local-stack`: revocation, Woven access, adoption, month-to-date, posted-date, lifecycle) | **78/78 passed** (6 files). Note LS-1: `month-to-date` fails if run *after* the Woven access tests in a different order (leftover `woven_location_map` rows) — identical on `main`; not run in CI | `evidence/browser/sunny-local-stack.log`; `evidence/local-stack-order/` |
| Playwright (live build, local stack, seeded accounts) | **9/9 passed** | `evidence/browser/sunny-playwright.log`, `sunny-browser.jsonl`, `shots/sunny-*.png` |
| Regression probes (branch vs `main`) | conversation **48/50** (main 29) · identifiers **20/20** (12) · AC3+AC5 **38/38** (22) · review claims **16/16** (11) · bare number after "at" **7/7** — **0 regressions** | `REGRESSION_MATRIX.md`, `evidence/final-probes/` |

New QA test files (each failing before its fix and passing after): `qa-w1-*`, `qa-w2-*`, `qa-w3-*`, `qa-w4-*`, `qa-f11-*`, `qa-f12-salon-reply*.test.ts`, `qa-f03d-dated-name.test.ts`, `qa-x2-warning-level-reversal.test.ts` — net **+396 tests** vs baseline. Fail-before counts per group: `TEST_CHANGE_AUDIT.md`.

### UI test failures (Phase 2) — classified, not a regression
`rollout-fixes.dom.test.tsx` and `rating-stays-in-place.dom.test.tsx` (22 tests), 5 alternating runs each, same settings: **baseline `9548afb` 11/110 failed executions; branch 6/110**. (Branch measured at `f8c4464`; the two later commits `2eaf93e`, `4ee4c1b` change only `src/lib/forms`, not the chat UI.) Both slow tests take ≈4.4–5.2 s even when they pass, against the 5 s default; every isolated failure is "Test timed out in 5000ms"; the "Unable to find … Rate this conversation" error occurs only right after a timed-out test (cascade). With `--testTimeout=30000`: 22/22. **Pre-existing timing-bound tests; not product behavior; not environment-only.** Fix (needs your authorization, it changes test configuration): per-file `vi.setConfig({ testTimeout: 20_000 })` as in Sunny `7b3edea`. Evidence: `evidence/phase2-ui-timeouts/PHASE2_SUNNY_UI_FAILURES.md`.

## 3. Changed expectations (every one; full table in `TEST_CHANGE_AUDIT.md`)
No assertion was deleted, skipped or loosened; no `.skip` / `.only` / `.todo` / timeout was added.
| Test | Change | Justification |
|---|---|---|
| `form-intake-qa-2026-10-21.test.ts:232` (branch-only file, not on `main`) | "coaching form for Jane Doe at 373" → salon `loc-0476` → **null** | F-05: a bare number after "at" is not a salon (it was a price or time as often as a store code); "store 373" with a location word still → `loc-0476` (line 231, unchanged). Restores `main`'s reading |
| `corrective-action-conversation`, `employment-change-conversation`, `exit-form-conversation`, `form-intake-qa-2026-09-30` (25 expectations) | capitalised names → **restored byte-for-byte to `main`** | your spelling decision; these had been capitalised by the branch's earlier port `38dad49` |
| `form-intake-qa-2026-10-21.test.ts` (branch-only): "jane doe" ×6, "JANE DOE", "mary-kate o'neil", "brandi algya" ×2, "will turner", one "not found" note | capitalised → **as typed** | same decision; each line commented; one `it.each` became exact `[question, expected]` pairs |
| `corrective-action-payroll-e2e.test.ts:471,483`, `qa-w3-prior-forms-identity.test.ts:194` | callback wiring | F-11 follow-up signature `(name, locationId)`; no assertion changed |

## 4. Browser and saved-form evidence (Playwright, `evidence/browser/`)
Manager `salon_director` assigned to **NE Lincoln 27th Street (`loc-0310`)**, also covering **NE Lincoln O Street (`loc-0311`)**; synthetic employee "pat rivera" (no directory record).
| Test | Result |
|---|---|
| AC4 continuity | "i already told you", reload, "she was late again today": turns 2 and 3 send the open-form key `coaching`; `?c=` id identical after reload; thread and card restored; employee `pat rivera` every turn — PASS |
| AC1 assigned "lincoln o street" | location `loc-0311`, employee kept — PASS |
| AC1 unassigned "kearney" | location stays empty, `needs_location`, employee kept — PASS |
| AC5 location choice | dropdown offers only NE Lincoln 27th Street and NE Lincoln O Street; create at `loc-0311` → 200; forged `loc-0309` → **403** "That salon is not one you are assigned to…" — PASS |
| Saved + read back × 4 | employee `pat rivera`, location `loc-0310`, form date `2026-10-15`, warning `['verbal']`; payroll_deduct **`['no']`** for "we will not payroll deduct $25", "don't payroll deduct $25", "the $25 payroll deduction was waived"; **`['yes']`** for "payroll deduct $25" — PASS |

## 5. Remaining defects
| ID | Severity | Origin | Description | Action |
|---|---|---|---|---|
| UI-T | Low (CI stability) | pre-existing | two DOM test files time out intermittently | authorize per-file timeout headroom (no assertion changes) |
| LS-1 | Low (test isolation) | pre-existing, not in CI | `month-to-date` local-stack test depends on run order | clean up `woven_location_map` rows in the access test |
| B3 | Low | pre-existing | after a ready card and "i already told you", a one-word "today" ends the intake (nothing saved wrongly) | follow-up fix |
| R1 | Low | pre-existing | lower-case name + "what should I do?" → no form suggestion | follow-up fix |
| F-14 | Low | branch (deliberate, earlier ports) | salon numbers 306/307/314 (also another salon's Google code) left blank; "Create a form" hidden for Assistant Salon Directors and Employees | confirm or revert |
| F-10 | Medium (data) | by design | district/region managers cannot file (fail-closed, kept by instruction) | provide verified district → salon assignments |
| F-17 | Info/Low | mostly pre-existing | minor reviewer notes (`QA_FINDINGS.md`) | backlog |

No Critical/High defect remains on the branch. Sunny `main` does **not** have the Bubbles payroll defect (it returns "not stated" and asks), but the branch is where Sunny gets the full payroll reader, now guarded.

## 6. Cross-app isolation (Sunny)
- Lines added by the branch contain **0** Bubbles data tokens (store names, store numbers, ids, aliases, Buff City Soap wording) in code or tests.
- 27 provenance comments name the sibling app (no data). The 8 "store" hits in added production code are Sunny's Google store-code handling, the word list that ends a salon name, a role pattern ("store manager") and one provenance comment — none user-facing.
- Locations resolve through Sunny's own `salon-mention.ts` / `salon-reply.ts` and authorize through the unchanged `authorizeLocation` / `authorizedSalonIds`; F-12 never infers access from a name or number (unassigned "kearney" not set; forged ids 403 in route probes 9/9 and the browser).
- `evidence/isolation-check.txt`, `PARITY_REPORT.md` §0.

## 7. Exact remaining actions before release
1. **You:** authorize the UI-T timeout headroom (or accept re-running CI on a timeout) so the PR's CI is reliably green.
2. **You:** confirm F-14 (salon numbers 306/307/314 left blank; "Create a form" hidden for ASDs/Employees).
3. **You:** approve the branch, then open the PR (QA has not). CI must be green on the PR head.
4. **Optional follow-ups:** LS-1 test isolation; B3 and R1.
5. **Data owner:** verified district assignments before district managers can file (F-10).
