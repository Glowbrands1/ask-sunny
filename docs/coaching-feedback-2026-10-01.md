# Coaching / performance guidance — feedback round, 1 October 2026

Branch `claude/youthful-galileo-jv24iw`. Not merged. No migration. No
Supabase or Vercel change was made from this session.

## Root cause per item

| # | Item | Class | Root cause |
|---|---|---|---|
| 1 | Fields lost on redraft | **Bug** (state handling) + missing capability | There was **no revise path**. The drafting route had one caller, run once at creation, from the conversation notes only; it never saw the form's current values. A later "redraft it with changes" either went to the knowledge base and changed nothing (no form named → intent `none`), or — if it said "coaching form" — proposed a **new record** drafted from scratch. With the Follow-Up Coaching Form open, "coaching form" resolved to the *Coaching Form* template, which has no Follow-Up Observation / Progress Level / Specific Evidence / Next Follow-Up fields at all. Not a prompt or schema defect. |
| 2 | Follow-up fields redundant / inconsistent | UX + consequence of #1 | Two different things share the word. The Follow-Up Coaching Form has a **timeframe field** (`next_follow_up`, help text "The timeframe agreed for the next follow-up"); every form also has the instance's **calendar date** control ("Follow up on"). The Coaching Form has only the date — so the "version that only kept the date" is #1's template switch. |
| 3 | Team-wide coaching | Missing capability | An employee was required at every layer: proposal status, the Create card, `POST /api/forms/instances` (400), and `form_instances.employee_name not null`. |
| 4 | Everything framed as a "concern" | Prompt/UX | The intake asked for "a description of the performance concern"; the quick action read "Create a coaching form for a performance concern."; the drafting prompt is incident-shaped ("for the issue described"), and nothing stopped "Underperformance" being ticked for training. |
| 5 | Name typos accepted | Missing capability | No directory lookup existed in the forms path — names were free text by design. A Woven employee directory now exists (observe-only, phase one) but nothing in forms or chat read it. |
| 6 | Grammar cleanup | Prompt | The drafting prompt never asked for it. |
| 7 | Location logic | Missing capability + one UX bug | The employee's salon was never consulted. Salon scope: one salon → filled, several → asked (correct). Global: no salon unless named. District/region scope: fails closed by design (Phase 2 decision). The salon picker listed raw ids (`loc-0310`). |
| 8 | Manager follow-up fields blank | Preserved behaviour, previously prompt-only | They stayed blank only because the model usually declined; all five are `ai` fields. A revision that shows the model more context could have filled them. |
| 9 | Generic personality | Prompt | One "TONE" line; no stated voice, and no line between conversational warmth and record wording. |

## What changed

- **Revise in place** (`lib/forms/revision.ts`, `lib/forms/chat-revision.ts`, wired in `app/api/chat/route.ts` after `correctActiveForm`). Coaching family only (Coaching Form, Follow-Up Coaching Form). Same instance, same template, same pinned version. The model sees the form as it stands and returns only changed keys. A named field limits the change to that field; manager-written fields change only when named; a field is cleared only on an explicit "remove" naming it. Every drafting guard runs on the output. Finalized forms are refused with a pointer to Form Monitoring revisions. A request for a new form, a different person, or a different form family falls through to the old flow.
- **Follow-up findings guard** (`lib/forms/follow-up-observation.ts`). `follow_up_observation`, `specific_evidence`, `additional_coaching`, `progress_level`, `next_step` survive a draft only when the manager's words describe a follow-up that happened; progress additionally needs progress wording. Keyed on field keys (only the Follow-Up Coaching Form has them). In a revision, a finding the manager names explicitly ("set the progress level to improved") is theirs and is written.
- **Follow-up model.** Timeframe = the form's Next Follow-Up field; date = the instance's follow-up date. The control is relabelled "Follow-up date" with a hint that says which is which. Revisions never touch the date.
- **Team-wide coaching** (`lib/forms/team-subject.ts`). Coaching Form only. When nobody is named and the manager's words make the team the subject, the proposal carries `subject: "team"` and `employeeName: "All team members"`; the draft prompt says SUBJECT: the whole team. The create route refuses that label on any other template.
- **Coaching register** (`lib/forms/coaching-framing.ts`). Prompt rules for both coaching documents; on the Coaching Form, notes with no sign of a shortfall cannot come back ticked Underperformance or with a sentence calling it a concern/issue/problem. Intake and quick-action wording no longer assume a concern.
- **Grammar cleanup** — prompt rules on every coaching draft and revision; the existing grounding guards still strip invented dates, figures and discipline.
- **Name check** (`lib/forms/employee-match.ts`, `lib/forms/employee-roster.ts`). Coaching, Follow-Up Coaching, Corrective Action, Policy Review, SDIT EPP, TSD EPP. Matched only against the actor's scoped roster (salon scope → their salons; global → all; district/region/demo → none). Exact → directory spelling. Close or lone first name → "Did you mean …?" and no Create until answered ("yes" / "no" / a name). Several → all offered, none chosen. No match → kept as typed, with a note. Terminated employees are excluded. Any read error → empty roster → old behaviour.
- **Location precedence** (`lib/forms/location-scope.ts`): named salon → employee's directory salon(s) within scope → account scope. Salon picker shows roster names.
- **Persona** (`SUNNY_VOICE` in `lib/ai/prompts.ts`) on every chat answer; forms stay neutral.
- Name stop-words: `bed`, `sanitizing` and similar — "since our coaching on bed sanitizing" was naming an employee "bed sanitizing".

## Schema / data

