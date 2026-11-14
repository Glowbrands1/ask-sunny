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
