# Form behaviours from QA's Ask Vicki comparison — audit (26 Nov 2026)

The owner's list comes from QA's comparison of Ask Vicki with Ask Sunny (24 Nov 2026). The first list had nine
items. The owner then corrected the scope to items **A–H**, plus two items kept from the first list (**#4** blank
and whole-team forms, **#5** Final Written Warning). The other first-list items (#1, #2, #6, #7, #9) were dropped:
they are **not done, out of scope**. Their audit is recorded below so a later session can pick them up.

Status is **before this pull request**, read from the code on `main` (9d7fd00) with production's flags
(`src/config/production-flags.json`; `AGENT_LOOP_ENABLED` is on, so the agent loop is the live chat path). Ask Bubbles
was audited the same way; its table is in its own `docs/` folder.

## In scope

| Item | Status before | Where | This pull request |
|---|---|---|---|
| **A.** "Test Employee" garbled in the coaching prompt | Partly done | #1323 `TYPED_EMPLOYEE_EVERY_CARD` (on): `forms/typed-employee-name.ts`, `forms/roster-only-names.ts` `offRosterTyped`, `agent-loop/tools.ts` propose_form | **Fixed.** `find_staff` still cut "Employee" as a job title (`withoutJobTitle`, `tools.ts` `findStaff`), looked up "Test" and told the model it "does not read as a person's name … ask who the form is for". A request that went straight to `propose_form` (the Corrective Action one) was fine. Now `find_staff` looks up the whole typed name. Replay case `nov26-find-staff-typed-employee-*`. |
| **B.** Admin cards never ask which salon; the salon is taken from the wrong record | Done | #1323/#1324 `ADMIN_CARD_ASKS_SALON` (on): `tools.ts` which_salon / `which_salon_woven_and_forms` | Nothing to build. `nov24-admin-card-asks-salon-*` holds with production's flags. |
| **C.** Every missing detail asked in ONE message before drafting, the salon included | Partly done | `rules-book.ts` ("never more than one question per reply"; level and payroll asked together); `SAME_ASK_NO_REPEAT` (on) | Not in this PR: the combined ask conflicts with the rules book's one-question rule (Pau's fewer-questions ruling), so it needs the owner's ruling on wording. Follow-up. |
| **D.** Till shortage cites Standards of Conduct p.12, not the Register / Bank shortages line | Done | #1323/#1324 `LOOP_CARD_CITES_CONDUCT_LINE` (on): `specific-policy-topics.ts` `conductLineCitation` | Nothing to build. `nov24-agent-loop-conduct-line-on-card-*` holds. |
| **E.** A form that doesn't exist: list the forms that do | Done | #1323: `agent-loop/form-not-in-library.ts` | Nothing to build. `nov24-agent-loop-forms-not-in-library-*` holds. |
| **F.** Overdue counts disagree (19 / 8 / 6 / "None is overdue yet") | Done | #1323: one follow-up queue for the rail, Overview, banner and pills; the HR bell says "No HR approval is overdue yet"; `read_follow_ups` | Nothing to build. `nov24-follow-ups-overdue-*` holds. |
| **G.** Assign a follow-up to a person, with its due date | Partly done | `form_instances.follow_up_date` (due date, its own control); no assignee column anywhere (`supabase/migrations`) | Not in this PR: it needs a migration and a page control. Follow-up (it feeds the Calendar session). |
| **H.** One full HR approval round trip as an automated e2e test | Partly done | `forms/hr-approval-lifecycle.test.ts` "the round trip" (send, hold, HR edit, send back, resend, approve); `forms/hr-approval-sent-back.test.ts` (the manager's reply, then approve) | Covered at the library level today. A route-level test (send → send back → reply → approve through the HTTP routes) is a follow-up. |
| **#4.** Blank forms print `[Employee Name]`; whole-team forms print "All Team Members"; neither asks for a name | Partly done | Whole team: `forms/team-subject.ts` `TEAM_SUBJECT_LABEL = "All team members"` (lower case), Coaching Form only, no name asked (`WHOLE_TEAM_COACHING`, `COACHING_FOR_EVERYONE` on). Blank: no path. `forms/drafted-text.ts` strips bracketed placeholders and the draft route forbids `[Employee Name]` | Not in this PR. Follow-up. |
| **#5.** A Final Written Warning option, with its own Action Plan ending, never a termination | Missing | `forms/library.ts` Type of Warning was Verbal / Written / Termination / Demotion; "final written" ticked Written (`warning-level.ts`, Pau 30 Oct); the rules book says the form has no Final option | **Built.** Corrective Action Form revision 10 adds "Final Written Warning" (`final_warning`, the key `WARNING_LEVEL_KEYS` already reserved). With it ticked, the Action Plan ends "Further violations may result in additional disciplinary action, up to and including termination, following leadership review." in place of the future-violations closing (`required-closing.ts`, `instances.ts`). It is no final action: `escalation-guard.ts` never refuses it, and no termination notice is sent. `FINAL_WRITTEN_WARNING_ENABLED` (default off) reads the manager's "final written" as it, on the card, at Create and on an edit. Test `forms/final-written-warning.test.ts`; replay `nov26-final-written-warning-*`. |

## Dropped by the owner — not done, out of scope

| Item (first list) | Status | Where | Notes |
|---|---|---|---|
| #1 Exact wording anywhere ("Add '<text>' to <section>") | Partly done | `tools.ts` `dictatedActionPlan`, `addPlacement`; `form-reducer.ts` add; `required-closing.ts` | Only a dictated Action Plan is kept as typed. Other additions are written by the model and checked afterwards. There is no "at the start" placement. |
| #2 Edits change only what was asked; clear a section; no truncation | Partly done | `tools.ts` saved diff and `empty_account`; `form-reducer.ts` `would_blank`; caps in `tools.ts` (2,000 / 600), `form-patch-schema.ts` (4,000) | Other fields are kept. The Observation can't be cleared, and long text is capped in several places. |
| #3 Policy quoted word for word; same issue, same quote; "verify" fallback | Partly done | `policy-citation.ts` `verbatimExcerpt` (700 characters); `policy-verification.ts`; `rules-book.ts` | Item D covers the till line. Quotes are copied as written but cut at 700 characters, and there is no "verify" note on the form. |
| #6 Document a decided termination; tell the District Manager | Documenting: done. District Manager notice: missing | `termination-stated.ts`, `escalation-guard.ts`; `notifications/repository.ts` `createNotifications`; no salon-to-DM lookup | — |
| #7 Job title from Woven (part-time / full-time) | Mostly done | `tools.ts` `rosterTitle`; `title-of-the-employee.ts` | Woven's title is used. Part-time vs full-time shows only if Woven's title says it. |
| #8 Ask once; "same everything" | Partly done | Same as C. `same-form-copy.ts`, `SAME_FORM_COPY_NEW_PERSON` (on) | "Same everything" is not recognised. |
| #9 Sensitive situations sent to leadership review; no invented consequences | Mostly missing | `escalation-guard.ts` (termination, demotion and suspension only); `narrative-draft.ts` `ungroundedSpecifics` | No drug, alcohol, fitness-for-duty, violence, injury, harassment, theft, leave or payroll escalation exists. "Demotion" is not in the list of invented consequences. |

## AI can read it

No new page, report, table or figure: the Final Written Warning is an option of an existing form. The chat's
readers already name the form's ticked level (`find_past_forms`, `read_form`), now with its label.
