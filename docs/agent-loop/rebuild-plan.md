# Agent loop rebuild plan (owner's audit, 15 Nov 2026)

Kept by QA. This is the one plan the coding sessions work from. The owner's audit spec is copied below
the plan, unchanged in substance; line numbers are at main 8f7039c5.

## Owner's decisions (15 Nov 2026)
- Rebuild the loop to the audit's design BEFORE the pilot (pilot target: about Wednesday).
- Close spellings: never seated. "Did you mean <name>?" with the option to keep the name as typed
  (owner's ruling "A", 15 Nov). This replaces the audit's "one close spelling is used" line.
- No new word or phrase list (regex) that reads the manager's message or the model's reply. Data-format
  parsers (dates, money, uuids) are fine.
- Rewording stays paused. The old chat path is untouched. Everything stays behind AGENT_LOOP_ENABLED +
  AGENT_LOOP_USERS.
- Coding sessions open PRs and never merge, deploy or change env/flags. QA reviews (with an independent
  reviewer), merges and flips switches.

## Status at 8f7039c5 (QA's check)
Nearly every item is NOT DONE. Verified bugs, worst first:
1. propose_form unlocks a level from ANY earlier manager turn ("she was written up before" unlocks
   "written") — tools.ts:1433/1486.
2. edit_form has no privacy gate for a form that is not open on screen — tools.ts:1842-2226.
3. payrollStated reads every turn, so one person's payroll answer can unlock another card's payroll.
4. ERROR_KINDS matches error text and logs the privacy and right-person refusals as plain "refused"
   (run.ts:126-139).
5. A non-uuid or unsaved card id gives "could not be changed just now" (tools.ts:2224-2225).
6. The policy manual cache lives until the server restarts (tools.ts:853-876).
Spec corrections: conversationOf is run.ts:275-289; ERROR_KINDS is run.ts:126-139;
noop.replyFromSavedDiff makes no AI call (DB reads only), so only the reviser counts toward the step cap.

## What happens to batches J and K
Both add new message/reply regex lists (J2 dictated markers, J3 level/payroll readers, J4, J7, K2/K3
person-slot readers, K3 reply check, K5a, K7 gate patterns). Those parts are DROPPED and rebuilt as
evidence arguments in PR 1/PR 4. Kept, as small salvage PRs off main:
- J-keep (Coding-5): J5 policy page, J8 hand-back cache, J9 short tool inputs, J10 first_token_ms, the
  isoDate year fix (all formats), the amount reader and payroll-clause fix (today's path), DICTATION_NEVER.
- K-keep (Coding-7): K1 (did-you-mean, ON), K2, K4, K5b (scoped to the SAME person/card only — see bug 3),
  K6, K12a/b.
- #1021 (Coding-8): K10 and K11 only; K7 dropped.

## Rebuild PRs, owners and order
| Order | PR | Owner | Depends on |
|---|---|---|---|
| 1 | evidence.ts + message ids in conversationOf | Coding-7 | — |
| 1 | PR 3: tools return exactly what was saved | Coding-9 | — |
| 1 | PR 5: app-config + PR 7 test harness (phrasing.test.ts scaffold, runtime switch-off test, missing sf-s cases s1-s3, s5-s10, s30-s33) | Coding-10 | — |
| 2 | PR 4: reason codes (start with not_a_saved_form, finalized_revision_refused, error_kind from reason_code; then level/payroll/privacy once evidence.ts lands) | Coding-8 | evidence.ts |
| 2 | PR 1: replace the word lists with evidence args | Coding-7 | evidence.ts |
| 3 | PR 2: reply_claims + verifyReply | Coding-5 | PR 3, PR 1 |
| 3 | PR 6: speed | Coding-9 | PR 3 |
| 4 | Full 266 shadow replay on the rebuilt loop, then the live re-test | QA + Runner | all |

Each PR: draft, small, green (tsc, vitest src/lib/ai/agent-loop, flags-off parity, whole replay pack),
invented names only, failing-first cases, PR text says what list/override it removed (file:line).

---

## The audit spec (summary of the owner's text)

Hard rules: behind AGENT_LOOP_ENABLED + AGENT_LOOP_USERS; old chat path untouched; small draft PRs; no env/flag changes; no deploy; never touch SELF_CHECK_ENABLED; NO new word/phrase regex lists reading the manager's message or the model's reply (format parsers for dates/money/uuids OK); rewording stays paused (REWORD_REQUEST tools.ts:2316, REWORD_PAUSED tools.ts:2314, reword path tools.ts:1860, 1917-1923, 2024-2044 unchanged); code may refuse writes or hand facts back, never writes the reply except a last fallback from saved data; the model's tool args are claims checked against real turns (message id + quote) and the saved form.

Shared evidence check: src/lib/ai/agent-loop/evidence.ts — Evidence = {message_id, quote}; verifyEvidence → ok | evidence_not_manager_turn | evidence_quote_not_found (case/space-insensitive) | evidence_not_this_turn | evidence_after_card. Message ids on history turns in conversationOf (run.ts ~187-207). Unit tests.

PR 1 — replace word lists with tool args:
- WRITE_ACCOUNT_REQUEST (tools.ts:2321, used 2080) → edit_form intent:"write_account" + account_evidence[]
- INCIDENT_VERB, NOT_AN_ACCOUNT (tools.ts:2322-2323, used 2332-2333) → account_evidence
- LEVEL_OR_PAYROLL_ANSWER (tools.ts:2345, used 1357, 1908) → level_evidence / payroll_evidence; "answer also wrote" from saved diff
- NAME_CORRECTION (tools.ts:2348, used 1912) → edit_form intent:"correct_name" + name_evidence; only employee_name may change (name_correction_other_fields)
- EXIT_ASKED, RESIGNATION_TOLD (tools.ts:191,193, used 1322) → propose_form exit_evidence; exit_not_stated
- ASKS_ABOUT_FORMS + asksAboutPastForms (tools.ts:119,144-158; find_past_forms 696, read_form 798, open_form 2359) → forms_on_file_evidence on find_past_forms, read_form, open_form AND edit_form (non-open forms); privacy_not_asked
- account words tools.ts:1118-1119 → account_evidence
- CLAIMS_A_CHANGE (run.ts:384; used 724,733,839) → removed (PR2)
- SAYS_NOTHING_CHANGED, ASKS_A_CHANGE, STATED_LEVEL + statedLevel (run.ts:390-404; used 743-767) → removed (PR2)
- CARD_REPLY (run.ts:177; used 271,520,823) → cards stored with proposalId + employee in saved effects
- Bold-name match (run.ts:821-828) → employee id compare
- cardClaims/cardMismatch (run.ts:206-240) → reply_claims
Leave: REWORD path; date/money parsers (dates.ts, tools.ts:1046-1052). Lists at tools.ts:518, 556-557, 1023, 1045, 1048: keep only if still needed, say why.

PR 2 — verifyReply replaces run.ts:701-716, 821-830, 724-736 + 831-845, 743-767: final tool reply_claims({card?, saved_changes?, nothing_changed?, earlier_card_kept?}); compare with effects.proposal + saved diff; one hand-back; second miss → reply built from saved data; log reply_review; EARLIER_CARD_STAYS as fact earlier_card {kept, employee, form}; isProposalSuperseded via fact; tests (nov3-stepb, msb self-review, item 14, G2 undo).

PR 3 — tools return exactly what was saved: edit_form saved:[{field,before,after}] read back from DB + refused:[{field,reason_code}]; propose_form card:{...} + not_on_card:[...]; revision_draft {id, from_id}; doneThisTurn (run.ts:88-100), partialReply/stepLimitReply use saved list; no field values in traces.

PR 4 — refusals with reason codes: date_after_today (keep tools.ts:1602-1607, 1941-1951, 2097-2099 incl G11); level_not_stated (level_evidence from THIS message or direct answer after card asked; fixes tools.ts:1433, 1486 reading all earlier messages — "she was written up before" unlocks "written"; same in edit_form 1884-1891; termination rules unchanged); payroll_not_stated (1892-1897, payrollStated 1137); privacy_not_asked on edit_form of a non-open form (1842-1916 no check today); not_on_roster/roster_failed/ambiguous_person ("Keep my choice that one close spelling is used and named in the reply"); not_a_saved_form (2224-2225); finalized_revision_refused (keep cleanup 1997-2011, log failed delete); runTool error_kind from reason_code, replace ERROR_KINDS (run.ts:125-134), unknown → unknown + tool name.

PR 5 — app-config.ts: app name, location word, staff system ("Woven"), form keys (stc-exit, dpoa, coaching, follow-up-coaching), PRODUCTION_SALONS, roster reader; replace literals tools.ts:1169, 1322, 1420, 1493, 1564, 632; run.ts:749, 755; rules-book.ts:177 + every salon/Woven in rules-book.ts, prompt.ts, tools.ts; snapshot test.

PR 6 — speed: propose_form resolves employee_name itself when one active match, OR parallel find_staff+read_policy; measure (today 2.77 calls/card turn, 9.2s avg, 16.0s slow); policy manual read once per TURN, drop server-lifetime cache (tools.ts:853-876); count reviser calls (edit_form no values, 2092+) and noop.replyFromSavedDiff (run.ts:725, 838) toward AGENT_LOOP_MAX_STEPS; find_staff more_matches:true when cut at 10 (tools.ts:423).

PR 7 — tests: unit per PR; agent-loop/phrasing.test.ts (6+ phrasings × 8 behaviours, mocked model, no English-phrase assertions); switch-off equivalence (chat route never imports agent-loop/run.ts when off/unlisted); replay cases sf-s1..sf-s38 list + earlier-card + "make it a written" on uncreated card; tsc + vitest agent-loop + flags-off parity green.
