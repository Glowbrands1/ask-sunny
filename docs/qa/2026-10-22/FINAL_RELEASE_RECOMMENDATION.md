# Final release recommendation — 22 Oct 2026

> **Superseded by the overnight pass:** see `OVERNIGHT_REPORT.md` (heads Sunny `e91b2e6`, Bubbles `7e68a0e`; Bubbles payroll-only is in production as `e7dd377`; B3 and LS-1 fixed).

All three candidates are **GO, subject to your approval and the prerequisites listed**. Nothing has been merged, deployed or opened as a pull request; no real HR record was read or changed. Both apps remain **ON HOLD**.

Final safety check (payroll corrections after the form exists) found and fixed one genuine defect in both apps — `pre-release/POST_CREATION_PAYROLL_CHECK.md`.

---

## 1. Ask Sunny — full release: **GO** (after your approval)

| | |
|---|---|
| Code commit | **`880d19a`** on `claude/lucid-shannon-v79zju` (pushed); a docs-only evidence commit sits on top |
| Full suite | **12,380 passed · 0 failed · 131 skipped** (skipped unchanged since the QA baseline; environment-gated) |
| Typecheck / lint | exit 0 / 0 errors, 3 warnings (same as `main`) |
| Production build | `next build` (live mode) exit 0 |
| Local database tests | **70 passed, 8 skipped by one failing file** — `month-to-date.local-stack.test.ts` hit leftover `woven_location_map` rows from the Woven access tests (pre-existing, identical on `main`, not in CI; it passed 78/78 in the two previous runs — intermittent, not "standard-order safe" as reported before) |
| Playwright (live build, seeded accounts) | **12/12** — continuity, location reply, location authorization (forged id → 403), saved values (No ×3, Yes), and the 3 new post-creation corrections (No, cancelled → No, ambiguous → cleared + asked) |
| Payroll | reader 43 sentences: 0 false Yes / 0 false No; chat 19/19; after creation 8/8 e2e; answers identical to Bubbles |
| Regression probes vs `main` | 0 regressions (48/50 · 20/20 · 38/38 · 16/16 · 7/7) |

**Remaining risks (Low, pre-existing):** B3 ("today" after "i already told you" ends the intake), R1 (lower-case name in "what should I do?"), LS-1 (the intermittent local-stack test above), F-10 (district managers cannot file — fail-closed by your instruction). Production Sunny is not affected by the Bubbles Yes defect; this release fixes the "$25," Action Plan text and the withdrawn-Yes card that `main` still has.

**Prerequisites:** your decisions on F-14 ("Create a form" hidden for ASDs/Employees — server already refuses them) and 306/307/314 (keep "ask"); owner acknowledgement of names kept as typed and the date question; PR → green CI → deploy → post-deploy smoke (the 12 browser checks with a test account).

---

## 2. Ask Bubbles — payroll-only release: **GO — recommended first** (after your approval)

| | |
|---|---|
| Code commit | **`56c45e1`** on local branch `qa/bubbles-payroll-only` (**not pushed** — needs your permission); 5 commits on `main` `3395e8d`: `4df6fbb` negation/waiver · `2897163` fail-safe · `711f893` amount comma · `483e6b4` withdrawn answer · `56c45e1` corrections after creation. Patches: `pre-release/bubbles-payroll-only/` |
| Contains every payroll safety fix | **Yes** — `payroll-deduct.ts` and `chat-correction.ts` are byte-identical to the full branch; no payroll line differs in any other file |
| Production files changed | 3: `payroll-deduct.ts`, `chat-correction.ts`, `form-proposal.ts` (+9 lines) |
| Full suite | **9,806 passed · 0 failed · 59 skipped** |
| Typecheck / lint | exit 0 / 0 errors, 9 warnings (same as `main`) |
| Production build | exit 0 |
| Local database tests | 22/25 — the 3 failures are the stale revocation test, **identical on `main`** (fixed only on the full branch; not payroll; not in CI) |
| Playwright | **all 7 payroll checks pass**: saved values No ×3 / Yes, and the 3 post-creation corrections. The other 5 browser checks reflect `main`'s non-payroll behaviour this option deliberately leaves alone (names capitalised; "‹Bubbles store›" replaces the employee — F-02), so 5 pass / 7 fail overall, none on payroll |
| Payroll | reader 43 sentences: identical to the full branch, 0 false Yes / 0 false No; chat 19/19; after creation 8/8 |

**Remaining risks:** every non-payroll defect already in production stays (F-02 a store reply can overwrite the employee — seen in this run, F-03 dates, F-04, F-07/F-08, F-09, F-11 prior forms across stores, F-12). Historical forms saved with a wrong Yes remain until the HR audit.

**Prerequisites:** permission to push the branch → PR → green CI → deploy → record the deploy time (audit window end) → smoke test ("we will not payroll deduct $25" → No; "no need for the $25 payroll deduction" → asked; after creating a Yes form, "we cancelled the $25 payroll deduction" → No) → HR audit gates G0–G2 (`pre-release/hr-audit/HR_AUDIT_PLAN.md`, validated on synthetic data).

---

## 3. Ask Bubbles — full release: **GO** (after your approval; after Option A, or instead of it)

| | |
|---|---|
| Code commit | **`225bf10`** on `claude/lucid-shannon-v79zju` (pushed); a docs-only evidence commit sits on top |
| Full suite | **10,152 passed · 0 failed · 59 skipped** |
| Typecheck / lint | exit 0 / 0 errors, 9 warnings (same as `main`) |
| Production build | exit 0 |
| Local database tests | **25/25** |
| Playwright | **12/12** (same 12 checks as Sunny, with Bubbles' own stores and accounts) |
| Payroll | identical to the payroll-only option and to Sunny; after creation 8/8 |
| Regression probes vs `main` | 0 regressions (48/51 · 17/17 · 36/36 · 16/16) |

**Remaining risks (Low, pre-existing):** B3, R1, N5 (an admin's bare "‹Bubbles store number›" ends the intake), F-10 (no district roster). Historical forms need the HR audit (as for Option A).

**Prerequisites:** owner acknowledgement of names kept as typed (reverses the 9 Oct capitalisation rule) and the date / store-reply / two-person behaviour; PR → green CI → deploy → post-deploy smoke (12 browser checks) → HR audit if Option A was not released first.

---

### Commit summary
| | Code SHA | Pushed |
|---|---|---|
| Ask Sunny full | `880d19a` | yes |
| Ask Bubbles payroll-only | `56c45e1` | **no** (local; awaiting your permission) |
| Ask Bubbles full | `225bf10` | yes |
| Base `main` | Sunny `1feaa75`, Bubbles `3395e8d` | — |

Evidence: `evidence/full-suite/` (full suites, tsc, lint, live runs per candidate incl. browser JSONL and screenshots; earlier attempts kept as `live-*.attempt1/2` — attempt 1 failed because the Docker daemon had stopped, attempt 2 because the three new browser tests were ordered before the library setup test and the payroll-only build refused a `node_modules` symlink; all three were environment/harness issues, fixed and re-run), `evidence/post-creation/` (probes before/after, fail-before logs).
