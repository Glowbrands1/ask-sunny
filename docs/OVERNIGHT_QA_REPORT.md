# Overnight QA report — Corrective Action chat (Ask Bubbles · Ask Sunny)

Branch `claude/charming-goldberg-2lg2uq` in both repositories · 22–23 Oct 2026 · nothing merged, deployed or opened as a PR.

## 1. Executive summary

| | Ask Bubbles | Ask Sunny |
|---|---|---|
| Recommendation | **READY FOR PR REVIEW** (not for deploy until the live checks in §8 run) | **READY FOR PR REVIEW** (not for deploy: owner confirmation of the manual and the live checks in §8 are outstanding) |
| Head commit | `c9beb41 (code) — this report is the next commit` | `4474e41 (code) — this report is the next commit` |
| Full unit/integration suite | 9,842 passed · 0 failed · 59 skipped (9,901 tests, 2,225 suites) | 11,825 passed · 0 failed · 131 skipped (11,956 tests, 2,866 suites) |
| Typecheck · lint (whole repo) | clean · 0 errors, 9 warnings (all in files this branch does not touch) | clean · 0 errors, 3 warnings (all in files this branch does not touch) |
| Browser suite (Playwright, demo build) | 110 passed, 10 skipped, 0 failed | none exists in this repo — NOT TESTED |
| Policy manual | Approved Woven handbook (owner, 8 Oct 2026) | Applies to STC by its text; approval **unverified → marked "requires owner confirmation"** |
| Conflicts with `main` | none (6 commits behind; merged tree tested: 5,863 passed) | none (up to date) |

All three owner decisions are implemented in both apps and are covered by tests that read the saved form, its audit events and the record row.

The QA found and fixed 14 defects (§2). One of them was critical, in Sunny: a prior action's date correction silently changed the form's warning level to the manager's "decision".

Live validation (the real model, the app against a real database through its API, and a real browser on the CA flow) is **BLOCKED**. Neither app has an isolated environment: Preview uses the production database, and there is no model key or test login. As a partial substitute, real-database behaviour was checked against both apps' actual migrations on a throwaway local Postgres (§8).

## 2. Bugs discovered and fixed