None. No migration, no new table or column, no RLS change. Team subject uses the existing free-text `employee_name`. Revisions write `form_instance_values` through the existing upsert and record a `drafted` event with `detail.revision = true`. The directory is read server-side with the secret key, read-only.

## Permissions

- No permission or matrix change. Every revision re-runs `authorizeInstance(..., "edit")`.
- New read of `employee_access_directory`, `employee_location_affiliations`, `woven_location_map`, `salons` from the proposal path. This is the first consumer of the phase-one directory outside admin screens. It grants nothing; names are scoped before they leave the server.
- District/region-scoped accounts still cannot create a salon-bearing form (unchanged, fail-closed). Wiring `lib/reporting/scope/reporting-areas.ts` into form authorization would change all nine instance verbs for every template and needs its own approval.

## Not done / needs a decision

- Coaching Form has no expected-timeframe field; adding one changes the authoritative docx-derived document (new revision) — a business decision.
- ~~Typing an explicit calendar date in a revision does not set the instance date.~~ Superseded 2 October — see below.
- District/region scope for forms (above).

## Tests

`lib/forms/coaching-feedback.test.ts`, `lib/forms/employee-roster.test.ts`, `app/api/forms/coaching-feedback-e2e.test.ts`, `app/api/chat/form-revision-wiring.test.ts`, `features/chat/coaching-feedback.dom.test.tsx`. Ten mutation checks run against them; all ten fail at least one test.

---

# Production QA follow-up — 2 October 2026

Production QA of `9cd8dea` (PR #81) found two failing items and several partial ones. Fixed here; no migration, no schema, RLS, permission, scope, Woven or template change.

| # | Issue | Root cause | Fix |
|---|---|---|---|
| P1 | "…coaching form for general training for staff…" became an employee called "general" (also "group", "team-wide"); "I need team-wide coaching…", "Coaching for everyone at the salon…" and "…— can you write up a coaching form?" made no form | The name reader takes the lower-case word after "coaching form for" as a typed name, and a named person beats the team. Intent detection had no reading for a team-subject coaching request without "a coaching" / "form", and a closing "?" read the third as a question about forms | `maskTeamSubjectPhrases` removes team descriptors before any name is read (a real name still wins); `asksForTeamCoaching` reads team + coaching/training + a request as the Coaching Form; defensive stop words |
| P2 | "Kaitlyn improved and followed the sanitizing procedure correctly during today's observation" went to the knowledge base; with "Add this to the form:" only Follow-Up Observation was written | No edit verb, so not a revision; the follow-up detector needed "has improved". The word "observation" is that field's alias, so the turn was read as an instruction to change that one field | `reportsFollowUpResult` routes a follow-up report on an open Follow-Up Coaching Form; `findingsSupportedBy` decides which findings the words support (observation + evidence; progress only with progress words; next step and additional coaching only when stated); a field restricts a revision only when **instructed** (`instructedFieldsIn`) |
| P3 | Vague edits let a model rewrite every Sunny-written field; "re-draft a cleaner version…" and "open the form and change…" were not edits | `mayChange` allowed all non-manager fields when nothing was named; `ASKS_FOR_A_FORM` matched "draft a" inside "re-draft a" and any "open" | `scopeRevision` — four modes enforced by the merge: `fields`, `findings`, `additive` (text only, existing content kept), `wording` (reword existing text only, substance kept, no ticks, nothing emptied or newly filled); "keep X" protects X; routing fixed |
| P4 | "Change the follow-up date to 10/15" never moved the date and could write "10/15" into Next Follow-Up | Date and timeframe were not told apart before the model | Date turns are read first and never reach Next Follow-Up. One real, not-past date is set through `setFollowUpDate` (the same function the date control uses, same `edit` authorization, drafts only); anything else gets "I didn't change the follow-up date. Use the Follow-up date control on the form." Timeframe turns ("follow up again in 10 days") update Next Follow-Up only, and a calendar date the manager never gave is dropped from it |
| P5 | "…again before the new checklist starts" switched the Underperformance guard off | "again", "still", "missing" were shortfall words on their own | Contextual reading: unambiguous words (unless negated), a duty not done, and "still/keeps/missing" only beside a shortfall |
| P6 | "Progress Level, ." in the confirmation; a removal stamped `manager`; a capitalised field or option name ("Progress Level", "October 15") read as a different person | Next Step has no group label and `?? ` did not fall back on `""`; clear wrote `filled_by = manager`; person check saw form vocabulary | Label fallback; a removal is written `system` with provenance `{ source: "cleared_on_request" }`; the person check ignores the form's own labels and month-day dates. Inline refresh already worked through `formUpdate` and is now tested, including the date |
| P7 | "Risk Management", "No Manager", "GlowBrands IT Support" could be suggested | Service rows sit in the Woven directory as active employees | `isServiceAccountName`: a row is left out of the forms roster only when **every** word of its name is a department/role/system word. Woven data untouched |

## Still a business decision

- **Team-wide PDF acknowledgement.** A team-wide Coaching Form prints "I confirm that my supervisor and I have discussed this training and plan for improvement" with one Employee Signature line. That wording is the authoritative template's; changing it needs an approved team wording (and a new template revision).
- Coaching Form expected-timeframe field; district/region form authorization — unchanged from above.

## Tests

`lib/forms/coaching-qa-fixes.test.ts`, `app/api/forms/coaching-qa-fixes-e2e.test.ts` (every QA phrase, with a deliberately badly behaved model), `features/chat/coaching-qa-fixes.dom.test.tsx` (inline refresh), and a wiring case in `app/api/chat/form-revision-wiring.test.ts`.
