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
- Typing an explicit calendar date in a revision ("follow up on 10/15") does not set the instance date; the manager sets it with the control.
- District/region scope for forms (above).

## Tests

`lib/forms/coaching-feedback.test.ts`, `lib/forms/employee-roster.test.ts`, `app/api/forms/coaching-feedback-e2e.test.ts`, `app/api/chat/form-revision-wiring.test.ts`, `features/chat/coaching-feedback.dom.test.tsx`. Ten mutation checks run against them; all ten fail at least one test.
