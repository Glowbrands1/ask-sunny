# Overnight QA and remediation — morning report (22 Oct 2026)

Work was done with synthetic data only. No PR was opened, nothing was merged or deployed, no production setting was changed, and no real HR record was read or changed. Both feature branches were pushed (`claude/lucid-shannon-v79zju` in each repo).

## 1. What was validated and fixed

### Ask Bubbles — production (payroll-only release, live since 22 Oct 19:00:51 UTC)
| Check (read-only or offline) | Result |
|---|---|
| Production deployment | `dpl_qapWgWpjkZjZ3SQk7okAmXUvBm2V`, commit **`e7dd377`** (PR #67), READY, aliased to production; build OK |
| Runtime errors since the deploy (Vercel, re-checked at the end of the night) | **none** |
| Rollback candidate | previous production `dpl_Gp9WfxJZNS8CYFKMuNitEy6Z1UUW` (`3395e8d`), still READY |
| Payroll test files on `e7dd377` | 46 files, **2,588 passed**, 0 failed |
| Payroll through the chat (negation, waiver, cancellation, ambiguous, multi-turn) | **19/19** |
| Payroll reader, 43 sentences | 0 false Yes, 0 false No (identical to the tested branch) |
| After the form exists (corrections, Action Plan consistency, finalized forms) | 12 scenarios, **0 safety violations**: finalized records unchanged (corrections go to a new draft), the Action Plan agrees with the saved answer, an ambiguous answer is cleared and asked |
| HR audit | plan prepared and validated on synthetic data only; window confirmed from Vercel: **2026-10-21 20:55:49 UTC → 2026-10-22 19:00:51 UTC** (`pre-release/hr-audit/HR_AUDIT_PLAN.md`). **Not run against production** (needs your approval, §6) |

Production was not exercised directly: the vercel.app domains are SSO-protected and this session cannot reach them. I did not create a protection-bypass link, because that would change security settings without your approval.

### Ask Bubbles — full branch
- Production `main` (`e7dd377`) merged into the QA branch (`07007cb`). The merged tree is **byte-identical** to the already-tested branch, so the payroll fixes and the existing branch fixes are compatible.
- **Fixed B3** (`7e68a0e`): with a form card open, a reply of only "today" (or "yesterday", "on Monday" and similar) dropped the intake and showed a form picker. The open-form check read calendar dates like "10/20" but not day words. A reply that is only a day now continues the form. A question that mentions today, or a day with no form open, still does not.

### Ask Sunny — full branch
- **Fixed B3** (`555d5e6`, the same fix ported from Bubbles, using Sunny's own salon and role in the test).
- **Fixed LS-1** (`b9fe177`, test-only): the month-to-date local-database test failed whenever it ran after the Woven access tests. Those tests left store-mapping rows on salon 0307, and the deliberate ON DELETE RESTRICT rule then blocked month-to-date's setup. Each Woven suite now deletes only its own rows when it finishes. No assertion changed.
- `e91b2e6`: the parity log records that the LS-1 cleanup stays Sunny-only, because Bubbles has no suite that resets a mapped store.

### Both apps — revalidation on the new heads
- **17 probe sets** were re-run and compared entry by entry with the last final run. Every set is **identical** except B3, which went **FAIL → PASS** in both apps. The sets cover conversation, identifiers, location authorization and prior coaching, reviewer claims, payroll reader, payroll chat and payroll after creation, plus Sunny's roles/permissions, salon numbers and 306/307/314. Permissions, employee identity, location assignments, finalized records, date handling, chat continuity and payroll are unchanged.
- Cross-company isolation is unchanged: no Sunny data in Bubbles and no Bubbles data in Sunny. The one known token is the "Lawrence" guard, which asserts Bubbles does **not** treat it as a store.

## 2. Commit SHAs
| | Branch head (pushed) | Commits tonight |
|---|---|---|
| Ask Bubbles full | **`7e68a0e`** | `07007cb` merge of production `e7dd377` (tree identical to the tested branch) · `7e68a0e` B3 |
| Ask Sunny full | **`e91b2e6`** (code `555d5e6`) | `555d5e6` B3 port · `b9fe177` LS-1 (test-only) · `e91b2e6` parity log |
| Ask Bubbles production | `e7dd377` (`main`) | none (not touched) |
| Ask Sunny production | `1feaa75` (`main`) | none (not touched) |

The docs-only evidence commit is added on top of each branch after this report.

## 3. Tests — passed / failed / skipped (final run, sequential, `evidence/overnight/final-validation-v4/`)
| Check | Ask Bubbles `7e68a0e` | Ask Sunny `e91b2e6` |
|---|---|---|
| Full suite `npm test` | **10,161 passed · 0 failed · 59 skipped** (files 421 / 6 skipped) | **12,389 passed · 0 failed · 131 skipped** (files 519 / 12 skipped) |
| Typecheck | exit 0 | exit 0 |
| Lint | 0 errors, 9 warnings (same as `main`) | 0 errors, 3 warnings (same as `main`) |
| Production build (`next build`, live mode) | exit 0 | exit 0 |
| Local database tests (Postgres + GoTrue + PostgREST) | **25/25** | **78/78** (LS-1 fixed; it previously failed intermittently) |
| Playwright (live build, seeded synthetic accounts) | **12/12** | **12/12** |
| New regression test (B3, QA's exact turns) | 6 of 9 fail before, 9/9 after | 6 of 9 fail before, 9/9 after |

Skipped tests are the same environment-gated tests as at the QA baseline: 59 in 6 files (Bubbles), 131 in 12 files (Sunny). No test was skipped, weakened or deleted. The only change to an existing test is the LS-1 cleanup, which adds `afterAll` rows deletion and changes no assertion.

## 4. Remaining bugs and risks
| ID | App | Sev. | Status |
|---|---|---|---|
| Historical payroll records | Bubbles | **High (data)** | Corrective Actions saved between 21 Oct 20:55 and 22 Oct 19:00 UTC may hold a wrong **Yes**. Needs the HR audit (G1/G2). |
| R1 | both | Low | "pat rivera was late again today… what should I do?" with a **lower-case** name gets no form suggestion. **Not fixed**: the name reader deliberately ignores a lower-case phrase at the start of a sentence, and widening it changes name reading on every chat turn. This needs a separate reviewed change. |
| N5 | Bubbles | Low | An admin's bare "‹Bubbles store number›" with no store question open ends the intake. **Not fixed**: needs a product decision (ignore the number silently, or ask "did you mean store 264?"). |
| F-10 | both | Medium (data) | District managers cannot file until verified district → location assignments exist (fail-closed, as you instructed). |
| Production not exercised end-to-end | Bubbles | Low | Health is confirmed from Vercel state and logs only; no request traffic has been observed yet. |

## 5. Recommendations
- **Ask Bubbles full release (`7e68a0e`): GO, after your approval and the owner acknowledgements.** It builds on what is now in production (byte-identical payroll code) and adds the tested non-payroll fixes. No regression was found against production `main`. Prerequisites: the owner acknowledges that names are kept as typed (this reverses the 9 Oct capitalisation rule), plus the date, store-reply and two-person behaviour. Then PR → green CI → deploy → the 12-check browser smoke test with a test account.
- **Ask Sunny full release (`e91b2e6`): GO, after your approval and decisions.** All checks are green, including the local-database run that was intermittent before. Prerequisites: your decisions on **F-14** ("Create a form" hidden for Assistant Salon Directors and Employees; the server already refuses them) and **306/307/314** (keep "ask"), the owner acknowledgement, then PR → green CI → deploy → smoke test.

Both stay **ON HOLD** until you approve.

## 6. Needs your approval
1. **HR audit, gate G1** (metadata-only query on production for Corrective Actions with payroll Yes in the window above), then **G2** (reading the source chat of the flagged forms). A dedicated read-only role is recommended.
2. **Production smoke test with a test account** on askbubbles, or permission for a time-limited Vercel protection bypass. Neither was done.
3. **Sunny decisions**: F-14 and 306/307/314.
4. **Owner acknowledgements** for both full releases (names kept as typed; date, location and two-person behaviour).
5. **R1 and N5**: whether to schedule them; N5 needs the product rule.
6. **Release approval** for either full branch: PR, merge and deploy.

Evidence: `evidence/overnight/` — `p1-prod-e7dd377/` (production payroll revalidation), `p2-probes/` (17 probe sets, steps, isolation check, B3 before/after, R1 name-reader check), `ls1/` (reproduction and fix), `final-validation-v4/` (suites, typecheck, lint, builds, local-database and Playwright logs, screenshots).
