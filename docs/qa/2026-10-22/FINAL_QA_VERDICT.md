# Final QA verdict — Ask Sunny (JB & Associates / Sun Tan City) — 22 Oct 2026 (after the overnight validation)

## Recommendation: **PASS for release — subject to your approval and three decisions (below).**

Every QA defect in scope is fixed and verified. The full suite is now **green (0 failures)** after the chat-UI test-timing fix, and typecheck, lint, build, local-stack integration (78/78), Playwright (9/9), payroll and regression probes all pass with no regression against `main`. What remains is Low and pre-existing, or a product decision that is yours.

Production `main` (`1feaa75`) is **not** affected by the Bubbles payroll Yes defect (it never read an amount alone as Yes), but it **does** carry two smaller payroll defects this branch fixes (§3, rows 2–3).

Status: **ON HOLD.** No pull request, no merge, no deployment. No production or historical HR record read or changed.

## 1. Commits
| | SHA |
|---|---|
| Base (`origin/main`) | `1feaa75` |
| **Final feature-branch head** (`claude/lucid-shannon-v79zju`, pushed) | **`771466e`** (+ a docs-only evidence commit on top) |

Overnight commits (after the previous verdict at `4ee4c1b`): `9e84273` payroll fail-safe · `52fceb0` chat-UI test timing · `16b2836` payroll amount comma · `771466e` withdrawn payroll answer.

## 2. Tests — exact counts at the final head
| Check | Result | Evidence |
|---|---|---|
| Full suite `npm test` (sequential, alone) at `771466e` | **12,367 passed · 0 failed · 131 skipped** (12,498); files 517 passed · 12 skipped | `evidence/full-suite/ask-sunny-full.{log,json}` |
| Skipped | 131 tests / 12 files — **unchanged since the QA baseline**; all environment-gated | `evidence/baseline/skipped-tests.md` |
| Typecheck | exit 0 | `ask-sunny-tsc.log` |
| Lint | exit 0 — 0 errors, 3 warnings (same as `main`) | `ask-sunny-eslint.log` |
| `next build` (live mode) | exit 0 | `evidence/browser/sunny-build.log` |
| Local-stack integration | **78/78** (6 files) | `evidence/browser/sunny-local-stack.log` |
| Playwright, live build, seeded accounts | **9/9** | `evidence/browser/sunny-*` |
| Regression probes vs `main` | conversation **48/50** (main 29) · identifiers **20/20** (12) · prior coaching + location authorization **38/38** (22) · review claims **16/16** (11) · bare number after "at" **7/7** — **0 regressions** | `evidence/final-probes/` |
| Payroll reader, 43 sentences | **0 false Yes, 0 false No**; answers identical to Ask Bubbles' on all 43 | `evidence/pre-release/payroll-edge2-*.json` |
| Payroll through the chat, 19 scenarios | **19/19** (main 12/19) | `evidence/pre-release/payroll-conversation-*.json` |
| Chat-UI timing, 10 alternating runs × 22 tests | **0 of 220** failed with the fix (17 of 220 without) | `evidence/pre-release/ui-*` |

## 3. Fixed overnight (root cause; fail-before test; same fix in Ask Bubbles)
| # | Defect | Root cause | Fix | Tests |
|---|---|---|---|---|
| 1 | On the **branch** (not `main`): "we're not doing / skip / no need for / hold off on the $25 payroll deduction", "payroll deduct $25 does not apply" read **Yes**; "we did not waive…" read No | The amount reader ported from Bubbles: an amount beside "payroll deduct" was a Yes unless a fixed negative phrasing matched | A Yes read from an amount or verb is a Yes only when nothing beside it denies it; otherwise asked | 31; 10 fail before |
| 2 | Action Plan **"$25, will be deducted…"** (on `main` too) | Money pattern took the clause's comma | Comma only between digit groups | 7; 3 fail before |
| 3 | After a Yes, "actually we're not doing the $25 payroll deduction" left the form; the card kept **Yes** (on `main` too) | Open-form continuation only recognised a payroll turn read as Yes/No | An unclear payroll turn continues the form; the Yes is withdrawn and asked | 4; 4 fail before |
| 4 | Two chat-UI test files timed out by chance (pre-existing) | `renderChat` imports the whole chat screen inside the first test: 4.6–6.2 s vs the 5 s limit; later tests 1–3 s | `vi.setConfig({ testTimeout: 20_000 })` per file, as `7b3edea` did on `main`. **No assertion or `waitFor` timeout changed** | 0/220 vs 17/220 |

