# The prior steps the manager states reach the card and the saved form, and leave the Observation (Ask Bubbles #1045, 316a10bc, its QA's live round-2 re-run, U09) — ported

**Report (Ask Bubbles' production, no names):** T1 "create a written CA for <P>." T2 "JBA Policy Manual 1-1-2026, Verbal CA
11-1-2026. On 11-1-26 <P> violated care and cleaning of facilities policy". The stated prior actions were not listed
(the card and the saved form kept the forms-on-file list), and "(JBA Policy Manual 1/1/2026)" landed in the Observation.

**Ask Sunny: same gap.** Sunny's port of #1015 (`priorActionsSplit`) checks each step on its own but keeps the rule that
a step carrying the incident's date is refused, so the Verbal CA the manager dated on the incident's day was left off.
Nothing took a kept step out of the account. The replay cases below fail on main.

**Port (the mechanism; names invented):** `agent-loop/tools.ts`:
- `datedByManagerForStep` (used by `priorActionsProblem`): a date the manager typed in the same clause right after the
  step's own words ("Verbal CA 11-1-2026") is that step's date, even when it is also the incident's. The model copying
  the incident's date onto an older step has no step word before it, and is still refused. Clause words, no list.
- once the card keeps a prior step, a parenthesis in the account holding that step's date and one of its words is that
  step, not this incident, and leaves the account. The kept steps' own text decides.
- replay harness: `checkOnForm` and `templateIds` (the same lines as the U16 port).

**Tests:** `prior-step-own-date.test.ts` (with a control: the incident's date copied onto an undated step is still left
off); replay `nov22-agent-loop-u09-stated-prior-cases.ts` (the tester's words, a global login, an invented person with
CAs on file; asserts the card and the saved form after Create). Changed on purpose, each with a note:
`prior-actions-split.test.ts` and `nov22-r2-u09-good-prior-step-kept`, which expected the dated Verbal CA left off (the
outcome QA reports as the bug).

**Saved form date (QA, 22 Nov 2026; open, not this port's):** Ask Bubbles' saved form_date showed today instead of the
incident date. The same chat on Sunny: the card keeps no date (formDate null, though the model sent incident_date
2026-11-01), so Create dates the form today (`instances.ts`, `input.formDate ?? recordToday()`). Main 9de3675 does the
same, so this port neither causes nor fixes it; nothing in the port reads "now". Recorded as the open replay case
`nov22-u09-saved-form-dated-the-incident` (expected to fail until the dating fix lands).

**Live harness:** Sunny has the harness (`AGENT_LOOP_LIVE`), but this session's permission check refused the run with the
available key, so it was not run here.