| # | App | Defect (reproduced first, then fixed) | Regression test |
|---|---|---|---|
| 1 | **Sunny (critical)** | "the verbal ca was 9-2-26, not 9-1-26" changed the form's Type of Warning to Verbal and recorded it as the manager's confirmation | QA e2e Q12 "a prior action's date"; intake unit "dated history decides nothing" |
| 2 | Both | A request worded as a question ("Can you make a written CA?") lost the stated level | QA e2e Q10; level-reader unit tests |
| 3 | Bubbles | A history-only follow-up ("prior coaching: …") cut the request's level off the look-back, so the form was created with no level | QA e2e Q11; `warning-level.test.ts` |
| 4 | Sunny | An account opening with a lowercase name ("tess varga wasn't at our mtg…") was answered "Who is this for?" | QA e2e Q10 |
| 5 | Both | Prior coaching sent again after the draft went unanswered by every chat path | QA e2e Q11 |
| 6 | Both | Repeating the same date correction replied "your wording still says 10/19" instead of "nothing needed changing" | QA e2e Q12 |
| 7 | Both | A second, different date correction would not move the account the assistant drafted (it was treated as the manager's after the first fix) | QA e2e Q16 |
| 8 | Both | Confirm accepted Termination/Demotion as a "warning level" | QA e2e Q18 |
| 9 | Both | Confirming the level overwrote other ticks on Type of Warning (e.g. Demotion) | QA e2e Q18 |
| 10 | Both | Whole-turn changes of mind not read ("no, written after all", "go back to verbal", "let's do verbal instead"; Sunny also "change it back to written") | QA e2e Q19; unit tests |
| 11 | Both | The fix for #10 first introduced a quadratic regex (7.8 s on an 80 KB turn), caught by the existing linear-time test; bounded to short turns | `warning-level.test.ts` linear-time; new Sunny linear-time test |
| 12 | Both | The manual's standing and an unconfirmed level were said only in the one-time draft response, so they were lost on refresh or reopening | DOM tests "a reopened Corrective Action…"; QA e2e Q18 |
| 13 | Both | On the form itself a suggested level could not be confirmed (re-ticking a ticked box saves nothing) — added a **Confirm** button and `confirm_warning_level` | DOM + QA e2e Q18 |
| 14 | Sunny | The suggested-level notice filter ignored its argument (lint), so it was all-or-nothing | covered by the draft-route suites |

Test-infrastructure fixes (not app defects): route mocks did not export the new error classes, so they moved to the unmocked `warning-level-gate.ts`. The Sunny harness now models the database view join for rows written mid-request.

## 3. Files changed and commit SHAs

**Ask Bubbles** — `origin/main..HEAD`:
* `c9beb41` Corrective Action: policy-source standing, chat date fixes, confirmed warning level
* `7020eb6` Evidence notice: keep its existing wording, and add the no call/no show
* `017b8f0` Corrective Action QA: conversation fixes for flexible, stated-only form filling
* `483275e` Corrective Action: a meeting not attended is cited where the manual puts it

**Ask Sunny** — `origin/main..HEAD`:
* `4474e41` Corrective Action: policy-source standing, chat date fixes, confirmed warning level
* `1f97676` Corrective Action QA: conversation fixes for flexible, stated-only form filling
* `8e79103` Corrective Action: a meeting not attended is cited where the manual puts it

Main files this round: `src/lib/forms/{ca-chat-corrections,ca-chat-dates,warning-level-gate,warning-confirmation,standing-notices}.ts` (new), `instances.ts`, `instances/[id]/route.ts`, `instances/[id]/draft/route.ts`, `official-policy-manual.ts`, `knowledge/providers/supabase.ts` (Bubbles), `chat-policy-change.ts`, `ca-policy.ts`, `form-proposal.ts`, `server-ask.ts`, `inline-form.tsx`, the level readers (`warning-level.ts` / `corrective-action-intake.ts`), `proposal.ts` (Sunny), and `docs/policy-manual-source-2026-10-22.md`. Full lists: `git diff --name-status origin/main...HEAD`.

## 4. Test counts and outcomes

| Run | Ask Bubbles | Ask Sunny |
|---|---|---|
| Final full vitest (all files) | 9,842 passed · 0 failed · 59 skipped (9,901 tests, 2,225 suites) | 11,825 passed · 0 failed · 131 skipped (11,956 tests, 2,866 suites) |
| Typecheck (`tsc --noEmit`) | clean | clean |
| ESLint (whole repo) | 0 errors, 9 warnings (all in files this branch does not touch) | 0 errors, 3 warnings (all in files this branch does not touch) |
| CA conversation QA file (saved-state assertions) | 62 tests, all pass | 61 tests, all pass |
| Playwright (headless Chromium, demo build) | 110 passed · 10 skipped · 0 failed | no suite — NOT TESTED |
| Merged with current `main` (forms/AI/chat suites) | 5,863 passed · 0 failed · typecheck clean | already current |
| Local Postgres, real migrations (§8) | all checks as expected | all checks as expected |

The final runs had no failures. In earlier runs that night: one Sunny timeout (pre-existing, below), and one route-test mock gap in each app, caused by this work and fixed before the commit (§2).

Known pre-existing items (identical on the unchanged base branch, not changed here):

* Sunny `rollout-fixes.dom.test.tsx`, "does not carry an open rating form into another conversation". It takes 4.3 s alone (4.4 s on base) against a 5 s limit. It timed out once (5.03 s) in an earlier full run under load and passed 3 of 3 times alone.
* Intent and name readers take about 0.5 s on an 84 KB adversarial chat turn (same timing on base).
* Bubbles reads "write up a verbal warning" as unclear and asks. That is safe, but it costs the manager one extra reply.

## 5. QA matrix

| Area | Scenario | Bubbles | Sunny | Evidence |
|---|---|---|---|---|
| 21 Oct conversation | Original request verbatim → saved form (written, payroll No, absenteeism, 10/20, both prior actions, Attendance p.14) | PASS | PASS | QA e2e E1/Q11 |
| Follow-ups | History given later before the draft; one-word answers | PASS | PASS | Q11, earlier scenarios |
| Unfamiliar wording | 6 new phrasings + account-first request | PASS | PASS | Q10 |
| Changes of mind | Written→Verbal→Written before and after the draft; other fields unchanged | PASS | PASS | Q19 |
| Conflicts across turns | The latest stated level wins; prior-action dates never set the level | PASS | PASS | Q12, Q19 |
| Missing information | No payroll answer, prior actions, level or NCNS invented; finalize refused without a level | PASS | PASS | Q19 |
| Dates — before draft | Corrected date on the card Issue line and Date | PASS | NOT TESTED (Sunny's card has no Issue line) | Q13 |
| Dates — after draft | Incident / form / prior-action fields kept apart; asks when ambiguous; repeated and second corrections; refresh | PASS | PASS | Q12, Q16 |
| Dates — preservation | Manager's own wording never rewritten; unrelated fields identical; redraft keeps corrected dates | PASS | PASS | Q12, Q16 |
| Dates — audit | `edited` event with via, from/to, actor, timestamp; row `form_date` synced | PASS | PASS | Q12; local DB "A", "D" |
| Prior actions | Added once, oldest first, never duplicated | PASS | PASS | Q11 |
| Locked records | Finalized form never changed by chat or Confirm; the correction goes onto a new draft | PASS | PASS | Q12, Q18; local DB "F" (DB refuses value writes, 23514) |
| Level — suggestion vs decision | Suggestion stored as `ai` and named as one on the card, the draft and on every reopening | PASS (Bubbles never suggests; blank asks) | PASS | Q14, Q18, DOM tests |
| Level — confirmation | Chat or the form's Confirm button → `manager_confirmation`, event recorded; not asked again | PASS | PASS | Q14, Q18; local DB "W" |
| Level — server enforcement | Finalize 409 `warning_level_confirmation_required`; the only finalize path; browser roles cannot write forms | PASS | PASS | Q14, Q18; local DB "T" (42501) |
| Level — no silent conversion | Repeated reopenings leave the suggestion `ai` | PASS | PASS | Q18 |
| Existing drafts at rollout | AI level / blank level / older citation / already finalized → review, confirm or change, file without recreating; finalized stays as it was | PASS | PASS | Q18 |
| Duplicate Create | Concurrent presses → one record; reload returns the same draft | PASS | PASS | Q15; local DB "R1" (23505) |
| Regeneration | Redraft preserves manager edits and corrected dates | PASS | PASS | Q12, Q15 |
| Policy source | Citation from the manual's chunks with section and page; provenance keeps `ownerConfirmed` | PASS | PASS | Q17, Q18 |
| Policy source — unapproved | Marked "requires owner confirmation" on the card, draft and reopened form | PASS (only an unapproved source is marked) | PASS (marked) | Q17, Q18, DOM |
| Policy overrides | Before and after the draft; ambiguous policy asks and keeps the draft | PASS | PASS | earlier scenarios; chat-policy-change suites |
| Non-CA forms | CA date, level and prior readers never touch a Coaching form; existing header corrections unchanged | PASS | PASS | Q16; chat-correction-stress |
| Tenant isolation | Code-level scope checks (existing suites) | PASS | PASS | instance-scope tests |
| Tenant isolation — live | Two real tenants, real auth | BLOCKED | BLOCKED | no isolated environment |
| Live model | Real AI on unfamiliar wording | BLOCKED | BLOCKED | no model key for the app; session credentials not used |
| Live DB through the app | App → PostgREST/Auth → Postgres | BLOCKED | BLOCKED | Docker daemon unavailable (GoTrue); Preview = production DB |
| Live browser on the CA flow | Refresh, reopen, confirm and finalize against a real backend | BLOCKED | BLOCKED | as above |
| Browser regression (demo) | Existing Playwright suite | PASS | NOT TESTED (no suite) | §4 |

## 6. Policy-manual verification

* **Ask Bubbles.** CA citations resolve to `81622d77…`, "2025 JBA Policy Manual – Edited 5-2025". It is the only indexed JBA document in `bcs-core`. It was synced from Woven entity `42486200…`, which the owner confirmed on 8 Oct 2026 (`src/config/company/woven.ts`). Its citation provenance keeps the document id, title, `matchedBy` and now `ownerConfirmed: true`. Any future manual found only by name from an upload is marked "requires owner confirmation".
* **Ask Sunny.** CA citations resolve to `ce6b00f1…`, "JBA Policy Manual Edited 5.2025": `stc-core`, Woven sync, 166 chunks, found by filename prefix, untagged.
  * The text applies to STC. Page 1 says it covers "all brands operated by JB & Associates, Inc.", and the contents list Sun Tan City.
  * Attendance (PDF p.15 / printed p.14) says "Seminars/Meetings/ Training sessions are considered scheduled shifts".
  * Seminar/Webinar Attendance (PDF p.38) counts as a no call no show only *without notifying your Supervisor*.
  * **Approval as Sunny's CA source is unverified.** Every citation says "requires owner confirmation" on the chat card, the draft and every reopening, and its provenance stores `ownerConfirmed: false`.
  * To confirm, an owner tags `ce6b00f1` `official-policy-manual` in the Knowledge Base. No tag or knowledge record was changed.
* Full records: `docs/policy-manual-source-2026-10-22.md` in each repo.

## 7. Existing-draft rollout risks

A read-only count on 22 Oct found **24 of 55** open Sunny CA drafts and **4 of 17** Bubbles CA drafts without a manager-decided level. After deploy:

* Each of these drafts shows the notice. It reads "Type of Warning: Written Warning is Ask Sunny's suggestion…" with a **Confirm Written Warning** button, or "Choose the Type of Warning…" when the level is blank.
* Finalize returns 409 until the manager confirms or ticks a level. Nothing is converted automatically and no draft has to be recreated (Q18).
* Older Sunny citations carry no `ownerConfirmed` value. They read as unconfirmed, so those drafts also show the manual notice. Older Bubbles citations read as confirmed (the approved handbook).
* Forms already finalized are unaffected and stay valid. An "Edit as new draft" copy of one asks for the level before it can be refiled.
* Suggested communication: a short note to District/Salon managers that open CA drafts may ask them to confirm the level.

## 8. Browser and live validation evidence

* **Local Postgres 16 with each app's real migrations** (throwaway, `127.0.0.1`, synthetic rows, deleted afterwards). These are the exact writes the new code makes:
  * a duplicate card id returns **23505** and one row remains;
  * the confirmation upsert stores `manager` / `manager_confirmation`;
  * `edited` audit events are stored with timestamps;
  * the date correction syncs the row's `form_date`;
  * after finalize, the database refuses value updates and inserts with **23514** and the level is unchanged;
  * `authenticated` and `anon` are refused with **42501** on read and write.

  Script and output: the session scratchpad's `local-db-verify.sql` / `local-db-evidence.txt`. (psql's `LAST_ERROR_SQLSTATE` keeps the previous error, so the "A … 23505" line is stale; "A events: 3" shows the inserts succeeded.)
* **Playwright (Bubbles)**: 110 passed / 10 skipped. It ran headless, since the container has no display, so a visible browser was not possible, against a demo build with seeded data and no database or model. This is browser regression evidence only, not live validation.
* **BLOCKED**:
  * the real AI model, since the app has no key and the session's own credentials were not used;
  * the app against a real database through PostgREST/Auth, since the Docker daemon is not running for GoTrue;
  * real refresh, reopen and finalize, and tenant isolation, on a live backend: both apps' Preview deployments use the production database, so no write testing is possible there.

## 9. Outstanding business approvals

1. **Ask Sunny:** confirm `ce6b00f1` ("JBA Policy Manual Edited 5.2025") as Sunny's approved CA policy manual, and that it is current for STC. Then tag it `official-policy-manual`. Note that an older 2024 edition is still indexed in `stc-core`.
2. Both apps: an isolated staging environment (its own Supabase project, a model key, a test login) for the live checks in §8, before deploy.
3. Both apps: agreement on the rollout note for open CA drafts (§7).

## 10. Remaining defects, risks and blockers

* No open defects in the code under test.
* Deploy blockers: the live validation in §8 (BLOCKED) and Sunny approval item 1.
* Residual risks:
  * natural-language coverage is broad but not exhaustive; an unread phrasing falls back to asking, never to inventing;
  * the card id is deterministic per actor, form and card, so an identical card pressed again returns the same draft (by design);
  * the finalize gate now applies to every CA, including forms started by hand;
  * three pre-existing items are listed in §4.

## 11. Recommendation

* **Ask Bubbles — READY FOR PR REVIEW.** Do not deploy until the live checks run.
* **Ask Sunny — READY FOR PR REVIEW.** Do not deploy until the manual is confirmed by an owner (or the team accepts the "requires owner confirmation" marking in production) and the live checks run.

No production data was modified. The only production database access was read-only `SELECT`s: manual identity, page and section evidence, and the open-draft counts. No migrations, writes, tags or configuration changes were made. No PR was opened, and nothing was merged or deployed.
