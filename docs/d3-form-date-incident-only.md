# D3: the form's date is the incident's (FORM_DATE_INCIDENT_ONLY_ENABLED)

Rule (Pau's coordinator, 25 Oct 2026): the form's date is the incident date the
manager stated, or the day the form is created. It is never a deadline, a due
date, an assignment date, a prior-action date or a "by <date>".

Status: **on hold** until Pau gives a plain yes/no on D3. Default off in both
apps.

## Where it lives: no protected file is edited

The first version changed `isDeadline` in the protected
`src/lib/forms/form-date-answer.ts`. That made `extractFormDate` blind to
"by <date>". `form-proposal.ts` (also protected) uses `extractFormDate` to decide
whether a turn continues an open intake, so a typed Action Plan turn
("action plan: complete the Woven policy module by 10-30-26 and review it with
her manager") dropped out of the intake. That was the blocker in
`action-plan-manager-only-e2e`.

The current version leaves `form-date-answer.ts` exactly as on main. The rule
is in a new module, `src/lib/forms/form-date-incident-only.ts`:

- `notTheIncident(text, index, end)`: the date sits after "by", after
  "assigned", before "… deadline / due date", or inside "verbal (…)".
- `incidentOnly(text, today, found)`: drops those dates when the flag is on.
  Otherwise it returns `found` unchanged.

The module is applied only where the form's date is chosen:

| Caller | File | Change (flag on only) |
| --- | --- | --- |
| `incidentDates` | `src/lib/forms/incident-dates.ts` | incident dates without D3's non-incident dates |
| `decideFormDate` | `src/lib/forms/incident-dates.ts` | if the date the card would take (the first date read, i.e. `extractFormDate`'s) is not the incident: the one incident date left, or `formDate: null` (dated the day it is created) |
| `explicitIncidentIso` | `src/lib/forms/explicit-incident-date.ts` (Sunny) | same filter |
| `singleIncidentDate` (late-open) | `src/lib/forms/late-open.ts` | same filter; "late on 10-5 and 10-15" reads both dates |
| `groundedDate` (remap) | `src/lib/ai/form-full-remap.ts` | same filter; a step "given on <date>" is prior only when the turn dates the incident another way |
| `newestDate` (remap) | `src/lib/ai/form-full-remap.ts` (Bubbles) | same filter |

`extractFormDate`, `listFormDates` and `listIncidentDates` read every date, as
on main. The intake, the account the draft keeps, and the Woven and edit
readers are therefore unchanged.

**Can D3 live in `incident-dates.ts` / `decideFormDate` alone?** For the
Corrective Action card, yes. `form-proposal.ts` sets `formDate` from
`extractFormDate`, then lets `decideFormDate` override it whenever it returns a
`formDate`. `decideFormDate` now returns `null` or the remaining incident date
when that first date is not the incident. The remap (`form-full-remap.ts`) and
the late-open reader choose their own dates, so they call the same filter.

## What changes with the flag on (intended)

A date written as the deadline itself never dates the form, so the card is
dated the day it is created:

- "she missed the 10/15/26 woven deadline", "she blew the 10/15/26 woven
  deadline", "didn't finish her woven items by 10-15-26": dated today, not
  10-15.
- Not changed: "missed the woven deadline **on 10/15/26**". The date follows
  "on", not "deadline", so it is read as the day she missed it and the form is
  dated 10-15. **Question for the coordinator:** should these two wordings
  agree? D3 as written says "never a deadline". The "on 10/15" form reads as the
  day of the miss.

Tests whose expectation changes on purpose. Each has a flag-on twin with a
why-comment in its own file:

- `src/lib/ai/remap-incident-oct24.test.ts` (B5)
- `src/app/api/chat/b18-new-chat-new-draft-e2e.test.ts` (×5)
- `src/app/api/forms/corrective-action-dm-feedback-e2e.test.ts` (×3)

## Never-break (pinned flag off and on, lowercase and sentence case)

- A stated incident date is the form's date ("tanned on the clock on 9-28-26",
  "10/22/2026 is the date of incident").
- "she was late on 10/20 and missed the 10/15 deadline" is dated 10/20.
- "She was late on 10/5 and 10/15" lists both dates.
- "write up <name>, i gave her a verbal on 10-21 for being late" is dated 10-21.
- A typed Action Plan with "by <date>" keeps the intake open
  (`action-plan-manager-only-e2e`).

## The live card path (rollback of 26 Oct 2026)

The flag was switched on in production at 08:45Z and rolled back at 08:51Z.
The live card test (invented names) showed "coached her 10-16, written
warning on 10-20" dated 10/20, "late on 10-5 and 10-15. i coached her on
10-16" dated 10/16 (the coaching), and "missing the woven deadline of
11-1-26" dated 11/1. The unit probes had passed because they did not run
production's flags; `FIELD_ACCURACY_ENABLED` was the one that mattered.

- `src/lib/ai/intake-augment.ts` `fieldLines`: the intake added "It happened
  on <the last month-day date>" to the intent question, and the card dates
  the form by that line. On, the line names the one incident date left once
  earlier steps and deadlines are set aside (on a Coaching Form, the one
  coaching held), and is not written for none or several.
- `src/lib/ai/intent-slots.ts` `groundDate`: the slot model's date, typed by
  the manager, was taken as the incident's. On, a date every mention of which
  is a deadline, assignment or earlier step is not.
- `form-date-incident-only.ts`: "deadline of / is / was <date>". "missed the
  woven deadline on 10/15/26" is still the incident's day.

Pinned through `answerQuestion` with production's flag profile:
`src/lib/ai/d3-card-date-live-path-oct26.test.ts` (lowercase, sentence case,
ALL CAPS; fails before, passes after).
