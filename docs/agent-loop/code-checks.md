# Agent loop: code-check audit

This audit classifies every check in `src/lib/ai/agent-loop/` (`tools.ts`, `run.ts`), as merged in #992 (main @ 6cbf26a4).

It applies Pau's rule of 14 Nov 2026 (16:50Z and 16:53Z): **code may refuse or inform, never rewrite.**
- Code keeps only:
  - the approved safety guards;
  - the tools themselves (how the model reads the roster, the forms and the manual).
- Everything else becomes rules-book instructions plus plain facts in tool results. The model decides and writes the words.
- A converted behavior that fails live gets a better instruction or better facts, never new code. Only Pau approves a new code check.

## Classes

| Class | Meaning | Stays in code? |
|---|---|---|
| **SAFETY** | An approved guard that blocks an action. These are: scope and own salons; the right person; drafts only, with a finalized form becoming a revision; the past-forms gate; no invented level or payroll; PII redaction; marker and source-note stripping; honesty about what was saved. | Yes |
| **TOOL** | How the model reads or writes the roster, forms, manual and knowledge base, including the inputs those tools accept. | Yes |
| **FACTS** | A tool result that states what is true, such as unset fields, the dates given, or that a name is off the roster. The model words it. | Yes |
| **VALIDATOR** | Refuses a tool call and tells the model why; the model retries in its own words. | Pau's 16:53Z rule moves these to instructions plus facts. The approved safety ones stay. |
| **PATCH** | Code that edits, replaces or appends the model's wording, or picks a value for the model. | No: convert |

## Inventory (before)

### `tools.ts`

