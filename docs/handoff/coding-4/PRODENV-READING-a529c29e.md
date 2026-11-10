# Production-flag failures on Ask Bubbles main a529c29e: which are pins and which are live defects

Reader: a coding session, 10 Nov 2026. Read-only; nothing in the repository was changed. Method, scripts and raw results are in this folder (`bisect2.js`, `bisect.js`, `bisect2/*.json`, `bisect/*.json`, `out/*.txt`, `probe/`).

## Method

- **Reproduction.** QA's command reproduces QA's counts on every file I ran: prior-actions 33, corrective-action-conversation 24, reopen-request 12, pm-framework-readiness 18, dm-feedback 30, prior-sentence-fix 28, and so on. Each of those files has 0 failures in a bare env.
- **Group ddmin (`bisect2.js`), one file at a time.** It finds the smallest set S of production flags that reproduces all of the file's production failures, from a bare env. Then, for each flag in S, it runs S without that flag and that flag alone. That attributes every failing test to the flag or flags it needs. "Redundant" means some tests also fail through prod flags outside S, so they have more than one cause.
- **Per-test ddmin (`bisect.js` with `TFILTER`).** I used this for suspicious single tests. It also iterates, to find every independent sufficient flag set.
- **Probes (`probe/`).** A scratch vitest config outside the repo calls the date readers directly with prod flags, prod minus X, and bare. I used it to confirm the date defects.
- **Verdicts.** **pin** means the failing assertion is the pre-flag behaviour and the flag's doc comment, or the production-flags `_about` history, says QA or Pau turned it on for exactly that change. Harness artefacts, where the test cannot see what production does, are also listed as pin, with the reason. **live defect** means production's flags give a manager a wrong card, form or reply. **skipped** means the cause is RELATIVE_DATE_READER (another session's).

## Summary

Attributed and judged: **330 failing tests in 24 files** (of 812 in 241).

| verdict | tests |
|---|---|
| pin | 290 |
| live defect | 18 |
| skipped | 13 |
| pin (unsure) | 6 |
| unsure | 3 |

"pin (unsure)" means pin by the flag's doc, but the new wording or citation was not confirmed by a QA note. "skipped" means RELATIVE_DATE_READER. The live-defect count is in tests; the tests group into 5 defects, ranked below.

Every attributed file reproduced QA's failing count exactly.

### Live defects, worst first (each is behind production flags today; none implemented)

1. **The chat says the Action Plan states the payroll deduction, but the saved plan does not** (qa-oct21-audit-e2e: "the amount changed, then cancelled, then restored" and "repeating an answer already on the form changes nothing"). This needs ACTION_PLAN_SENTENCES_ENABLED or PAYROLL_DEDUCT_AMOUNT_ENABLED; either one alone triggers it.
   - **What the manager sees.** On a created CA they type "change the payroll deduction to $5.00". The reply says "Payroll deduction amount → $5.00. The Action Plan now states the payroll deduction." The saved Action Plan names no deduction at all, and the earlier "$3.25" sentence is gone too. Repeating an answer that is already on the form also silently strips "<name> will be payroll deducted $25." from the plan.
   - **Cause.** `forms/chat-correction.ts` calls `syncPlan` without `amountSentence`, so `collapseToTwoSentences` drops the deduction sentence. `form-edit-tool`, `form-patch-turn` and the reducer all pass `amountSentence: true`.
   - **Proposed fix.** Add a new default-off flag, CORRECTION_PLAN_KEEPS_AMOUNT_ENABLED. With it on, `chat-correction.ts` passes `amountSentence: true` on both of its `syncPlan` calls, and the reply says "now states" only if the written plan contains the amount.
2. **The form date drops the typed incident date when a terse request ends with a dated prior step** (dm-feedback round 3: "Remy Calder - CA - written - no call no show to manager meeting 10/13/26 - payroll deduction no - prior coaching 7/1/26"). This needs CA_SHORTCUT_WORDS + STEP_DATE_NOT_INCIDENT + STEP_DATES_NOT_FORM_DATE together; dropping any one of them restores 10/13.
   - **What the manager sees.** The card and form are dated today, not 10/13/26.
   - **Cause.** The whole message is one "sentence" with no full stop. STEP_SHORTHAND matches "coaching 7/1", and `stepSentenceDates` then marks every date in that sentence as a step date, 10/13/26 included. STEP_DATES_NOT_FORM_DATE then falls back to today.
   - **Proposed fix.** Add a new default-off flag, STEP_SHORTHAND_OWN_DATE_ENABLED. With it on, `forms/step-sentence-dates.ts` adds only the date(s) the shorthand regex matched.
   - **Ask Sunny.** The same file was ported from Ask Sunny; check it there.
3. **The form date drops a typed incident date that is also the day a step was given** (form-date-incident-only, the 4 NEVER-BREAK "i gave her a verbal on 10-21 for being late" rows). The cause is FORM_EDIT_DATE_RULES_ENABLED.
   - **Evidence.** "verbal for ava pellmore, gave her a verbal on 10-21 for being late on 10-21" and "ca for ava pellmore, she was late on 10-21 and i gave her a verbal on 10-21" both give no incident date with prod flags. They give 2026-10-21 with that one flag dropped (probe).
   - **What the manager sees.** The form is dated today instead of the incident day.
   - **Proposed fix.** Add a new default-off flag, INCIDENT_DATE_SHARED_WITH_STEP_ENABLED. With it on, a step's date is excluded only when no incident cue also governs that date.
4. **A metric is read as the employee's name** (corrective-action-conversation: 5 rows under "a metric on its own …"). "Their Club Close is low. Create a corrective action." drafts a CA "for **Club Close**". The Action Plan says "…with Club", and the chat asks for "Club Close's position".
   - **Which part is intended.** The CA itself comes from CA_SALES_POLICY_ENABLED: Pau and the client asked for sales CAs, so the CA is not the defect.
   - **Which part is the defect.** The employee name is. The guard behind FORM_NAME_FROM_ROSTER is off in production, and it only acts beside a roster name anyway.
   - **Proposed fix.** Add a new default-off flag, METRIC_ALONE_NOT_A_NAME_ENABLED. With it on, a metric term (glossary, metric list, or "<X> is low / down / %") is never the employee, and the chat asks "Who is this form for?".
   - **Caveat.** "Club Close" is test data inherited from Ask Sunny. The mechanism applies to any metric phrase.
5. **The EPP's program name becomes the employee's job title** (store-woven-form-flow: 6 rows, sdit-epp and tsd-epp in the per-form and lower/upper-case groups). The cause is TYPED_NAME_ENABLED.
   - **What the manager sees.** "Create an SDIT EPP for Sarah Miller at Store 236" gives Job Title "SDIT" (TSD EPP gives "TSD"). Woven had verified "Production Associate".
   - **Cause.** `statedJobTitle` reads the template's name as a title. With TYPED_NAME on, a stated title beats Woven's (`ai/form-proposal.ts:1057` and `:1310`).
   - **Proposed fix.** Add a new default-off flag, FORM_NAME_NOT_A_TITLE_ENABLED. With it on, a title word that is part of the requested template's name is ignored.

### Possible problems (unsure; worth one look)

- **The attendance plan claims lateness that was never described** (dm-feedback "says nothing about pay when payroll deduct is No"; cause ATTENDANCE_ACTION_PLAN). "…for violating attendance policy on 10-20-26…", with no lateness said, saves Pau's plan: "expected to arrive on time … Continued lateness …". MEETING_NOT_LATENESS and MISSED_SHIFT_NOT_LATENESS already carve out other cases. A possible fix is a default-off ATTENDANCE_PLAN_NEEDS_LATENESS_ENABLED.
- **A typed title is cut short** (TYPED_NAME). "(Team Member Part Time)" becomes "Team Member".
- **No not-found verification is attached** (TYPED_NAME). An off-roster typed name gets no `employeeVerification {status:'unverified'}`. I did not check whether the card still says the name is unverified.
- **The Late Opening citation lost "; Attendance — Page 14"** (official-policy-manual ×5; cause LATE_OPEN_DATE). This looks intended, but I found no QA note for it.
- **A store-scoped manager is asked "Which of your stores is this about?"** after naming a store outside their scope (staff-picker; cause WHOLE_TEAM_COACHING). Scope is enforced, so this is not a leak.
- **Out of my scope, for the RELATIVE_DATE_READER session.** dm-feedback "Tess Varga missed our team meeting yesterday 10/21/26 …" ends up with no form date (expected 2026-10-21). That looks like a real defect. The other RELATIVE_DATE_READER rows here only write "today" as today's ISO date instead of null, which puts the same date on the form.

### Families QA asked about first

1. **prior-actions.test.ts (33).** All 33 are pins. Two separate flags each drop the word "signed": PRIOR_ACTIONS_NO_SIGNED (QA/Pau 5 Nov; on in round 4) and PRIOR_ACTIONS_PARSE. 23 rows need both flags dropped before they pass. Note that the direction is the reverse of the brief: the tests *expect* "— signed 09/21/2026" and production gives "— 09/21/2026". PARSE also normalises "JBA Manual" to "JBA Policy Manual" (doc: a named manual reads as the manual's title). The same two flags account for the "signed" rows in dm-feedback, conversation-qa-e2e, warning-level-e2e and pm-draft-route.
2. **corrective-action-conversation.test.ts (24).** There are three kinds of failure:
   - **Form date given as N-N-N where null is expected (2 rows).** Both are RELATIVE_DATE_READER: "today" is written as today's ISO date (2026-09-09, the test's today). Same date, so skipped as benign.
   - **NAME_QUESTION_ONLY (14 rows).** Pins.
   - **CA_SALES_POLICY (7 rows).** 5 are the Club Close live defect above; the other 2 are pins.
   - **Remaining row.** NAME_BEFORE_TITLE (1) is a "flag off" pin.
3. **"Who is this form for?" instead of "I can help you create a Corrective Action Form".** The cause is NAME_QUESTION_ONLY_ENABLED (Pau 26 Oct, "never a list") in every case. Rows: corrective-action-conversation ×7 "the form's name on its own", plus 3, 2 and 2 more in the same file, corrective-action-intake ×3, form-proposal ×2. All are pins. One note: a manager who says "guide me through it" now gets one question at a time.
4. **reopen-request.test.ts (12; the value "show" received instead of null).** The cause is REOPEN_BY_ANY_OPEN_VERB_ENABLED alone; all 12 are pins. The 9 "off:" rows are flag-off pins. The 3 "on:" rows fail on their first line, which asserts the flag-off `null` before the test stubs the flag on.
5. **pm-framework-readiness (18; QA counted 9 of 18 as non-pins).** The cause is FRAMEWORK_UNPIN_ENABLED alone; all 18 are pins. QA (25 Oct) turned it on because the framework text carries the sibling company's content. With it on, governed forms are drafted without the framework and its absence no longer withholds a draft. Side note: the CA drafting prompt still describes prior_actions as "with the date it was signed". That is the form field's own label text, not a "— signed <date>" instruction.

### What I could not get to

- **Coverage.** Group-ddmin attribution covers 24 files (330 tests). The prior-actions file was also read per test. The other 217 files (roughly 482 failing tests) were **not read**; they are listed at the end with their counts.
- **Why.** Each e2e file takes 30–90 s per run, and a ddmin needs 15–40 runs, so the whole list would have taken days. The background queue was still running when I stopped.
- **pm-draft-route.test.ts and pm-draft-route.single-writer.test.ts (27 each).** The diffs were read but not bisected. They look like FRAMEWORK_UNPIN (no framework read), DRAFT_NEVER_BLANK (3 model calls instead of 1: the test's fake tool input reads as empty, so the draft is retried — a harness artefact), CA_SALES_POLICY / STALE_PROMPT_LINES_OFF (no under_performance box), PRIOR_ACTIONS_NO_SIGNED and HIDE_NO_POLICY_MATCH_NOTICE. These are inferred, not attributed.
- **Ask Sunny.** I did not check Ask Sunny for the five defects. `step-sentence-dates.ts`, `chat-correction.ts`/`ca-action-plan-sync.ts` and the date rules are "same flag in both apps" ports, so the defects there are likely the same.


## Tables, one per file (attributed files, most failures first)

### src/lib/forms/prior-actions.test.ts

Prod failing 33 (QA 33). Per-test ddmin; each listed set is independently sufficient.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| the list holds several entries, each with its date keeps every entry the draft wrote from the manager's words | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the list holds several entries, each with its date adds a step the manager dated that the draft left out | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the list holds several entries, each with its date lists the manager's dated steps when the draft wrote nothing | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the list holds several entries, each with its date lets a dated step win over a None the draft also wrote | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the two revision-4 lines, read as one entry combines what was recorded with the date | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the two revision-4 lines, read as one entry keeps either half alone | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the two revision-4 lines, read as one entry writes dates the way the business writes them | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the history reads oldest first, as the manager described it puts the steps in date order whatever order the draft wrote them | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the history reads oldest first, as the manager described it files a step the draft left out in its place in the history, not at the end | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the history reads oldest first, as the manager described it keeps the date the manager gave, and the draft's own description of the step | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the history reads oldest first, as the manager described it carries what the manager said a step was for when code adds the line | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the history reads oldest first, as the manager described it adds no description the manager did not give | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the history reads oldest first, as the manager described it puts lines with no date after the dated history, in the order written | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| no invented history replaces an upgraded step with the one the manager named for that day | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| no invented history removes an undated step the manager never mentioned | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| an earlier step is never dated in the future reads a December step, mentioned in January, as last year's | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| an earlier step is never dated in the future keeps the model's correctly-dated line for that step | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| an earlier step is never dated in the future keeps a year the manager typed, as typed | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled earlier step is listed with what it was about create verbal CA for remy calder for violating visitors at work policy on 10-10-26. previous coaching was jba policy manual 1-1-26 | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled earlier step is listed with what it was about create ca form for tess varga for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled earlier step is listed with what it was about register shortage on 10-20-26. previous coaching - jba policy manual 1-20-26. | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled earlier step is listed with what it was about late again on 10/20. prior CA 9/1 | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled history list is listed item by item the production request lists both steps | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled history list is listed item by item previous coaching: verbal ca 9-1-26 | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled history list is listed item by item prior actions: written warning 8/2/26 | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled history list is listed item by item previous coaching: policy acknowledgement 1-1-26 | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled history list is listed item by item previous CA: written ca 8/2/26 | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled history list is listed item by item previous coaching: written warning tardiness 8/2/26 | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled history list is listed item by item lists every item oldest first, whatever order they were written in | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a labelled history list is listed item by item keeps the draft's verbal warning on the day the manager said a verbal CA was given | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a history list without a colon lists an item that names its own step | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| a history list without a colon does not take an incident date after it as history | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED ; or PRIOR_ACTIONS_PARSE_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |
| the forms already on file are listed too keeps the manager's own words for a step they dated, and adds the rest | pin | PRIOR_ACTIONS_NO_SIGNED_ENABLED | Received has no "signed" ("Verbal warning — 09/21/2026"; "JBA Manual" read as "JBA Policy Manual"); QA/Pau 5 Nov rule: never "signed" unless the manager or record says so (NO_SIGNED, on round 4); PARSE: no word the manager did not say. |  |

### src/app/api/forms/corrective-action-dm-feedback-e2e.test.ts

Prod failing 30 (QA 30); bare 0. Minimal flag set: STALE_PROMPT_LINES_OFF_ENABLED, ACTION_PLAN_SENTENCES_ENABLED, ATTENDANCE_ACTION_PLAN_ENABLED, DRAFT_NEVER_BLANK_ENABLED, PRIOR_ACTIONS_PARSE_ENABLED. 23 test(s) also fail through other production flags (more than one cause).

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| previous coaching stated in chat is not offered as the form's date, is read back, and fills the prior-actions line | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| previous coaching stated in chat "jba manual 1-1-26 for previous coaching" — the date first, the label after | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| previous coaching stated in chat "previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26" — every item of the list is history | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| a payroll deduction with an amount is read as Yes, not asked, and the Action Plan states the amount before the closing | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| a payroll deduction with an amount "payroll deduct applies and $3.25 will be deducted from check" says the same | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| a payroll deduction with an amount with no amount stated, says a deduction applies and invents no figure | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| a payroll deduction with an amount says nothing about pay when payroll deduct is No | unsure | ATTENDANCE_ACTION_PLAN_ENABLED | "…for violating attendance policy on 10-20-26…" (no lateness said) gets Pau's lateness plan "arrive on time … Continued lateness …". | Plan asserts lateness the manager never described. Low. Possible fix: default-off ATTENDANCE_PLAN_NEEDS_LATENESS_ENABLED - use attendanceActionPlan only when the account matches LATENESS (attendance-action-plan.ts), as MEETING/MISSED_SHIFT already carve out. |
| F: a late opening with a payroll deduction dates the form 10-1-26, reads Verbal, the history and the $25, and the Action Plan states the $25 | pin | ACTION_PLAN_SENTENCES_ENABLED + PRIOR_ACTIONS_PARSE_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| F: a late opening with a payroll deduction a late arrival that is not an opening stays the Tardiness box alone | pin | ATTENDANCE_ACTION_PLAN_ENABLED | Pau 26 Oct: an Attendance-policy CA gets her attendance plan. Test expects the general plan. |  |
| F: a late opening with a payroll deduction with no amount stated, states the $25.00 the quoted Late Opening section gives | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| F: a late opening with a payroll deduction a late arrival cites Attendance alone, and the plan invents no figure | pin | ACTION_PLAN_SENTENCES_ENABLED + ATTENDANCE_ACTION_PLAN_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. Pau 26 Oct: an Attendance-policy CA gets her attendance plan. Test expects the general plan. |  |
| G: a meeting not attended is cited where the manual puts it reads Attendance from the manual, says why, and the draft ticks Absenteeism over the model's Standards of Conduct | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| G: a meeting not attended is cited where the manual puts it where the manual does not say, it is still Attendance — and the form says so | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct: the 21 Oct missed-meeting request, created, reopened and finalized fills every section it was told, invents none it was not, and finalizes without an override | pin | ATTENDANCE_ACTION_PLAN_ENABLED + PRIOR_ACTIONS_PARSE_ENABLED | Pau 26 Oct: an Attendance-policy CA gets her attendance plan. Test expects the general plan. Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct: short answers and corrections keep the account "verbal please" after the request fills the level and keeps every other fact | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct: short answers and corrections keep the account written → actually verbal before the draft: the correction wins, nothing else is lost | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct: answers given one at a time while the card is open records which turns the intake takes, and the final card holds every answer | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct: corrections while the card is open, before Create every turn updates the same card, the latest answer wins, and nothing earlier is lost | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form Hey, I need to document a written warning for Tess Varga — she didn't show for our 10/20/26 staff meeting. No deduction from her pay. She got coached on the handbook back on 1/1/26. | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form tess varga — no call to the 10/20/26 manager meeting, issue a verbal, previously verbally warned 9/1/26, payroll not applicable | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form Can we put Tess Varga on a written for skipping the 10/20/26 meeting? She's had a verbal before on 9/1/26. Don't deduct. | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form I have to write someone up ⏎ Tess Varga ⏎ she skipped the monthly meeting on 10/20/26 ⏎ written ⏎ she had coaching on the jba manual 1/1/26 and a verbal ca 9/1/26 ⏎ no deduction | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form need a CA for tess varga for missing the 10/20/26 meeting, verbal ⏎ sorry, make that written ⏎ wait, the meeting was 10/19/26 ⏎ she was coached 1-1-26 on the jba manual ⏎ payroll deduct n/a | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form Tess Varga missed our team meeting yesterday 10/21/26 without telling anyone. I want to give her a written. No payroll deduction. She was coached on attendance 8/15/26. | skipped | RELATIVE_DATE_READER_ENABLED (+ prior-actions pins later in the test) | proposal.formDate null for "missed our team meeting yesterday 10/21/26" (expected 2026-10-21). | Looks wrong (an explicit date next to "yesterday" is lost), but it is the RELATIVE_DATE_READER family: hand to that session. |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form Please document a written CA for Remy Calder — she didn't finish her Woven modules by the 10/12/26 deadline. She got a verbal for the same thing 9/10/26. No deduction. | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form tess varga needs a write up ⏎ she bailed on the 10/19/26 meeting ⏎ make it a written warning ⏎ oh and she had a verbal 9/2/26 ⏎ payroll no | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form Remy Calder - CA - written - no call no show to manager meeting 10/13/26 - payroll deduction no - prior coaching 7/1/26 | live defect | CA_SHORTCUT_WORDS_ENABLED + STEP_DATE_NOT_INCIDENT_ENABLED + STEP_DATES_NOT_FORM_DATE_ENABLED (all three needed; dropping any one restores 10/13) | "Remy Calder - CA - written - no call no show to manager meeting 10/13/26 - payroll deduction no - prior coaching 7/1/26": one sentence (no full stop); STEP_SHORTHAND matches "coaching 7/1", so stepSentenceDates marks EVERY date in the sentence, 10/13/26 included, as a step date; then all dates are step dates and the form is dated today. | The card/form date is today, not the 10/13/26 incident the manager typed. Fix: new default-off STEP_SHORTHAND_OWN_DATE_ENABLED - in forms/step-sentence-dates.ts, when only the shorthand fired, add just the date(s) STEP_SHORTHAND matched, not datesInText(sentence). (Same file in Ask Sunny; check there.) |
| CA_SALES_POLICY_ENABLED: the Corrective Action draft's added lines off: neither line is in the draft's prompt (as before) | pin | STALE_PROMPT_LINES_OFF_ENABLED | Round 4: revision 7 has no under_performance box, so its prompt lines go; test expects them in the prompt. |  |
| CA_SALES_POLICY_ENABLED: the Corrective Action draft's added lines on: the form has no under_performance box, so sales results read as standards_of_conduct; the Corrective Action line follows the lowest-rung rule | pin | STALE_PROMPT_LINES_OFF_ENABLED | Round 4: revision 7 has no under_performance box, so its prompt lines go; test expects them in the prompt. |  |
| STALE_PROMPT_LINES_OFF_ENABLED: the draft's lines about boxes revision 7 does not have on: only those two lines go (the prompt with them put back is the prompt with the flag off) | pin | DRAFT_NEVER_BLANK_ENABLED | Draft retries/reads the tool call in any shape; test pins flag-off counts. |  |

### src/app/api/chat/prior-sentence-fix-live-e2e.test.ts

Prod failing 28 (QA 28); bare 0. Minimal flag set: SALES_OBSERVATION_ACCOUNT_ENABLED, SALES_SHORTFALL_OBJECT_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| full remap off (production) production env, flag off, D3 unset: as main D2 | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 unset: as main TWO | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 unset: as main THREE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 unset: as main RANGE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 unset: as main ONE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 unset: as main OTHER_IN_LIST | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 unset: as main COWORKER | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 on: as main D2 | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 on: as main TWO | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 on: as main THREE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 on: as main RANGE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 on: as main ONE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 on: as main OTHER_IN_LIST | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap off (production) production env, flag off, D3 on: as main COWORKER | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 unset: as main D2 | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 unset: as main TWO | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 unset: as main THREE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 unset: as main RANGE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 unset: as main ONE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 unset: as main OTHER_IN_LIST | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 unset: as main COWORKER | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 on: as main D2 | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 on: as main TWO | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 on: as main THREE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 on: as main RANGE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 on: as main ONE | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 on: as main OTHER_IN_LIST | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |
| full remap on (not production, extra coverage) production env, flag off, D3 on: as main COWORKER | pin | SALES_OBSERVATION_ACCOUNT_ENABLED + SALES_SHORTFALL_OBJECT_ENABLED | QA 7 Nov: the Issue/account loses the request's head ("create a ca for <name> at <store>,"). Received observation is the account without the request clause; tests are named "flag off ... as main". Needed with SALES_OBSERVATION_ACCOUNT (that flag acts only with this one): QA 6-7 Nov sales-shortfall reading. |  |

### src/app/api/forms/draft-never-blank-oct26-e2e.test.ts

Prod failing 26 (QA 26); bare 0. Minimal flag set: FRAMEWORK_UNPIN_ENABLED, FORM_EDIT_SINGLE_WRITER_ENABLED. 3 test(s) also fail through other production flags (more than one cause).

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| 'lowercase, no call no show' flag off: today's behaviour, pinned an empty tool call is filed blank, recorded as drafted with no fields and nothing rejected | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'lowercase, no call no show' flag off: today's behaviour, pinned a JSON-encoded `values` is dropped without a word: blank | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'lowercase, took product' flag off: today's behaviour, pinned an empty tool call is filed blank, recorded as drafted with no fields and nothing rejected | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'lowercase, took product' flag off: today's behaviour, pinned a JSON-encoded `values` is dropped without a word: blank | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'sentence case, no call no show (the t…' flag off: today's behaviour, pinned an empty tool call is filed blank, recorded as drafted with no fields and nothing rejected | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'sentence case, no call no show (the t…' flag off: today's behaviour, pinned a JSON-encoded `values` is dropped without a word: blank | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'sentence case, took product' flag off: today's behaviour, pinned an empty tool call is filed blank, recorded as drafted with no fields and nothing rejected | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'sentence case, took product' flag off: today's behaviour, pinned a JSON-encoded `values` is dropped without a word: blank | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'sentence case with the name lowercase…' flag off: today's behaviour, pinned an empty tool call is filed blank, recorded as drafted with no fields and nothing rejected | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'sentence case with the name lowercase…' flag off: today's behaviour, pinned a JSON-encoded `values` is dropped without a word: blank | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'lowercase with the name Capitalized, …' flag off: today's behaviour, pinned an empty tool call is filed blank, recorded as drafted with no fields and nothing rejected | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| 'lowercase with the name Capitalized, …' flag off: today's behaviour, pinned a JSON-encoded `values` is dropped without a word: blank | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| the governing framework's read fails flag off: withheld, with no event | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| the governing framework's read fails flag on: read again after 1 s and 3 s; still failing, withheld with the reason recorded | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| the time budget (80 s from the request's start) a framework read that fails after 81 s is not read again | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| six Create presses at once (the production burst) flag off: the ones the model left blank are filed blank, as on main | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| an account told as what did not happen 'lowercase, never (store)' flag off: filed blank, as on main | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| an account told as what did not happen 'Sentence case, never (store)' flag off: filed blank, as on main | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| an account told as what did not happen 'lowercase, never (salon)' flag off: filed blank, as on main | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| an account told as what did not happen 'Sentence case, never (salon)' flag off: filed blank, as on main | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| an account told as what did not happen 'lowercase, did not (no state: "<store…' flag off: filed blank, as on main | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| an account told as what did not happen 'Sentence case, didn\'t' flag off: filed blank, as on main | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| an account told as what did not happen 'lowercase, no call' flag off: filed blank, as on main | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| flag off is byte-identical to main filled | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| flag off is byte-identical to main empty | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| flag off is byte-identical to main malformed | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |

### src/lib/ai/corrective-action-conversation.test.ts

Prod failing 24 (QA 24); bare 0. Minimal flag set: CA_SALES_POLICY_ENABLED, NAME_QUESTION_ONLY_ENABLED, RELATIVE_DATE_READER_ENABLED, NAME_BEFORE_TITLE_ENABLED. 1 test(s) also fail through other production flags (more than one cause).

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| the form's name on its own corrective action opens the Corrective Action Form without asking which form | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the form's name on its own Corrective Action opens the Corrective Action Form without asking which form | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the form's name on its own CA opens the Corrective Action Form without asking which form | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the form's name on its own ca opens the Corrective Action Form without asking which form | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the form's name on its own Ca opens the Corrective Action Form without asking which form | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the form's name on its own CA form opens the Corrective Action Form without asking which form | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the form's name on its own corrective-action form opens the Corrective Action Form without asking which form | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the form's name on its own still holds §7: a metric alone gets the progression, however the form is named | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |
| a metric on its own is answered with the progression does not open a Corrective Action Form off a low Club Close | live defect | CA_SALES_POLICY_ENABLED (fix flag FORM_NAME_FROM_ROSTER is off) | "Their Club Close is low. Create a corrective action." -> "I'll draft a **Corrective Action Form** for **Club Close**", action plan "…with Club", asks Club Close's job title. | A card for an employee called "Club Close" (a metric). Sales CAs are wanted (pin for the CA itself) but the metric must not be the employee. Fix: new default-off METRIC_ALONE_NOT_A_NAME_ENABLED - in the name reader (form-proposal / grounded-entities), a candidate that is a metric term (glossary/metric list, or "<X> is low/down/%") is never the employee even with no roster name beside it; ask "Who is this form for?". FORM_NAME_FROM_ROSTER's guard only covers metrics beside a roster name. |
| a metric on its own is answered with the progression holds even when the manager names the form | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |
| a metric on its own is answered with the progression maps each rung to the real form that records it, and says which rungs have none | live defect | CA_SALES_POLICY_ENABLED | Same reply as the Club Close row (a CA for **Club Close**). | See Club Close row. |
| a metric on its own is answered with the progression says why, and still answers the question it can answer | live defect | CA_SALES_POLICY_ENABLED | Same Club Close reply. | See Club Close row. |
| a metric on its own is answered with the progression shows the sequence again as soon as the framework answers | live defect | CA_SALES_POLICY_ENABLED | Same Club Close reply. | See Club Close row. |
| a metric on its own is answered with the progression names the EPPs from the library rather than from a list in the code | live defect | CA_SALES_POLICY_ENABLED | Same Club Close reply. | See Club Close row. |
| the fast path — a draft from what the manager already said 3. asks for what is missing when the form is named and nothing else is said | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the fast path — a draft from what the manager already said walks a manager through what is still missing when they ask to be led | pin (unsure) | NAME_QUESTION_ONLY_ENABLED | "guide me through it" / "step by step" now gets only the name question; consistent with Pau's "never a list", but a manager who asked to be led gets one question at a time. |  |
| the fast path — a draft from what the manager already said recognises the ask to be led — corrective action form — what do you need from me? | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the fast path — a draft from what the manager already said recognises the ask to be led — create a corrective action, guide me through it | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the fast path — a draft from what the manager already said recognises the ask to be led — corrective action form, step by step please | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| the form date, from the request or from a follow-up answer carries no date when the manager said only "today", so the form keeps its default | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| the payroll-deduct question takes the numbered answer to the intake | pin | NAME_QUESTION_ONLY_ENABLED | Answers a numbered intake that production no longer shows (opening is the one name question). |  |
| the payroll-deduct question on a form that does not ask it yet is left out of the opening intake | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| a form's name leading the message, across the library create ca for marlowe co she was late today, got verbal warning on september 21 | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| 'ca for <name>, team member at <store>' flag off, as on main: the lowercase name is not read | pin | NAME_BEFORE_TITLE_ENABLED | Test named "flag off, as on main: the lowercase name is not read"; with the flag the lowercase name is read. |  |

### src/app/api/forms/pm-framework-readiness.integration.test.ts

Prod failing 18 (QA 18); bare 0. Minimal flag set: FRAMEWORK_UNPIN_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| without the framework in the knowledge base 'dpoa' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| without the framework in the knowledge base 'policy-review' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| without the framework in the knowledge base 'follow-up-coaching' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| without the framework in the knowledge base 'sdit-epp' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| without the framework in the knowledge base 'tsd-epp' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| without the framework in the knowledge base 'asd-sdit-epp' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| without the framework in the knowledge base 'fttc-epp' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| without the framework in the knowledge base 'dmit-epp-tsd' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| without the framework in the knowledge base 'dmit-epp-dmit' fails closed: no AI draft, the blank form stays editable | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'dpoa' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'policy-review' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'follow-up-coaching' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'sdit-epp' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'tsd-epp' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'asd-sdit-epp' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'fttc-epp' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'dmit-epp-tsd' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |
| with the framework installed, identified by its tag 'dmit-epp-dmit' is drafted, with every required group of the framework given to the model | pin | FRAMEWORK_UNPIN_ENABLED | QA 25 Oct: framework text carries the sibling company's examples, so it is not read or pinned and its absence no longer withholds a draft. Test expects fail-closed / pinned framework. |  |

### src/features/chat/import-every-role.dom.test.tsx

Prod failing 17 (QA 17); bare 0. Minimal flag set: NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| signed in as employee sees Import in History, opens it, and imports through the one existing path | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as employee still has Import after choosing Not now on the prompt | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as assistant_manager sees Import in History, opens it, and imports through the one existing path | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as assistant_manager still has Import after choosing Not now on the prompt | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as location_manager sees Import in History, opens it, and imports through the one existing path | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as location_manager still has Import after choosing Not now on the prompt | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as district_manager sees Import in History, opens it, and imports through the one existing path | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as district_manager still has Import after choosing Not now on the prompt | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as regional_manager sees Import in History, opens it, and imports through the one existing path | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as regional_manager still has Import after choosing Not now on the prompt | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as admin sees Import in History, opens it, and imports through the one existing path | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as admin still has Import after choosing Not now on the prompt | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as owner sees Import in History, opens it, and imports through the one existing path | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as owner still has Import after choosing Not now on the prompt | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as developer sees Import in History, opens it, and imports through the one existing path | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| signed in as developer still has Import after choosing Not now on the prompt | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| Import of a chat that belongs to another account says the chat belongs to another account and was not imported | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |

### src/lib/ai/store-woven-form-flow.test.ts

Prod failing 15 (QA 15); bare 0. Minimal flag set: GLOBAL_STORE_ASK_ENABLED, TYPED_NAME_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| the expected outcome: a form from a code and a name a first name alone is confirmed against Woven, not guessed | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| 1–6. every way of naming the store reaches the same record 5/6. a typo or an abbreviation is asked about, never used silently | pin | GLOBAL_STORE_ASK_ENABLED | Doc: one in-scope store typo is used and not asked again. |  |
| 7. the job title is Woven's replaces the title the manager's wording implied | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| 10. Woven has no matching employee keeps the typed name, says it is unverified, and fills no title | unsure | TYPED_NAME_ENABLED | No employeeVerification {status:'unverified', reason:'not_found'} on the proposal; whether the card still says the name is unverified was not checked. |  |
| 8. conversational follow-ups 'yes' to 'is that the store?' uses the store that was proposed | pin | GLOBAL_STORE_ASK_ENABLED | Doc: one in-scope store typo is used and not asked again. |  |
| 5. every HR form type reads the store and verifies the employee the same way sdit-epp: store resolved, Woven title and verification | live defect | TYPED_NAME_ENABLED | "Create an SDIT EPP for Sarah Miller at Store 236" -> employeeRole "SDIT" (Woven verified "Production Associate"): statedJobTitle reads the form's own name as the employee's title, and TYPED_NAME lets a stated title beat Woven. | Card/form Job Title says "SDIT"/"TSD" (the program's name) instead of the employee's Woven position, with no "from Woven" note. Fix: new default-off FORM_NAME_NOT_A_TITLE_ENABLED - in statedJobTitle (and form-proposal.ts:1056/1309) ignore a title word that is part of the requested template's name (SDIT/TSD/DMIT/ASD ... EPP). |
| 5. every HR form type reads the store and verifies the employee the same way tsd-epp: store resolved, Woven title and verification | live defect | TYPED_NAME_ENABLED | Same as sdit-epp: "TSD EPP" -> Job Title "TSD". | See sdit-epp row. |
| 5. every HR form type reads the store and verifies the employee the same way demotion: store resolved, Woven title and verification | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| 5. every HR form type reads the store and verifies the employee the same way the title Woven holds replaces the one the manager gave as the employee's current title | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| a Woven job title is never mistaken for another employee Create a corrective action form for Sarah Miller (Team Member Part Time) at Store 236 | unsure | TYPED_NAME_ENABLED | Typed "(Team Member Part Time)" wins over Woven (intended) but is cut to "Team Member". | Minor: the stated title is truncated. Check statedJobTitle's title list. |
| names, stores and titles are read in any case — lower, UPPER or Mixed sdit-epp — lower case | live defect | TYPED_NAME_ENABLED | "Create an SDIT EPP for Sarah Miller at Store 236" -> employeeRole "SDIT" (Woven verified "Production Associate"): statedJobTitle reads the form's own name as the employee's title, and TYPED_NAME lets a stated title beat Woven. | Card/form Job Title says "SDIT"/"TSD" (the program's name) instead of the employee's Woven position, with no "from Woven" note. Fix: new default-off FORM_NAME_NOT_A_TITLE_ENABLED - in statedJobTitle (and form-proposal.ts:1056/1309) ignore a title word that is part of the requested template's name (SDIT/TSD/DMIT/ASD ... EPP). |
| names, stores and titles are read in any case — lower, UPPER or Mixed sdit-epp — UPPER case | live defect | TYPED_NAME_ENABLED | "Create an SDIT EPP for Sarah Miller at Store 236" -> employeeRole "SDIT" (Woven verified "Production Associate"): statedJobTitle reads the form's own name as the employee's title, and TYPED_NAME lets a stated title beat Woven. | Card/form Job Title says "SDIT"/"TSD" (the program's name) instead of the employee's Woven position, with no "from Woven" note. Fix: new default-off FORM_NAME_NOT_A_TITLE_ENABLED - in statedJobTitle (and form-proposal.ts:1056/1309) ignore a title word that is part of the requested template's name (SDIT/TSD/DMIT/ASD ... EPP). |
| names, stores and titles are read in any case — lower, UPPER or Mixed tsd-epp — lower case | live defect | TYPED_NAME_ENABLED | Same as sdit-epp: "TSD EPP" -> Job Title "TSD". | See sdit-epp row. |
| names, stores and titles are read in any case — lower, UPPER or Mixed tsd-epp — UPPER case | live defect | TYPED_NAME_ENABLED | Same as sdit-epp: "TSD EPP" -> Job Title "TSD". | See sdit-epp row. |
| names, stores and titles are read in any case — lower, UPPER or Mixed a title typed in lower case is still a title, and Woven's still wins | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |

### src/app/api/chat/qa-oct21-audit-e2e.test.ts

Prod failing 13 (QA 13); bare 0. Minimal flag set: PLAN_PAYROLL_SENTENCE_ENABLED, ACTION_PLAN_SENTENCES_ENABLED. 13 test(s) also fail through other production flags (more than one cause).

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| Issue 1: a late opening on 10-1-26 with a $25 payroll deduction the production conversation: dated 10-1-26, Verbal, $25 Yes, Late Opening p.15 quoted, $25 in the plan | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 1: a late opening on 10-1-26 with a $25 payroll deduction "payroll deduct DOES apply and state $25 will be payroll deducted" is a Yes, and the plan states $25 | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 1: a late opening on 10-1-26 with a $25 payroll deduction "$25 will be deducted from her check" is a Yes, and the plan states $25 | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 1: a late opening on 10-1-26 with a $25 payroll deduction "payroll deduct 25 dollars" is a Yes, and the plan states $25 | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 1: a late opening on 10-1-26 with a $25 payroll deduction "payroll deduction of $25.00 applies" is a Yes, and the plan states $25.00 | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 1: a late opening on 10-1-26 with a $25 payroll deduction "payroll deduct applies" is a Yes, and the plan states $25.00 | pin | ACTION_PLAN_SENTENCES_ENABLED / PAYROLL_DEDUCT_AMOUNT_ENABLED | No amount stated -> plan states none (two-sentence plan; PLAN_PAYROLL_SENTENCE only states a manager's amount). Old test wanted the policy's $25.00. |  |
| Issue 4: a $3.25 payroll deduction reaches the Action Plan the production conversation: Yes read, not asked; the plan states $3.25 exactly | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 4: a $3.25 payroll deduction reaches the Action Plan "payroll deduct of $3.25 is applicable" → yes, and the plan states $3.25 | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 4: a $3.25 payroll deduction reaches the Action Plan "payroll deduct applies and $3.25 will be deducted from check" → yes, and the plan states $3.25 | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 4: a $3.25 payroll deduction reaches the Action Plan "deduct $3.25 from her paycheck" → yes, and the plan states $3.25 | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 4: a $3.25 payroll deduction reaches the Action Plan "she will be payroll deducted 3.25" → yes, and the plan states $3.25 | pin | ACTION_PLAN_SENTENCES_ENABLED | Doc: the CA plan is exactly two sentences (+ PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $X."). Test expects old "$X will be deducted from <name>'s pay." / a deduction sentence without a manager-stated amount. |  |
| Issue 4: a $3.25 payroll deduction reaches the Action Plan after the form exists: the amount changed, then cancelled, then restored — the plan follows each time and nothing else moves | live defect | ACTION_PLAN_SENTENCES_ENABLED or PAYROLL_DEDUCT_AMOUNT_ENABLED (each alone) | After Create, "change the payroll deduction to $5.00" replies "The Action Plan now states the payroll deduction." but the saved plan has no deduction (the $3.25 sentence is also gone). chat-correction.ts calls syncPlan without amountSentence, so collapseToTwoSentences drops the sentence. | Manager is told the plan states the deduction; the form's Action Plan says nothing about it. Fix: new default-off CORRECTION_PLAN_KEEPS_AMOUNT_ENABLED - pass amountSentence: true from both syncPlan calls in forms/chat-correction.ts (the writer syncPlan rule ~l.516 and the unchanged-answer path ~l.537), as form-edit-tool/form-patch-turn/reducer already do; and only say "now states" when the written plan contains the amount. |
| workflow: corrections change only what was asked; finalized forms are never changed silently repeating an answer already on the form changes nothing | live defect | PLAN_PAYROLL_SENTENCE+ACTION_PLAN_SENTENCES, or FORM_PATCH_REDUCER+PAYROLL_DEDUCT_AMOUNT | Repeating an answer already on the form removes "Marlo will be payroll deducted $25." from the Action Plan. | A no-op answer silently drops the deduction sentence from a draft's plan. Same root and fix as the $5.00 row. |

### src/lib/forms/form-date-incident-only.test.ts

Prod failing 12 (QA 12); bare 0. Minimal flag set: FORM_EDIT_DATE_RULES_ENABLED, RELATIVE_DATE_READER_ENABLED, PRIOR_ACTIONS_PARSE_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| FORM_DATE_INCIDENT_ONLY_ENABLED: the form's date is never a deadline, assignment or prior-action date off, main's reading is unchanged (the reported failures) | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| FORM_DATE_INCIDENT_ONLY_ENABLED: the form's date is never a deadline, assignment or prior-action date "today" with prior actions in parentheses asks no "which date?" and takes today | skipped | RELATIVE_DATE_READER_ENABLED + PRIOR_ACTIONS_PARSE_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| NEVER-BREAK: a stated incident date is the form's date, flag on or off flag off | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| NEVER-BREAK: a stated incident date is the form's date, flag on or off flag on | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| FORM_DATE_INCIDENT_ONLY_ENABLED in the managers' register: all lowercase flag on: no deadline, assignment or prior-action date is the form's date | skipped | RELATIVE_DATE_READER_ENABLED + PRIOR_ACTIONS_PARSE_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| FORM_DATE_INCIDENT_ONLY_ENABLED in the managers' register: sentence case flag on: no deadline, assignment or prior-action date is the form's date | skipped | RELATIVE_DATE_READER_ENABLED + PRIOR_ACTIONS_PARSE_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| live tester findings, 26 Oct 2026 (all lowercase) off: the first late date stands alone, and the prior verbal dates the remap (the reported failures) | pin | FORM_EDIT_DATE_RULES_ENABLED | Doc: a prior action's date is never the form's Date; "today" dates the form today. |  |
| live tester findings, 26 Oct 2026 (all lowercase) NEVER-BREAK (flag off): "i gave her a verbal on 10-21 for being late" dates the form 10-21 | live defect | FORM_EDIT_DATE_RULES_ENABLED (dropping it alone restores 10-21) | First line ("write up ava pellmore, i gave her a verbal on 10-21 for being late" -> null) is arguable: the verbal can be read as a prior step. But the second line, "verbal for ava pellmore, gave her a verbal on 10-21 for being late on 10-21", states the incident date and also loses it (probe: remap null with prod flags, 2026-10-21 without FORM_EDIT_DATE_RULES); so does "ca for ava pellmore, she was late on 10-21 and i gave her a verbal on 10-21". | The card/form is dated today instead of the 10/21 incident the manager typed, whenever a step was given on the same day as the incident. Fix: new default-off INCIDENT_DATE_SHARED_WITH_STEP_ENABLED - in the remap/date readers (FORM_EDIT_DATE_RULES' step-date exclusion, forms/form-date-answer.ts heldStepSpans / ai/form-full-remap.ts), drop a step's date only when no incident cue ("late on", "was late", "on <date> she …") also governs that same date. |
| live tester findings, 26 Oct 2026 (all lowercase) NEVER-BREAK (flag on): "i gave her a verbal on 10-21 for being late" dates the form 10-21 | live defect | FORM_EDIT_DATE_RULES_ENABLED (dropping it alone restores 10-21) | First line ("write up ava pellmore, i gave her a verbal on 10-21 for being late" -> null) is arguable: the verbal can be read as a prior step. But the second line, "verbal for ava pellmore, gave her a verbal on 10-21 for being late on 10-21", states the incident date and also loses it (probe: remap null with prod flags, 2026-10-21 without FORM_EDIT_DATE_RULES); so does "ca for ava pellmore, she was late on 10-21 and i gave her a verbal on 10-21". | The card/form is dated today instead of the 10/21 incident the manager typed, whenever a step was given on the same day as the incident. Fix: new default-off INCIDENT_DATE_SHARED_WITH_STEP_ENABLED - in the remap/date readers (FORM_EDIT_DATE_RULES' step-date exclusion, forms/form-date-answer.ts heldStepSpans / ai/form-full-remap.ts), drop a step's date only when no incident cue ("late on", "was late", "on <date> she …") also governs that same date. |
| live tester findings, 26 Oct 2026 (sentence case) off: the first late date stands alone, and the prior verbal dates the remap (the reported failures) | pin | FORM_EDIT_DATE_RULES_ENABLED | Doc: a prior action's date is never the form's Date; "today" dates the form today. |  |
| live tester findings, 26 Oct 2026 (sentence case) NEVER-BREAK (flag off): "i gave her a verbal on 10-21 for being late" dates the form 10-21 | live defect | FORM_EDIT_DATE_RULES_ENABLED (dropping it alone restores 10-21) | First line ("write up ava pellmore, i gave her a verbal on 10-21 for being late" -> null) is arguable: the verbal can be read as a prior step. But the second line, "verbal for ava pellmore, gave her a verbal on 10-21 for being late on 10-21", states the incident date and also loses it (probe: remap null with prod flags, 2026-10-21 without FORM_EDIT_DATE_RULES); so does "ca for ava pellmore, she was late on 10-21 and i gave her a verbal on 10-21". | The card/form is dated today instead of the 10/21 incident the manager typed, whenever a step was given on the same day as the incident. Fix: new default-off INCIDENT_DATE_SHARED_WITH_STEP_ENABLED - in the remap/date readers (FORM_EDIT_DATE_RULES' step-date exclusion, forms/form-date-answer.ts heldStepSpans / ai/form-full-remap.ts), drop a step's date only when no incident cue ("late on", "was late", "on <date> she …") also governs that same date. |
| live tester findings, 26 Oct 2026 (sentence case) NEVER-BREAK (flag on): "i gave her a verbal on 10-21 for being late" dates the form 10-21 | live defect | FORM_EDIT_DATE_RULES_ENABLED (dropping it alone restores 10-21) | First line ("write up ava pellmore, i gave her a verbal on 10-21 for being late" -> null) is arguable: the verbal can be read as a prior step. But the second line, "verbal for ava pellmore, gave her a verbal on 10-21 for being late on 10-21", states the incident date and also loses it (probe: remap null with prod flags, 2026-10-21 without FORM_EDIT_DATE_RULES); so does "ca for ava pellmore, she was late on 10-21 and i gave her a verbal on 10-21". | The card/form is dated today instead of the 10/21 incident the manager typed, whenever a step was given on the same day as the incident. Fix: new default-off INCIDENT_DATE_SHARED_WITH_STEP_ENABLED - in the remap/date readers (FORM_EDIT_DATE_RULES' step-date exclusion, forms/form-date-answer.ts heldStepSpans / ai/form-full-remap.ts), drop a step's date only when no incident cue ("late on", "was late", "on <date> she …") also governs that same date. |

### src/lib/forms/reopen-request.test.ts

Prod failing 12 (QA 12); bare 0. Minimal flag set: REOPEN_BY_ANY_OPEN_VERB_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: bring up Odalys Fairbank's corrective action is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: bring up an old coaching form for Marisol is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: bring up a previously edited corrective action for Odalys Fairbank is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: bring up a previous corrective action form that i made for Odalys Fairbank earlier today is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: pull up Odalys Fairbank's CA is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: open Odalys Fairbank's corrective action is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: open the CA for Odalys Fairbank is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: open her CA is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it off: open my CA for Odalys Fairbank is not read as a form on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it on: can you find the coaching form for Marisol Quintero → shows the coaching on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it on: find my earlier CA for Odalys Fairbank → shows the dpoa on file | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |
| REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it on: "Change <name> CA" names the Corrective Action Form (sf-s26); off, it names none | pin | REOPEN_BY_ANY_OPEN_VERB_ENABLED | "off:" rows assert null with the flag on; the "on:" rows fail only on their first line, which asserts the flag-off null before stubbing the flag on. |  |

### src/lib/store/chat-history-sync.dom.test.tsx

Prod failing 12 (QA 12); bare 0. Minimal flag set: NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| hydration uploads nothing saves nothing when a browser full of history loads | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| hydration uploads nothing offers the real conversation for import and never the seeded one | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| importing is explicit and one-way sends the eligible conversations only when asked | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| importing is explicit and one-way leaves the local copy exactly where it was | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| importing is explicit and one-way lets an imported conversation sync normally afterwards | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| importing is explicit and one-way stops offering the import once it has run | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| the same account sees the same history merges a conversation created on another browser into this one | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| a server failure never destroys local history keeps every local conversation when the account cannot be read | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| a browser whose clock was wrong cannot defeat Clear History removes it from history, from IndexedDB, and from the import offer | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| a browser whose clock was wrong cannot defeat Clear History does not re-sweep a post-clear conversation on the NEXT load | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| a browser whose clock was wrong cannot defeat Clear History re-arms for a SECOND clear, because the boundary value changes | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |
| a browser whose clock was wrong cannot defeat Clear History suppresses nothing when the account could not be reached | pin | NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED | QA 30 Oct privacy fix: local chats are shown/offered for import only once stamped with this account's key; test fixtures have no owner key. |  |

### src/app/api/chat/turn-lifecycle.test.ts

Prod failing 11 (QA 11); bare 0. Minimal flag set: CHAT_RESPONSE_STREAM_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| the exact production failure cannot happen again a slow turn write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the exact production failure cannot happen again never answers successfully without a turn, at any write latency | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the guarantee holds on every surface, not just the one that broke bed_usage: a cold first write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the guarantee holds on every surface, not just the one that broke main_chat: a cold first write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the guarantee holds on every surface, not just the one that broke overview: a cold first write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the guarantee holds on every surface, not just the one that broke location_performance: a cold first write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the guarantee holds on every surface, not just the one that broke sales_totals: a cold first write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the guarantee holds on every surface, not just the one that broke spa_wellness: a cold first write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the guarantee holds on every surface, not just the one that broke spa_engagement: a cold first write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the guarantee holds on every surface, not just the one that broke google_reviews: a cold first write still yields a rateable answer | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |
| the first answer and the second are now identical both carry a turn, even when only the first write is slow | pin | CHAT_RESPONSE_STREAM_ENABLED | Pau "Go streaming": a slow answer (>2 s) is wrapped as {status, body}; the test reads payload.turnId off the wire envelope (the client unwraps body.turnId). Harness artefact, not a missing turn. |  |

### src/app/api/forms/corrective-action-conversation-qa-e2e.test.ts

Prod failing 11 (QA 11); bare 0. Minimal flag set: FORM_EDIT_SINGLE_WRITER_ENABLED, DRAFT_NEVER_BLANK_ENABLED, PRIOR_ACTIONS_PARSE_ENABLED. 9 test(s) also fail through other production flags (more than one cause).

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| Q1 the original 21 Oct request, as typed is one complete draft: level, history, payroll, the incident's date, and the policy the manual puts it under | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q2 the production failure's shape: the level asked, then one-word answers "written", then "no", keep the account, the history and the date | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q2 the production failure's shape: the level asked, then one-word answers a reload mid-intake, and the same answer twice, lose nothing and add nothing | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q3 where the manual does not settle the policy reads as Attendance without asking; the form ticks Absenteeism and quotes Attendance | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q6 corrections before the draft is created level, incident date and a prior action's date are each corrected, and nothing else moves | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q8 the draft survives reloads, reopening and repeats reopened twice reads the same; a repeated answer after a reload changes nothing; a second press of Create makes no second form | pin | FORM_EDIT_SINGLE_WRITER_ENABLED | Tests are named "flag off: today's behaviour, pinned"; the single writer records drafted events differently. |  |
| Q8 the draft survives reloads, reopening and repeats a redraft keeps what the manager typed | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q11 prior coaching given as a follow-up before the draft: read back, and on the saved form | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q11 prior coaching given as a follow-up after the draft: added to the open form, in date order, never twice, and recorded | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q12 dates corrected after the draft exists a prior action's date, and only that line | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |
| Q15 duplicate Create presses make one record a new card for the same person is a new form | pin | DRAFT_NEVER_BLANK_ENABLED | Draft retries/reads the tool call in any shape; test pins flag-off counts. |  |

### src/features/chat/inline-form.dom.test.tsx

Prod failing 11 (QA 11); bare 0. Minimal flag set: NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| a finalized form renders read-only rather than assuming a draft shows the values and no save control | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| P4. finalizing freezes the version the SERVER holds finalizes once the edit is saved, and freezes the editor | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| P4. a finalized form offers the record, not the editor offers Download PDF, View in Forms Register and Start another | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| P4. a finalized form offers the record, not the editor links the Forms Register at the existing workspace, not a new one | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| P4. a finalized form offers the record, not the editor offers no Save changes or Finalize | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| P4. a finalized form offers the record, not the editor requests the PDF from the canonical endpoint | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| P4. Start another begins a new request, never reusing this one calls back without touching the finalized instance | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| a finalized form is edited as a new draft of it opens a revision and turns the card into that draft, editable | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| a finalized form is edited as a new draft of it saves edits on the new draft, never on the finalized form | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| a finalized form is edited as a new draft of it says a form was replaced once its revision is finalized, and opens the newer version | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |
| a finalized form is edited as a new draft of it moves only its own card's pointer on a message that carried several forms | pin | NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED | Harness artefact: the finalized card now mounts FinalizedChangePanel, whose useMayEditForm calls session.can(); the test's session mock has no can() -> "TypeError: can is not a function" and the card renders empty. |  |

### src/lib/forms/corrective-action-intake.test.ts

Prod failing 9 (QA 9); bare 0. Minimal flag set: CA_SALES_POLICY_ENABLED, NAME_QUESTION_ONLY_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| 3b. a repeated incident and a prior corrective action are different facts does not let repetition turn a metric complaint into conduct | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |
| 4. a metric on its own is not grounds for a corrective action metric only — Their Club Close is low. | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |
| 4. a metric on its own is not grounds for a corrective action metric only — Sarah's conversion is the lowest in the district. | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |
| 4. a metric on its own is not grounds for a corrective action metric only — Her upgrade rate is down again this month. | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |
| 4. a metric on its own is not grounds for a corrective action metric only — His numbers are behind everyone else's. | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |
| 4. a metric on its own is not grounds for a corrective action metric only — She is not hitting her EFTs. | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |
| 5. what Ask Bubbles actually says opens with the form's own name, taken from the library | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| 5. what Ask Bubbles actually says asks the seven questions in the business's own words | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| 5. what Ask Bubbles actually says names the date it would use, and says nothing specific without one | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |

### src/lib/forms/compound-surname.test.ts

Prod failing 8 (QA 8); bare 0. Minimal flag set: ROSTER_COMPOUND_SURNAME_ENABLED, TYPED_NAME_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| ROSTER_COMPOUND_SURNAME_ENABLED off: as before (the bug) a typo in either word of a two-word surname is never close | pin | ROSTER_COMPOUND_SURNAME_ENABLED | Test named "off: as before (the bug)"; flag on in flip 3. |  |
| ROSTER_COMPOUND_SURNAME_ENABLED on: the surname compared word by word a typo in surname word 1 or word 2 (transposed letters), or one word alone with a typo, is close to her | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| ROSTER_COMPOUND_SURNAME_ENABLED on: the surname compared word by word the exact compound name is exact, and one surname word typed exactly is asked, never filled | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| ROSTER_COMPOUND_SURNAME_ENABLED on: the surname compared word by word QA's R3 shape: word 2 with letters 4–6 rotated (Damerau 2) and word 1 exact is close to her, asked, never filled | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| ROSTER_COMPOUND_SURNAME_ENABLED on: the surname compared word by word a single-word surname is unchanged (the flag reads only compound surnames) | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| ROSTER_COMPOUND_SURNAME_ENABLED: compound first names, and an initial of any surname word (QA's roster shapes, 6 Nov 2026) off (the bug): "Rosa Lind T" and "Severin F" match no one, so the card empties | pin | ROSTER_COMPOUND_SURNAME_ENABLED | Test named "off: as before (the bug)"; flag on in flip 3. |  |
| ROSTER_COMPOUND_SURNAME_ENABLED: compound first names, and an initial of any surname word (QA's roster shapes, 6 Nov 2026) on: a two-word first name and an initial is asked; typed in full it is exact; first name alone is asked | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |
| ROSTER_COMPOUND_SURNAME_ENABLED: compound first names, and an initial of any surname word (QA's roster shapes, 6 Nov 2026) on: an initial of the second surname word is asked, never filled | pin | TYPED_NAME_ENABLED | Doc: a typed name is the name on the form; a typed title wins over Woven's (form-proposal.ts:1057/1310). |  |

### src/app/api/chat/actor-authority.test.ts

Prod failing 6 (QA 6); bare 0. Minimal flag set: MODEL_CALL_DAILY_CAP_ENABLED. 6 test(s) also fail through other production flags (more than one cause).

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| 44. the actor comes from the session, never from the body passes the authenticated role and scope | pin | MODEL_CALL_DAILY_CAP_ENABLED | Harness artefact: the spend guard reads chat_traces ("fetch failed" in the test), the mocked route call never happens, so call args are undefined. Other prod flags break the same harness too (redundant). |  |
| 44. the actor comes from the session, never from the body ignores a role and a scope the browser asserts about itself | pin | MODEL_CALL_DAILY_CAP_ENABLED | Harness artefact: the spend guard reads chat_traces ("fetch failed" in the test), the mocked route call never happens, so call args are undefined. Other prod flags break the same harness too (redundant). |  |
| 44. the actor comes from the session, never from the body carries a null scope through rather than inventing one | pin | MODEL_CALL_DAILY_CAP_ENABLED | Harness artefact: the spend guard reads chat_traces ("fetch failed" in the test), the mocked route call never happens, so call args are undefined. Other prod flags break the same harness too (redundant). |  |
| 44. the actor comes from the session, never from the body passes the message id as provenance, bounded and optional | pin | MODEL_CALL_DAILY_CAP_ENABLED | Harness artefact: the spend guard reads chat_traces ("fetch failed" in the test), the mocked route call never happens, so call args are undefined. Other prod flags break the same harness too (redundant). |  |
| whose earlier conversations Bubbles may recall is the session's own subject, never anything the body says | pin | MODEL_CALL_DAILY_CAP_ENABLED | Harness artefact: the spend guard reads chat_traces ("fetch failed" in the test), the mocked route call never happens, so call args are undefined. Other prod flags break the same harness too (redundant). |  |
| whose earlier conversations Bubbles may recall carries this conversation's `conv_*` id, and drops anything else | pin | MODEL_CALL_DAILY_CAP_ENABLED | Harness artefact: the spend guard reads chat_traces ("fetch failed" in the test), the mocked route call never happens, so call args are undefined. Other prod flags break the same harness too (redundant). |  |

### src/app/api/chat/staff-picker-e2e.test.ts

Prod failing 6 (QA 6); bare 0. Minimal flag set: WHOLE_TEAM_COACHING_ENABLED. 3 test(s) also fail through other production flags (more than one cause).

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| "Create a coaching form." → "Who is this form for?" → "for whole staff - associates" (one store) STAFF_PICKER: the store's staff by name and position, who it is for, no card and no model call | pin | WHOLE_TEAM_COACHING_ENABLED | Pau 3 Nov ("I need all managers to have it"): "whole staff" makes the team Coaching card instead of the staff picker. Store scope still enforced (Bellevue refused). |  |
| "can you create a coaching form for my whole staff?" (an account over several stores) STAFF_PICKER: asks which store, never guessing, then lists only that store | pin | WHOLE_TEAM_COACHING_ENABLED | Pau 3 Nov ("I need all managers to have it"): "whole staff" makes the team Coaching card instead of the staff picker. Store scope still enforced (Bellevue refused). |  |
| "can you create a coaching form for my whole staff?" (an account over several stores) STAFF_PICKER: a store-scoped account is never shown another store's staff, even when it names one | pin | WHOLE_TEAM_COACHING_ENABLED | Pau 3 Nov ("I need all managers to have it"): "whole staff" makes the team Coaching card instead of the staff picker. Store scope still enforced (Bellevue refused). |  |
| only a role that may create the form is shown the staff STAFF_PICKER: a location manager is shown the staff | pin | WHOLE_TEAM_COACHING_ENABLED | Pau 3 Nov ("I need all managers to have it"): "whole staff" makes the team Coaching card instead of the staff picker. Store scope still enforced (Bellevue refused). |  |
| STAFF_PICKER_STORE_TITLES: the store's staff, not the office off: every person the directory affiliates with the store, office titles included | pin | WHOLE_TEAM_COACHING_ENABLED | Pau 3 Nov ("I need all managers to have it"): "whole staff" makes the team Coaching card instead of the staff picker. Store scope still enforced (Bellevue refused). |  |
| STAFF_PICKER_STORE_TITLES: the store's staff, not the office on: Team Members and the store's managers only; no title on file is kept | pin | WHOLE_TEAM_COACHING_ENABLED | Pau 3 Nov ("I need all managers to have it"): "whole staff" makes the team Coaching card instead of the staff picker. Store scope still enforced (Bellevue refused). |  |

### src/lib/ai/ca-template-map-f4.test.ts

Prod failing 6 (QA 6); bare 0. Minimal flag set: CA_SALES_POLICY_ENABLED, CA_TEMPLATE_MAP_ENABLED. 4 test(s) also fail through other production flags (more than one cause).

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| CA_TEMPLATE_MAP_ENABLED defaults off and is registered | pin | CA_TEMPLATE_MAP_ENABLED | QA F4: a CA request is the Corrective Action Form in the intent read; tests are "defaults off" / "off, … as QA found". |  |
| CA_TEMPLATE_MAP_ENABLED off, create a Verbal CA for Test Employee keeps no form in the intent read, as QA found | pin | CA_TEMPLATE_MAP_ENABLED | QA F4: a CA request is the Corrective Action Form in the intent read; tests are "defaults off" / "off, … as QA found". |  |
| CA_TEMPLATE_MAP_ENABLED off, create a verbal corrective action keeps no form in the intent read, as QA found | pin | CA_TEMPLATE_MAP_ENABLED | QA F4: a CA request is the Corrective Action Form in the intent read; tests are "defaults off" / "off, … as QA found". |  |
| CA_TEMPLATE_MAP_ENABLED off, write a verbal CA for Team Member keeps no form in the intent read, as QA found | pin | CA_TEMPLATE_MAP_ENABLED | QA F4: a CA request is the Corrective Action Form in the intent read; tests are "defaults off" / "off, … as QA found". |  |
| CA_TEMPLATE_MAP_ENABLED off, I need a CA for someone opening the store late keeps no form in the intent read, as QA found | pin | CA_TEMPLATE_MAP_ENABLED | QA F4: a CA request is the Corrective Action Form in the intent read; tests are "defaults off" / "off, … as QA found". |  |
| CA_TEMPLATE_MAP_ENABLED leaves the other readings alone a metric on its own stays the progression in the intent read | pin | CA_SALES_POLICY_ENABLED | Client request via Pau 4 Nov: sales/metric CAs are drafted under Standards of Conduct, so "a metric alone gets the progression" (metric_only, no card) is superseded. |  |

### src/lib/ai/form-proposal.test.ts

Prod failing 6 (QA 6); bare 0. Minimal flag set: NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED, NAME_QUESTION_ONLY_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| 39. the TEMPLATE's own permission decides, and chat cannot widen it refuses a DPOA to a role that cannot create corrective action | pin | NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED | Pau 30 Oct: Assistant Manager may create the location manager's forms; tests use assistant_manager as the role that cannot create a CA. |  |
| F3. a tampered hint gains nothing is refused when the role could not have asked for that template | pin | NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED | Pau 30 Oct: Assistant Manager may create the location manager's forms; tests use assistant_manager as the role that cannot create a CA. |  |
| RR-F. with a form already established, it continues that one still revalidates the continued key against the role | pin | NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED | Pau 30 Oct: Assistant Manager may create the location manager's forms; tests use assistant_manager as the role that cannot create a CA. |  |
| CA-INTAKE. the opening depends on whether the manager has described anything asks for what is missing when the card is clicked and nothing has been said | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| CA-INTAKE. the opening depends on whether the manager has described anything names the date it would use, rather than saying it would use one | pin | NAME_QUESTION_ONLY_ENABLED | Pau 26 Oct (QA LS-B3): no employee named -> one plain question "Who is this form for? Tell me the employee's full name.", never the numbered list the test expects. |  |
| HIDE. the hiring forms are not offered as choices still refuses one the role cannot create | pin | NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED | Pau 30 Oct: Assistant Manager may create the location manager's forms; tests use assistant_manager as the role that cannot create a CA. |  |

### src/lib/forms/form-date-answer.test.ts

Prod failing 6 (QA 6); bare 0. Minimal flag set: RELATIVE_DATE_READER_ENABLED, PRIOR_ACTIONS_PARSE_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| extractFormDate leaves words and relative days to the form's default of today | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| "today" is never parsed into a calendar date, with or without the apostrophe we can use today's date | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| "today" is never parsed into a calendar date, with or without the apostrophe use today | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| "today" is never parsed into a calendar date, with or without the apostrophe today’s date | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| a date that belongs to an earlier step is not the form's date skips the date of a prior warning (the production sentence) | skipped | RELATIVE_DATE_READER_ENABLED | RELATIVE_DATE_READER family (other session). Here: "today" is written as today's ISO date instead of null (same date on the form). |  |
| a labelled earlier step is history, wherever its date sits a later turn that restates the manual date replaces the earlier one | pin | PRIOR_ACTIONS_PARSE_ENABLED | Doc: the line holds no word the manager did not say ("signed" only if they wrote it); a named manual reads as the manual's title ("JBA Manual" -> "JBA Policy Manual"). Test expects old "signed" wording. |  |

### src/lib/ai/form-choice-stated.test.ts

Prod failing 5 (QA 5); bare 0. Minimal flag set: FORM_CHOICE_STATED_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| FORM_CHOICE_STATED_ENABLED: the form the manager named wins (ported from Ask Sunny) defaults off | pin | FORM_CHOICE_STATED_ENABLED | Tests are "defaults off" / "off, as before" for a flag on in production. |  |
| FORM_CHOICE_STATED_ENABLED: the form the manager named wins (ported from Ask Sunny) off, as before the intent read took the form from the assistant's Corrective Action Form | pin | FORM_CHOICE_STATED_ENABLED | Tests are "defaults off" / "off, as before" for a flag on in production. |  |
| FORM_CHOICE_STATED_ENABLED: the form the manager named wins (ported from Ask Sunny) off, as before the remap and the intent read gave the follow-up card with no earlier coaching mentioned | pin | FORM_CHOICE_STATED_ENABLED | Tests are "defaults off" / "off, as before" for a flag on in production. |  |
| FORM_CHOICE_STATED_ENABLED: the form the manager named wins (ported from Ask Sunny) off, as before QA round 12: the model's Corrective Action Form was the card, and both forms showed one | pin | FORM_CHOICE_STATED_ENABLED | Tests are "defaults off" / "off, as before" for a flag on in production. |  |
| FORM_CHOICE_STATED_ENABLED: the form the manager named wins (ported from Ask Sunny) off, as before a stored Disciplinary Action line made a coaching request a Corrective Action | pin | FORM_CHOICE_STATED_ENABLED | Tests are "defaults off" / "off, as before" for a flag on in production. |  |

### src/lib/forms/official-policy-manual.test.ts

Prod failing 5 (QA 5); bare 0. Minimal flag set: LATE_OPEN_DATE_ENABLED.

| test | verdict | flag(s) | evidence | user-visible effect + proposed fix |
|---|---|---|---|---|
| 4. the offense box decides which section cites Late Opening, then Attendance, for a tardy opener: Pat was scheduled to open the store at 9:30 and did not arrive until 11:23 | pin (unsure) | LATE_OPEN_DATE_ENABLED | Late opening reads as the manual's Late Opening section; citation is now "Late Opening — Page 15" without the old "; Attendance — Page 14". Looks intended (Late Opening has its own section/plan) but not confirmed by a QA note. |  |
| 4. the offense box decides which section cites Late Opening, then Attendance, for a tardy opener: she was the opener today and came in late | pin (unsure) | LATE_OPEN_DATE_ENABLED | Late opening reads as the manual's Late Opening section; citation is now "Late Opening — Page 15" without the old "; Attendance — Page 14". Looks intended (Late Opening has its own section/plan) but not confirmed by a QA note. |  |
| 4. the offense box decides which section cites Late Opening, then Attendance, for a tardy opener: late opening on 10/16 | pin (unsure) | LATE_OPEN_DATE_ENABLED | Late opening reads as the manual's Late Opening section; citation is now "Late Opening — Page 15" without the old "; Attendance — Page 14". Looks intended (Late Opening has its own section/plan) but not confirmed by a QA note. |  |
| 4. the offense box decides which section cites Late Opening, then Attendance, for a tardy opener: she didn't open the Makery until 10 | pin (unsure) | LATE_OPEN_DATE_ENABLED | Late opening reads as the manual's Late Opening section; citation is now "Late Opening — Page 15" without the old "; Attendance — Page 14". Looks intended (Late Opening has its own section/plan) but not confirmed by a QA note. |  |
| 4. the offense box decides which section cites Late Opening, then Attendance, for a tardy opener: opened the location 40 minutes late | pin (unsure) | LATE_OPEN_DATE_ENABLED | Late opening reads as the manual's Late Opening section; citation is now "Late Opening — Page 15" without the old "; Attendance — Page 14". Looks intended (Late Opening has its own section/plan) but not confirmed by a QA note. |  |

## Not read (failing count from QA's baseline)

- 27 src/app/api/forms/pm-draft-route.single-writer.test.ts
- 27 src/app/api/forms/pm-draft-route.test.ts
- 9 src/app/api/forms/corrective-action-warning-level-e2e.test.ts
- 9 src/app/api/forms/state-code-not-a-person-e2e.test.ts
- 8 src/app/api/chat/form-edit-plain-words-e2e.test.ts
- 6 src/app/api/chat/ai-reads-code-checks-e2e.test.ts
- 6 src/app/api/chat/edits-dates-replay-e2e.test.ts
- 6 src/app/api/forms/admin-feedback-oct16-e2e.test.ts
- 6 src/app/api/forms/corrective-action-chat-edits-e2e.test.ts
- 6 src/app/api/forms/hr-feedback-oct21-followups-e2e.test.ts
- 5 src/test/qa/forms-migration-qa.test.ts
- 5 src/app/api/chat/date-answer-applied-e2e.test.ts
- 5 src/app/api/forms/coaching-feedback-e2e.test.ts
- 5 src/app/api/forms/corrective-action-revision-5-e2e.test.ts
- 5 src/app/api/forms/private-creator-forms.test.ts
- 4 src/lib/ai/employment-change-conversation.test.ts
- 4 src/lib/ai/exit-form-conversation.test.ts
- 4 src/lib/ai/resend-same-chat-oct25.test.ts
- 4 src/lib/forms/ca-action-plan.test.ts
- 4 src/lib/forms/ca-policy.test.ts
- 4 src/lib/forms/prior-actions-policy.test.ts
- 4 src/app/api/chat/exit-intake-oct25.test.ts
- 4 src/app/api/chat/relative-date-reader-e2e.test.ts
- 4 src/app/api/chat/stored-slots-not-a-request-e2e.test.ts
- 4 src/app/api/forms/asd-no-form-monitoring.test.ts
- 4 src/app/api/forms/exit-draft-route.single-writer.test.ts
- 4 src/app/api/forms/exit-draft-route.test.ts
- 4 src/app/api/forms/exit-form-permissions.test.ts
- 4 src/app/api/forms/owner-retest-e2e.test.ts (skipped: warning-level / RELATIVE_DATE_READER, other session)
- 4 src/app/api/forms/qa-f11-chat-draft-agreement.test.ts
- 4 src/app/api/forms/qa-w3-prior-forms-identity.test.ts
- 3 src/lib/ai/card-meta-turn.test.ts
- 3 src/lib/ai/chat-quality-replay.test.ts
- 3 src/lib/ai/entity-facts.test.ts
- 3 src/lib/ai/form-full-remap.test.ts
- 3 src/lib/ai/form-intake-qa-2026-10-21.test.ts
- 3 src/lib/ai/prompts.test.ts
- 3 src/lib/ai/qa-w4-date-and-prior-coaching.test.ts
- 3 src/lib/ai/source-note.test.ts
- 3 src/lib/forms/coaching-feedback.test.ts
- 3 src/lib/forms/prior-step-sentence.test.ts
- 3 src/lib/forms/request-line-account.test.ts
- 3 src/lib/forms/sales-shortfall-object.test.ts
- 3 src/lib/forms/step-dates-not-form-date.test.ts
- 3 src/lib/forms/warning-level.test.ts (skipped: warning-level / RELATIVE_DATE_READER, other session)
- 3 src/app/api/chat/corrective-action-warning-level-chat-route.test.ts
- 3 src/app/api/chat/first-name-ask-e2e.test.ts
- 3 src/app/api/chat/live-flags-with-reader-e2e.test.ts
- 3 src/app/api/chat/typed-employee-name-oct25.test.ts
- 3 src/app/api/chat/warning-level-owner-scenarios.test.ts
- 3 src/app/api/forms/corrective-action-late-opening-e2e.test.ts
- 3 src/app/api/forms/corrective-action-payroll-e2e.test.ts
- 3 src/app/api/forms/qa-payroll-after-creation-e2e.test.ts
- 3 src/app/api/knowledge/corpus-authority.test.ts
- 2 src/form-revisions/form-revisions.dom.test.tsx
- 2 src/features/chat/exit-inline-form.dom.test.tsx
- 2 src/lib/ai/ca-offer.test.ts
- 2 src/lib/ai/ca-shift-dates-kept.test.ts
- 2 src/lib/ai/call-claude.stream.test.ts
- 2 src/lib/ai/chat-form-known-context.test.ts
- 2 src/lib/ai/late-open-date-oct24.test.ts
- 2 src/lib/ai/list-policy-ask.test.ts
- 2 src/lib/ai/live-replay.eval.test.ts
- 2 src/lib/ai/manager-name-guard.test.ts
- 2 src/lib/ai/name-slot-store.test.ts
- 2 src/lib/ai/own-brand-parent.test.ts
- 2 src/lib/ai/remap-incident-oct24.test.ts
- 2 src/lib/ai/remap-prior-actions-oct25.test.ts
- 2 src/lib/ai/report-name-not-a-person.test.ts
- 2 src/lib/ai/sunny-fixes-runtime.test.ts
- 2 src/lib/ai/unknown-name-ask-who-for.test.ts
- 2 src/lib/forms/ca-sales-policy.test.ts
- 2 src/lib/forms/chat-correction.single-writer.test.ts
- 2 src/lib/forms/chat-correction.test.ts
- 2 src/lib/forms/cleaning-other-every-wording.test.ts
- 2 src/lib/forms/conduct-incident-cites-page.test.ts
- 2 src/lib/forms/edit-policy-ask-schema.test.ts
- 2 src/lib/forms/employment-change.test.ts
- 2 src/lib/forms/exit-facts.test.ts
- 2 src/lib/forms/form-name-from-roster.test.ts
- 2 src/lib/forms/form-patch-account-line.test.ts
- 2 src/lib/forms/form-reducer-said-replacement.test.ts
- 2 src/lib/forms/incident-dates.test.ts
- 2 src/lib/forms/metric-guard.test.ts
- 2 src/lib/forms/payroll-amount-referent.test.ts
- 2 src/lib/forms/prior-actions-no-signed-parsers.test.ts
- 2 src/lib/forms/prior-forms-lines.test.ts
- 2 src/lib/forms/proposal.test.ts
- 2 src/lib/forms/qa-w4-date-readers.test.ts
- 2 src/lib/forms/reopen-no-show-oct25.test.ts
- 2 src/lib/forms/request-slot.test.ts
- 2 src/lib/forms/s37-coaching-observed.test.ts
- 2 src/lib/forms/sales-observation-account.test.ts
- 2 src/app/api/chat/action-plan-fits-e2e.test.ts
- 2 src/app/api/chat/action-plan-manager-only-live-path.test.ts
- 2 src/app/api/chat/b13-remap-p0-oct25.test.ts
- 2 src/app/api/chat/card-change-e2e.test.ts
- 2 src/app/api/chat/form-revision-wiring.test.ts
- 2 src/app/api/chat/last-first-name-read-e2e.test.ts
- 2 src/app/api/chat/name-question-only-e2e.test.ts
- 2 src/app/api/chat/question-not-form-e2e.test.ts
- 2 src/app/api/chat/unknown-name-ask-e2e.test.ts
- 2 src/app/api/forms/form-monitoring-store-access.test.ts
- 2 src/app/api/forms/one-draft-per-conversation-e2e.test.ts
- 2 src/app/api/chat/conversations/ownership.test.ts
- 1 src/features/chat/finalized-change-panel.dom.test.tsx
- 1 src/features/chat/form-proposal.dom.test.tsx
- 1 src/features/chat/rollout-fixes.dom.test.tsx
- 1 src/features/forms/monitoring-table.dom.test.tsx
- 1 src/lib/ai/anti-loop-replay.test.ts
- 1 src/lib/ai/chat-entity-wiring.test.ts
- 1 src/lib/ai/chat-only-form-creation.test.ts
- 1 src/lib/ai/chat-stage-timings-trace.test.ts
- 1 src/lib/ai/chat-stage-timings.test.ts
- 1 src/lib/ai/conv-mvmj6v1t250hfij.dom.test.tsx
- 1 src/lib/ai/conv-mvmj7ifs9oosat5.dom.test.tsx
- 1 src/lib/ai/first-name-yes-keeps-request.test.ts
- 1 src/lib/ai/form-records-runtime.test.ts
- 1 src/lib/ai/intent-extraction.test.ts
- 1 src/lib/ai/intent-payroll-quote-oct24.test.ts
- 1 src/lib/ai/not-a-name-oct24.test.ts
- 1 src/lib/ai/out-of-date-is-the-proposal.test.ts
- 1 src/lib/ai/own-brand-only.test.ts
- 1 src/lib/ai/past-forms-before-library.test.ts
- 1 src/lib/ai/person-memory-runtime.test.ts
- 1 src/lib/ai/polite-about-request.test.ts
- 1 src/lib/ai/priority-replay.test.ts
- 1 src/lib/ai/prompt-cache-replay.test.ts
- 1 src/lib/ai/reformat-framework-oct25.test.ts
- 1 src/lib/ai/reply-matches-card-cleaning.test.ts
- 1 src/lib/ai/reply-matches-card-two-forms.test.ts
- 1 src/lib/ai/reply-matches-card.test.ts
- 1 src/lib/ai/report-turns.test.ts
- 1 src/lib/ai/round1-scoreboard.test.ts
- 1 src/lib/ai/self-check.test.ts
- 1 src/lib/ai/spend-guard-store.test.ts
- 1 src/lib/ai/spend-meter.test.ts
- 1 src/lib/ai/take-off-stays-card.test.ts
- 1 src/lib/ai/title-of-the-employee-exit.test.ts
- 1 src/lib/ai/title-rule-oct24.test.ts
- 1 src/lib/ai/warning-level-invented-oct24.test.ts
- 1 src/lib/store/chat-history-tolerant.dom.test.tsx
- 1 src/lib/forms/account-verb-not-a-name.test.ts
- 1 src/lib/forms/as-you-said-app-read.test.ts
- 1 src/lib/forms/as-you-said-manager-words.test.ts
- 1 src/lib/forms/chat-form-records.test.ts
- 1 src/lib/forms/corrected-date-kept.test.ts
- 1 src/lib/forms/denial-no-account.test.ts
- 1 src/lib/forms/described-attendance-not-denied.test.ts
- 1 src/lib/forms/drafted-text-placeholder-words.test.ts
- 1 src/lib/forms/employee-match.test.ts
- 1 src/lib/forms/employee-roster-store-scoped.test.ts
- 1 src/lib/forms/employee-verification.test.ts
- 1 src/lib/forms/exit-library.test.ts
- 1 src/lib/forms/exit-termination-paste.test.ts
- 1 src/lib/forms/exit-terms-not-names.test.ts
- 1 src/lib/forms/form-patch-flags-off.test.ts
- 1 src/lib/forms/form-patch-model.test.ts
- 1 src/lib/forms/form-records-no-judgement.test.ts
- 1 src/lib/forms/future-prior-row.test.ts
- 1 src/lib/forms/issue-after-request-reason.test.ts
- 1 src/lib/forms/issue-is-the-account.test.ts
- 1 src/lib/forms/level-ends-request.test.ts
- 1 src/lib/forms/missed-shift-not-lateness.test.ts
- 1 src/lib/forms/msb-phrase-soc.test.ts
- 1 src/lib/forms/no-notice-no-date.test.ts
- 1 src/lib/forms/not-a-name.test.ts
- 1 src/lib/forms/off-roster-confirm.test.ts
- 1 src/lib/forms/one-form-each.test.ts
- 1 src/lib/forms/payroll-deduct-amount.test.ts
- 1 src/lib/forms/place-from-cue.test.ts
- 1 src/lib/forms/possessive-place.test.ts
- 1 src/lib/forms/prior-forms-am-warnings.test.ts
- 1 src/lib/forms/prior-step-date-list.test.ts
- 1 src/lib/forms/prior-step-previously.test.ts
- 1 src/lib/forms/proposal-name-correction.test.ts
- 1 src/lib/forms/relative-date.test.ts
- 1 src/lib/forms/remove-policy-not-named.test.ts
- 1 src/lib/forms/request-from-names-employee.test.ts
- 1 src/lib/forms/roster-name-in-candidate.test.ts
- 1 src/lib/forms/roster-only-names.test.ts
- 1 src/lib/forms/rule-conflicts.test.ts
- 1 src/lib/forms/s34-edit-make-it-about.test.ts
- 1 src/lib/forms/s35-ca-not-prior-coaching.test.ts
- 1 src/lib/forms/s35-draw-me-up-ca.test.ts
- 1 src/lib/forms/s35-no-recursion.test.ts
- 1 src/lib/forms/sales-triple-keeps-words.test.ts
- 1 src/lib/forms/set-aside-plan.test.ts
- 1 src/lib/forms/signed-step-not-a-request.test.ts
- 1 src/lib/forms/staff-picker-directory.test.ts
- 1 src/lib/forms/stale-needs-roster-person.test.ts
- 1 src/lib/forms/street-address-not-a-name.test.ts
- 1 src/app/api/chat/answer-not-a-name-e2e.test.ts
- 1 src/app/api/chat/create-currency-audit-e2e.test.ts
- 1 src/app/api/chat/draft-reuse-same-chat-e2e.test.ts
- 1 src/app/api/chat/exit-shortcut-terms-e2e.test.ts
- 1 src/app/api/chat/final-reply-marker-guard.test.ts
- 1 src/app/api/chat/form-edit-noop-guard-flags-off.test.ts
- 1 src/app/api/chat/form-type-switch-e2e.test.ts
- 1 src/app/api/chat/payroll-typo-answer-e2e.test.ts
- 1 src/app/api/chat/prior-actions-yearless-oct25.test.ts
- 1 src/app/api/chat/proposal-path-flags-e2e.test.ts
- 1 src/app/api/chat/same-form-copy-e2e.test.ts
- 1 src/app/api/chat/unread-day-date-e2e.test.ts
- 1 src/app/api/forms/coaching-qa-fixes-e2e.test.ts
- 1 src/app/api/forms/cross-chat-draft-route.test.ts
- 1 src/app/api/forms/exit-form-e2e.test.ts
- 1 src/app/api/forms/finalized-form-revision-e2e.test.ts
- 1 src/app/api/forms/form-edit-name-gate-roster-e2e.test.ts
- 1 src/app/api/forms/hr-feedback-oct21-e2e.test.ts
- 1 src/app/api/forms/location-authority.test.ts
- 1 src/app/api/forms/policy-change-benefits-warning-e2e.test.ts
- 1 src/app/api/forms/proposal-currency.test.ts
- 1 src/app/api/forms/truncated-draft-route.single-writer.test.ts
- 1 src/app/api/forms/truncated-draft-route.test.ts
- 1 src/lib/ingestion/extract/pdf-ocr.test.ts
- 1 src/app/api/chat/conversations/deletion-and-ordering.test.ts