## 4. Changed test expectations (complete list: `TEST_CHANGE_AUDIT.md`)
No assertion deleted, skipped or loosened; no `.skip`/`.only`/`.todo`. Overnight: only the timeout line in two files. Earlier, unchanged: names kept as typed (restored to `main`'s expectations); "Jane Doe at 373" → no salon (branch-only file).

## 5. Browser and saved-form evidence (final head, `evidence/browser/`)
Manager `salon_director` at **NE Lincoln 27th Street (`loc-0310`)**, also covering **NE Lincoln O Street (`loc-0311`)**; synthetic employee "pat rivera".
- Continuity: "i already told you", reload, next turn — open-form key kept, `?c=` kept, thread restored, employee kept.
- "lincoln o street" (assigned) → `loc-0311`, employee kept; "kearney" (unassigned) → blank, `needs_location`, employee kept.
- Location choice offers only the two assigned salons; forged `loc-0309` → **403**.
- Saved and read back: `pat rivera`, `loc-0310`, `2026-10-15`, `['verbal']`; payroll **`['no']`** ×3 (will not / don't / waived), **`['yes']`** for the positive control.

## 6. Permissions and salon numbers (`pre-release/SUNNY_ROLES_AND_SALON_NUMBERS.md`)
- **Unchanged by the branch.** Employee and Assistant Salon Director get **403 on all 17 templates** and no form card in chat, on `main` and on the branch (route probe). Salon Director: 11 templates allowed, the 6 EPP templates refused. The branch only hides the "Create a form" button they could never use.
- **306/307/314:** on `main`, "store 306" silently files at salon 0306 (Wornall) although Google store 306 is KS Manhattan (0462); the branch leaves it blank and asks, offering both. Access is unaffected either way.

## 7. Remaining (none release-blocking)
| ID | Severity | Description |
|---|---|---|
| B3 | Low | After a ready card and "i already told you", a one-word "today" ends the intake (nothing saved wrongly) — pre-existing |
| R1 | Low | Lower-case name in "…what should I do?" gets no suggestion — pre-existing |
| P-1 | Low | After a form exists, an unclear payroll statement changes nothing and is not asked (code reading) — pre-existing |
| LS-1 | Low (test, not in CI) | `month-to-date.local-stack.test.ts` fails only when run after the Woven access tests in a different order; passes in the standard order (78/78); identical on `main` |
| F-10 | Medium (data) | District managers cannot file until verified district → salon assignments exist (fail-closed by your instruction) |

## 8. Cross-company isolation
0 Bubbles data in Sunny code or tests; the 8 "store" hits are Sunny's own Google store-code handling, a role word and one provenance comment — none user-facing. Sunny's own resolver (`salon-mention.ts`, `salon-reply.ts`) and unchanged `authorizeLocation`. `evidence/isolation-check.txt`.

## 9. Before release (your decisions)
1. **F-14:** keep "Create a form" hidden for Assistant Salon Directors and Employees (UI only; the server already refuses them).
2. **306/307/314:** keep "ask" (recommended) or adopt a "salon N / store N" rule.
3. **Owner acknowledges** names kept as typed, the date question, and the (now fail-safe) payroll reader arriving on Sunny.
4. Then: PR, green CI, deploy, post-deploy smoke (`pre-release/RELEASE_CHECKLISTS.md`).