| # | Check | Where | Class | After |
|---|---|---|---|---|
| 1 | Past-forms gate (`asksAboutPastForms`): find_past_forms, read_form, open_form | findPastForms, readForm, openForm | SAFETY | keep |
| 2 | Scoped roster: find_staff and list_staff read only the manager's own salons; district and region logins are unchecked | rosterFor, listStaffTool | SAFETY | keep |
| 3 | `authorizeInstance` on every form read and write | readForm, editForm, openForm | SAFETY | keep |
| 4 | A roster id from find_staff, or a typed name only when it is off the list; the manager's own name is never the employee | proposeForm | SAFETY | keep |
| 5 | A person the manager said no to is never carded (`turnedDownName`) | proposeForm | SAFETY (right person) | keep |
| 6 | The right person's form: a turn about another roster person never edits this form | editForm | SAFETY | keep |
| 7 | One card per reply | proposeForm | SAFETY | keep |
| 8 | The open draft keeps its turns (same form, same person, no "new" → refused) | proposeForm | SAFETY | keep |
| 9 | Finalized → revision draft (`openEditableDraft`); drafts only | editForm | SAFETY | keep |
| 10 | No invented level or payroll: propose_form and edit_form keep a level, payroll or amount only from the manager's words | proposeForm, editForm | SAFETY | keep |
| 11 | Untrusted envelope on people-written text (`untrusted`) | read_form, edit_form, search_knowledge | SAFETY | keep |
| 12 | PII: default-password and SSN redaction in search_knowledge passages | searchKnowledge | SAFETY | keep |
| 13 | Whole staff: propose_form refuses a whole-staff request; list_staff names and positions only | proposeForm, listStaffTool | SAFETY | keep |
| 14 | A salon or city is never a person (`namesAPlace`) | findStaff, proposeForm | SAFETY (right person) | keep |
| 15 | The card's job title comes from the roster row (`rosterTitle`) | proposeForm | SAFETY (right person's data) | keep |
| 16 | Account check: the account keeps the manager's dates, times, places, amounts, metrics and figures (`accountMissing`) | proposeForm | VALIDATOR | → FACTS + rule: propose_form returns `account_words: [...]` (what the manager said that the account must keep); the rules book says to keep them. No refusal. |
| 17 | Empty account when the manager gave one | proposeForm, editForm | VALIDATOR | → FACTS: `account_given: "<their words>"` with `what_happened` empty; rule. |
| 18 | No invented figures; a format's figures and name are never on this card | proposeForm | VALIDATOR | → FACTS: `figures_said`, `format_from: "<C>"`; rule. The right-person part (C's name on B's card) stays SAFETY. |
| 19 | Policy outside the incident's topic (`topicHeadings`) | proposeForm | VALIDATOR | → FACTS: `fits_headings: [...]`; rule. |
| 20 | Several incident dates: the model's pick is dropped | proposeForm | PATCH | → FACTS: `dates_given: [...]`; rule: ask which unless clear. |
| 21 | No account → the policy line is dropped | proposeForm | PATCH | → rule; FACTS: `policy_named_by_manager: bool`. |
| 22 | Cleaning → "Other — <topic>" overrides the model's policy | proposeForm | PATCH | → FACTS: `cleaning_duty: "<phrase>"`; the rule already exists. |
| 23 | Prior actions taken from `statedPriorActions` instead of the model's | proposeForm | PATCH (QA item 13) | → FACTS: `prior_steps_said: [...]` (today's reader); the model writes prior_actions from them. |
| 24 | Payroll amount filled from `payrollAmountFromConversation` | proposeForm | PATCH | → FACTS: `payroll_amount_said`; rule. The no-invented-payroll guard (#10) stays. |
| 25 | `cardLines` + `requiredLines` (unset payroll and level, read-backs, the dates line, the off-roster line, "Using … from your staff list", exit dates, the under-performance line, "Dated today") | proposeForm → run.ts | PATCH (QA item 15) | → FACTS on the card result: `unset: [...]`, `off_roster: true`, `name_from_close_match: "<A>"`, `dated: "today"`, `exit_dates: {...}`, `under_performance: true`; rules-book lines carry Pau's wording. The model words them. |
| 26 | "make that update" writes the latest account itself | editForm | PATCH (QA item 14) | → FACTS: edit_form with no values and nothing changed returns `latest_account: "<their words>"`, `account_field: "<key>"`; rule: write it with values. |
| 27 | Account-field aliases (observation / details → the form's key) | editForm | PATCH (input rewrite) | → FACTS: read_form returns `account_field`; edit_form refuses an unknown field with the real list (TOOL). |
| 28 | Reword keeps facts | editForm | VALIDATOR | → FACTS (`account_words` of the old text) + rule. |
| 29 | Name correction: values for other fields refused | editForm | SAFETY (right fields) | keep |
| 30 | Payroll or level answer: only those fields | editForm | VALIDATOR | → rule. |
| 31 | Unknown fields refused, with the form's real field list | editForm | TOOL | keep |
| 32 | Incident date after today refused | proposeForm | VALIDATOR | → FACTS: `today`; rule. |
| 33 | Close-spelling policy: nothing cited until confirmed (`closePolicyQuestion`) | proposeForm | FACTS (confirm_policy) + PATCH (run.ts appends the question) | → FACTS only; rule. |
| 34 | One close roster match used; a lone first name used | findStaff | FACTS (find_staff note) | keep as facts; the reply line becomes a rule (#25). |
| 35 | Off-roster: card with the typed name | findStaff, proposeForm | FACTS + SAFETY (#4) | keep |
| 36 | "None on file" note on find_past_forms | findPastForms | FACTS | keep |
| 37 | The list_staff whole-staff reply as written (`replyOverride`) | listStaffTool → run.ts | PATCH | → FACTS (the list and the salons); rule; the model words it. |
| 38 | Truncation retry | run.ts | TOOL (robustness) | keep |

### `run.ts`

| # | Check | Class | After |
|---|---|---|---|
| 39 | Required lines appended to the reply (`requiredLines`) | PATCH | removed with #25 |
| 40 | The reply's `**Policy:**` line replaced by the card's | PATCH | → FACTS (`policy_line` on the card result) + rule; the Create button already uses the card's policy, so a wrong line in the reply is wording only. |
| 41 | `DISOWNS_EARLIER_CARD` sentence dropped (QA item 16) | PATCH | → rule (already in the rules book) + `CARD_NOTE` facts; drop the code. |
| 42 | `CARD_NOTE` on earlier card turns in history | FACTS | keep |
| 43 | `CARD_STILL_OPEN` appended | PATCH | → FACTS: the dynamic system block says "a card is open: <form> for <A>"; rule. |
| 44 | `EARLIER_CARD_STAYS` appended (the client's supersede marker) | FACTS (protocol; QA item 12) | keep, documented: the client's `isProposalSuperseded` reads it. |
| 45 | `replyOverride` (list_staff) | PATCH | removed with #37 |
| 46 | `revisedReply`: the reviser's own words replace the reply after an edit | PATCH | → FACTS (`reviser_said`, `updated`) + rule. |
| 47 | Revision-draft prefix ("I opened a new draft … original is unchanged") | PATCH | → FACTS (`revision_draft`, `original_unchanged`) + rule. |
| 48 | Honesty: a reply that claims a change nothing saved is replaced by the saved-diff answer | SAFETY (honesty), but a replacement | → **hand-back validator**: the claim and the saved diff go back to the model once, and it rewrites; only if it fails again, today's no-op answer. |
| 49 | Source notes and markers stripped; sensitive defaults redacted in the reply | SAFETY | keep |
| 50 | Out-of-scope salon line appended (`withOutOfScopePlace`) | PATCH | → FACTS: propose_form returns `salon_outside_scope: "<name>"`; rule. |
| 51 | Step-limit reply | TOOL (fallback) | keep |

## Counts

| Class | Before | After the conversion |
|---|---|---|
| SAFETY | 18 (#1–#15, #29, #49, and the honesty replacement #48) | 17, plus #48 as a hand-back validator |
| TOOL | 3 (#31, #38, #51) | 3 |
| FACTS | 5 (#34, #35, #36, #42, #44) | 5, plus the new facts fields listed above |
| VALIDATOR | 7 (#16, #17, #18, #19, #28, #30, #32) | 0 (to instructions plus facts, per Pau 16:53Z; the right-person part of #18 stays SAFETY) |
| PATCH | 18 (#20–#27, #33, #37, #39–#41, #43, #45–#47, #50) | 0 |
| Total | 51 | |

Kept as exceptions:
- **#44 `EARLIER_CARD_STAYS`:** a protocol marker the client reads (QA ruling).
- **#48:** a hand-back that falls back to today's no-op answer only on a second failure.

## Order of work

1. **This document** (no code change).
2. **Batch A, reply patches:** #25, #39, #40, #41, #43, #45, #46, #47, #50. Card and reply facts plus rules-book lines; run.ts writes nothing into the reply but the protocol marker and the safety strips.
3. **Batch B, card-value patches:** #20, #21, #22, #23, #24, #26, #27, #37. Facts plus rules.
4. **Batch C, validators to instructions:** #16, #17, #18 (except its right-person part), #19, #28, #30, #32, #33. Facts plus rules.
5. **Batch D, honesty hand-back:** #48.

Each batch has its own targeted live run on the behaviors it converts. Scripted cases that asserted a patch's exact text are changed to assert the outcome, each with a "Changed on purpose (Pau 14 Nov: code may refuse or inform, never rewrite)" comment.

## Batch A (done)

Converted: #25, #39, #40, #41, #43, #45, #46, #47, #50.
- `propose_form` returns `card` (with `salon` and `choose_salon_from` by name, `observation`, `policy`) and `facts`. The facts are: `unset`, `stated`, `payroll_amount_unset`, `dates_given`, `dated_today`, `off_roster_name` plus `staff_list`, `name_from_staff_list`, `exit_dates`, `under_performance`, `confirm_policy`, `policy_note`, `not_kept`, `salon_outside_scope`.
- `find_staff` returns `name_from_staff_list` / `not_on_roster` with `staff_list`.
- `list_staff` returns `whole_staff_form`, `which_salon`, `salons`, `salon`, `staff`.
- `edit_form` returns `reviser_said` / `updated`, and `revision_draft` / `original_unchanged`.
- The dynamic system block says when a card is open.
- The rules book's new **Card replies** and **Staff lists** sections carry Pau's wording for each fact.
- `run.ts` writes into the reply only `EARLIER_CARD_STAYS` (#44) and the safety clean-ups (#49). The honesty no-op (#48) is unchanged until batch D.

**Correction to #40.** The audit assumed the Create button already sent the card's policy. It did not. `cardPolicyFor` (`src/lib/forms/card-policy.ts`) read the policy from the reply's `**Policy:**` line, so dropping the line replacement would have let the model's wording decide what the draft cites.

Batch A therefore adds `policyLine` to `ChatFormProposal`. propose_form sets it, and `cardPolicyFor` prefers it over the reply text. Cards without the field (today's path) still read the reply as before.

This is a TOOL/protocol change, not a reply patch: what Create sends is now data on the card.

## Batch B (done)

**Converted: #20, #21, #22, #23, #24, #26, #27** (#37 went with batch A).
- **#20, dates:** the model's date stands when it is one of the dates the manager stated. A date nobody stated is refused. `dates_given` and `date_chosen` are facts.
- **#21, no account:** `policy_named_by_manager` is a fact. An MSB or topic request counts as naming the policy, which covers r3 case 639.
- **#22, cleaning duty:** the policy is the model's own: `Other — <topic>`, or `<heading>; Other — <topic>`. `cleaning_duty` is a fact.
- **#23, prior actions:** the model's list. `prior_steps_said` is a fact.
- **#24, payroll amount:** the model's, still checked against the manager's digits. `payroll_amount_said` is a fact.
- **#26, "make that update":** edit_form returns `latest_account` and `account_field`, and the model writes the account with values.
- **#27, field names:** no field is renamed. An unknown field is refused, with the form's own keys and the account field. read_form returns `account_field` and `empty_fields`.

**Tool additions (QA's r3 run and live-app pass):**
- **One card per reply:** the same form for the same person may be proposed again within a reply; the second card replaces the first. That lets the model act on a fact in the same turn.
- **propose_form:**
  - takes a `salon` input. The answer reaches the card through today's scope check (`proposeLocation`).
  - returns `title_differs` when the roster title differs from what the manager said.
  - returns `salon_outside_scope` from the card's own scope check as well.
- **find_staff:**
  - returns `longer_names_on_roster` (r3 "Isolde Varga Two").
  - returns `inactive_in_woven`, but only for a person in the manager's own salons, or any salon for a global login.
- **Source cards:**
  - read_policy produces a source card, as search_knowledge does.
  - Every source gets an `[S<n>]` marker (`addSource`). Only the sources the reply cites become cards; a reply with no markers keeps the sources whose title it names.
  - The markers are stripped before the reply reaches the manager.

**Rules book:** lines for each new fact, plus QA's live-app items 1, 2, 4, 5, 6, 11 and 13.

## Batch C (done)

**Converted: #16, #17, #18 (except its right-person part), #19, #28, #30, #32, #33.** Each is a fact now; the rules book's Card replies and Editing lines say how to fix the card or draft before replying.

propose_form facts:

| Check | Fact |
|---|---|
| #16, the account leaves out the manager's words | `account_words_missing` |
| #17, empty account when the manager gave one | `account_given` |
| #18, figures nobody said | `figures_not_said` |
| #18, a format's figures | `format_figures` |
| #19, a heading outside the incident's topic | `fits_headings` |
| #32, a date after today | `date_after_today` |
| #33, close-spelling policy | `confirm_policy`; the model proposes again with no policy |

- #18's right-person part stays a refusal: another person's name is never on this card.
- With #33, the card now cites the model's policy rather than nulling it.

edit_form facts:

| Check | Fact |
|---|---|
| #28, a reword dropped words or touched fixed fields | `reword_lost`, `reword_touched_fixed_fields` |
| #28, a reword with values for `employee_name` or `job_title` | still a refusal (the right person), nothing written |
| #30, a level or payroll answer also wrote other fields | `level_or_payroll_answer_also_wrote` |

**Still refusals (approved SAFETY):**
- no invented level or payroll;
- the right person;
- a name correction is the name;
- whole staff;
- drafts only;
- the past-forms gate.

**Also in this batch:**
- QA's ruling of 15 Nov: with the loop answering, the place stays in the Observation as said (`nov13-observation-place-must-read-*` loop arm).

## Batch D (done)

**#48, the draft honesty check:**
- With a draft open, a reply that claims a change nothing saved goes back to the model once, with what the saved draft shows. The model then makes the change with edit_form, or says plainly that it was not made.
- Only if the reply still claims an unsaved change does today's FORM_EDIT_NOOP_GUARD answer from the saved diff replace it.
- The trace records `draft_review: { claimed, fixed }`.

**The card self-review (#997):**
- It already hands back once and only states plainly that a change isn't on the card if the second try fails.
- Both reviews share one hand-back call. It costs at most one more model call, with up to 4 steps, and only when a mismatch is found.

**After batch D,** code writes into the reply only:
- `EARLIER_CARD_STAYS`;
- the safety clean-ups;
- the two second-miss honesty lines.

## Batch E (QA's tester follow-ups, part 4)

Rules-book lines and facts only; no reply patches. Each item has an outcome case in `nov14-live-r5-cases.ts`, in the follow-up's own words with invented names, and the r5 live list is `scripts/agent-loop-live/cases-targeted-r5.txt`.

| Item | Fact (tool) | Rules book |
|---|---|---|
| E1, the salon from Woven | `employee_salon` (propose_form, when the card waits for a salon; Woven's primary salon, only if it is in the manager's scope) | Card replies: file it there, "Filed at **<salon>**, where Woven lists <first name>"; ask at most once; a name is never the salon answer |
| E2, no word-for-word repeat | — | Card replies: acknowledge the answer, ask only what is missing |
| E3, "just make it" after a policy | — | Which form: a Corrective Action citing that policy, ONE question (who it is for) |
| E4, "same thing for <B>" while <A>'s card waits | `employee_salon` (E1) | Which form: make <B>'s card now, never hold <B> behind <A> |
| E5, "ca for the key holdr policy" | `close_heading` or `confirm_policy` (read_policy, on a close spelling) | Which form: name the matched policy in the question; "use that one" is the policy |
| E6, the whole **Policy:** line | — (card.policy was already the full line; the model shortened it) | Card replies: the whole line, never the heading alone |
| E7, staff count and one position | `staff_count`, `position`/`position_count`, `position_not_found` (list_staff, new optional `position` input) | Staff lists: the count first; only that position's people, after the salon |
| E8, a new card's reply that says nothing about it | — | Card replies: a new card's reply says what is on it and ends with the Policy line; "still open" only with no new card |
| E9, a policy the manual has no heading for | `policy_not_in_manual` (propose_form) | Card replies: cite the fitting section and say so in one line; The policy: a one-word answer after a card is that card's policy, never a knowledge search |
| E10, a month/day later than today | `date_read_as_last_year` (propose_form) | Card replies: "Dated <M/D/YYYY> (last <month>)"; never a date after today |
| E11, a reword that adds a cause | `reword_added_link` (propose_form, edit_form) | Editing and Card replies: grammar and tone only, facts stay separate |
| E12, a date after today on a card or draft | refused: propose_form leaves the card's date empty and returns `date_after_today`; edit_form refuses `form_date` / `incident_date` after today and writes nothing | Dates: say so and ask which day |
| E13, the server's UTC clock | — (`monthDayToIso` reads the salon's local date, `context.today`) | — |
| E14, dates written in another style | — (one reader, `src/lib/ai/agent-loop/dates.ts`, for the account check, incident dates, the card date and edit_form's form_date: 6/11, 6-11, 06/11/2026, 6.11.26, June 11, Jun 11th, 11 June, the 11th of June, Sept 28, with or without a year) | — |
| E15, a trace step with no reason | — (each step records `error_kind`, `fact_keys` and `missing_kinds`; never names, words or figures) | — |

**E8 in code:** the self-review also hands back, once, a reply to a new card that cites a policy when the reply has no **Policy:** line. On a second miss the model's own reply is kept; only a stated value the card does not hold gets today's "That change isn't on the card yet" line.

**E12 is a refusal** (approved: code may refuse): batch C made a date after today a fact only, so the card kept it when the model did not propose again. The date field is now refused and the fact stays.

**E6 in code:** the card self-review compares the reply's **Policy:** line with the card's whole policy line (letters and digits only), not just the heading. A shortened line is handed back once, like any other mismatch (batch D's hand-back). Nothing new is written into the reply.

## Batch G (the loop with a form open; this morning's silent-failure scan; the tester's batch E re-test)

Rules-book lines and facts first. The refusals and the narrow write paths below are approved by QA (and Pau, where noted). Cases: `nov15-agent-loop-batch-g-cases.ts` and `nov15-agent-loop-silent-failures-cases.ts` (the managers' words, invented names).

| Item | Code | Rules book |
|---|---|---|
| G0, rewording paused (Pau) | A reword request that would reword existing text writes nothing (`reword_paused`, edit_form and a same-card propose_form). New facts sent with it are still added when every old sentence stays (G13). | Editing: "Rewording isn't available yet…" |
| G3, an added fact | `add_changed_sentences`, `add_not_at_end_of_observed` (edit_form, `addPlacement`) | Editing: at the end of Observed; other sentences word for word |
| G4, open a form on file | propose_form refuses an open request. find_past_forms takes `form`/`date`/`about` and returns `best_match`. REOPEN_CLOSE_SPELLING returns `close_spelling_of`/`close_names`. The past-forms gate opens for the answer to the app's own `WHICH_FORM_QUESTION` (the last two turns only). | Which form |
| G5, payroll on a draft (QA approved) | `writeRevisionEdits({ managerStated })`: payroll deduct and its amount are written as the manager's, only after edit_form's stated guard. The default is unchanged. | Editing |
| G6, future dates | The after-today rule covers only the incident date on incident forms. Exit and follow-up dates are never refused. | Exit forms; Dates |
| G8, an Action Plan the manager dictates | Saved word for word as the manager's own edit (`saveInstanceValues`). The required closing still follows it; the `required-closing.ts` change is pending Pau. | Editing |
| G9, "I can't select Termination" | Termination only when the manager stated one (`TERMINATION_SAID`, `statesTermination`), written as stated, with `termination_approval_line`. | Editing |
| G10, the account sent again | — | Editing: "That's already on the form" |
| G11, a document date the manager sets | Written as their statement (`correctionWrite`), after today or not, with `date_after_today_as_asked`. Only a date read from the account is never after today. | Editing |
| G14, "Filed at" honesty | propose_form files at Woven's salon itself (`salon_from_woven`). The self-review hands back a salon the card doesn't hold. | Card replies |
| G15, who did it | `account_subject_changed` | What happened |
| G16, which date | `dates_asked_before` | Dates: ask once |
| G17/G18, policy named with its page | `ask_exactly` (no person yet, a policy named earlier in the chat) | Which form |
| G19, termination on the card | propose_form takes `warning_level: "termination"` only when the manager stated one (`statesTermination`); fact `termination_stated`. A hedge leaves the level empty. | Card replies: the hedge line |
| Terminations: the model decides, code locks (QA's design, 15 Nov, after two reviews) | `statesTermination` is main's, unchanged. The model passes warning_level termination (propose_form), warning_type termination (edit_form), or exit_type termination. Code locks each on a termination word in the manager's words (`termination-word.ts`): the request's turns for a card or exit, the current non-question message for edit_form. Create checks the word again, server-side, before ticking a card's termination (`loopTermination`). An exit keeps its stated effective date or last day. A warning level is exactly verbal, written or termination. On CA and coaching, a form or incident date after today is always refused. A dictated Action Plan is the message's own text after an "action plan … :/to" marker, bounded by the model's text. QA's third review: every lock and Create's check are gated by TERMINATION_STATED_TICKS. A loop card (`fromAgentLoop`) never runs today's reader at Create, and in the loop only the model's locked decision is `termination_stated`. The edit path with no values refuses a stated date after today before the reviser runs. The plan markers are "action plan … :" (no , . ; between) or "change/make/set/update/replace the action plan to". An exit's date is the model's `effective_date`, kept only when typed (nearest year when none). | Termination lines (IS / is NOT examples), Exit forms |
| Names, one person (QA's addition 2) | `sameRosterPerson`: a preferred and a legal name are one person when each is a full name of exactly one roster person, the same one. Used by find_past_forms (forms filed under either name) and edit_form's right-person guard. Two roster people are never merged. | — |

**Exit forms** (Pau: coaching, exit and CA first): there's a new rules-book section covering resignation vs termination, a future last day said in one line, rehire and reason only as said, and no incident questions. Batch I (the other 14 templates) is deferred.

## Batch G2 (QA's live run part 2 on batch G, 15 Nov 2026)

| Item | Code | Rules book |
|---|---|---|
| 1, "undo that, it's a written" | Any stated level is the manager's (one level: Written replaces Termination). edit_form returns `saved_level`, read back from the saved form. | Editing: say only saved_level; never "nothing to undo" without edit_form |
| 2, a termination with an offense | An exit card the manager did not ask for (no exit / separation / termination paperwork, no resignation) is refused with `exit_not_asked`. | Which form: the CA with Termination, the offense's policy and date, plus "Want the Employee Exit Form for <A> too?" |
| 3, the hedge line | `termination_mentioned_not_stated` when the manager's words name a termination and the card is not one. | The hedge line exactly, beside the warning-level line |
| 4, prior actions | Kept only with dates the manager typed, never this incident's date, and with a stated count (`prior_actions_not_kept`). | "Written warning (2), dates not given" |
| 5, updated_at | Every manager save (`saveInstanceValues`, so the dictated plan too) moves updated_at under F8's flag; a failed touch is a warning. instances.ts is protected: Pau's standing approval, 15 Nov 2026; hunk in `docs/patches/g2-save-touches-updated-at.patch`. | — |
| 6, a future form date | The refusal carries `asked_date` and `form_date_kept`. | "<asked> is after today, so I left the form's date as <kept>. Which day did you mean?" |


Replay cases use QA's exact texts T1, T3, T4, T6–T9, T11 and T13 (invented name Remy Calder). G7a now expects the CA with Termination plus the exit offer (QA's ruling); its exit checks moved to `nov15-agent-loop-g7a-exit-paperwork-asked` ("terminate <A>, effective 11/20, exit paperwork please").
