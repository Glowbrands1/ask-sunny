# A re-propose of the card on screen keeps its account (port of Ask Bubbles #1077, 1d211cf) — ported in part

**Report (Ask Bubbles, Pau's round 3, U35 T11 and U21 T7):** "Create a Corrective Action Form from this conversation."
re-proposed the card on screen with no what_happened, and "add the direct policy …" with no prior_actions: the card lost
its Observation, or its Prior actions.

**Ported here (the account):** Sunny's propose_form reads the account from the request's own words, as Bubbles did, so
the same call wiped the card's Observation (the replay case fails on main). With this person's card on screen (by
roster id, name, or the name this call corrects) holding an account (its record's account key), a call with no account
goes back once (`card_account_missing`). A switch between the account forms (CA ↔ Coaching) carries the account; a
switch to the exit form does not (QA's ruling). A card never given an account is made as before.

**Not ported yet (the prior actions, U21 T7):** Bubbles' guard reads the card record's step dates (`priorDates`) and
`priorStepDates` (`prior-step-dates.ts`), both from Bubbles #1056 (round 3: U09/U16/U21 dates), which is on no Sunny
branch. Sunny #1234 (the U09 form-dates port, head 9f50e6d) was checked: it reads prior-step dates inside propose_form only (a local `priorDates` set), with no card-record field and no `prior-step-dates.ts`, so it does not carry what the guard reads. Parked by QA (23 Nov 2026): not porting all of #1056 now; the guard lands when the card record carries the step dates.

**Tests:** replay `nov23-agent-loop-card-keeps-account-cases.ts` (Bubbles' T11 wording, Sunny's roster): "Create … from
this conversation" and a switch to Coaching with no account fail on main and pass after; controls: no account ever
given (made as before, never handed back) and a switch to the exit form (never handed back).
