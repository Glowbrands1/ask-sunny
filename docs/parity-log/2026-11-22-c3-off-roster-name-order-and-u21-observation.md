# An off-roster "<Last>, <First>" gets its card, and find_staff and propose_form agree; prior steps stay out of the Observation (Ask Bubbles #1054, 92b904a0, its QA's live round 3: C3, U21, U09) — ported

**Report (Ask Bubbles' production):**
- **C3:** "create a CA form for <Last>, <First> at <place>. she was late on 10-16" (nobody on the staff list) got
  "<First> <Last> isn't on your … staff list, and the form wasn't built" about half the time. The model passed the name in
  first-last order; propose_form's as-typed checks looked for that order in the manager's words and missed it, while
  find_staff's code said "propose it as typed". The model went round 3–6 times and gave up.
- **U21:** the model wrote the prior coaching (T3) and T4's policy acknowledgement into the account as whole sentences.
- **U09 (live triage):** "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 <P> violated …": the model kept
  only the Verbal CA and wrote "JBA Policy Manual 1/1/2026." into the account.

**Ask Sunny: same gaps.** Sunny's `lookUpForCard` refused a name find_staff took as typed, and Sunny had no reader for a
first-last name the manager wrote only as "<Last>, <First>" (coder 2's #1216 shows "<Last>, <First>" as "<First> <Last>",
but only when the model passes the comma form). Sunny's account kept prior steps written as sentences. The replay cases
below fail on main.

**Port (the mechanism; Sunny's salon and duties, names invented):**
- `asManagerCommaWrote`: a two-word name the manager wrote only as "<Last>, <First>" in this request is read in the
  manager's order, so it takes the comma form's as-typed path; `lastCommaFirst` (#1216) shows it as "<First> <Last>".
- `lookUpForCard` returns `asTyped` when find_staff's own result takes the name as typed (not_on_roster, nothing to
  ask): propose_form takes the same name on the same call, with the off-roster name question recorded.
- `accountWithoutPriorSteps` / `sharesContentWord` / `stepShaped`: a parenthesis or a sentence whose every date is a
  step the card's Prior actions holds, sharing a content word with it and holding no date of this incident, leaves the
  account; a sentence that only lists the card's steps leaves it whatever its dates; the account is never emptied.
- `listedWithKeptSteps`: a step the manager listed in the same sentence as one the card keeps is on Prior actions too.

**Not ported, and why:**
- Bubbles' `priorActionsWithStatedTopics` change (a stated "<step> — <date>" the model's list dropped is added back):
  Sunny has no `priorActionsWithStatedTopics` (its stated-steps base is a Bubbles commit Sunny never took). The U21 case
  here has the model list both steps, as the live model did through T4.
- Bubbles' open case `nov22-u21-r3-form-date-never-a-prior-step-date`: the form date is the form-date port's (Bubbles
  coder 1's PR 2), which comes later.
- #1234 (U09, Bubbles #1045) is not merged yet. It removes a parenthesised step in `proposeForm`; this port's
  `accountWithoutPriorSteps` does that too (and more), so when both are on main the #1234 block is redundant and can go.
  The U09 listed-step case is open here: on main the Verbal CA dated on the incident's day is refused, so the card keeps
  no step; it passes with #1234.

**Tests:** `last-comma-first.test.ts` (asManagerCommaWrote), `account-without-prior-steps.test.ts` (with controls);
replay `nov22-agent-loop-c3-off-roster-name-order-cases.ts` (3 cases) and
`nov22-agent-loop-u21-prior-steps-out-of-observation-cases.ts` (U21 fixed; U09 listed-step open until #1234).

**Live harness:** not run here (the permission check refused the key); QA runs the live set.

**Gap found in Sunny's CI (also in Ask Bubbles #1054, for Bubbles to mirror):** `listedWithKeptSteps` read the
incident's own clause as a listed step when the card had no incident date. Sunny's nov14 batch-B case "ca for tamsin
orwell, she was late on 11/12, she had a verbal on 10/2" (the model's account "Tamsin Orwell was late on 11/12.", no
incident_date) got Prior actions "Verbal CA — 10/02/2026; she was late on — 11/12/2026". Fix: `listedWithKeptSteps`
takes the card's account; a clause whose date is in the account is this incident, as one on the incident's date is.
Unit test (`account-without-prior-steps.test.ts`), failing before, passing after:
`listedWithKeptSteps("ca for tamsin orwell, she was late on 11/12, she had a verbal on 10/2", "Verbal CA — 10/02/2026", null, "2026-11-22", "Tamsin Orwell was late on 11/12.")` → `[]`.
