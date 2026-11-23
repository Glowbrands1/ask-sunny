# A Coaching card's account is labelled with the form's own label, "Details of Coaching" (the 266-chat run's 039/241): same bug in Ask Bubbles, port pending

**Report (Ask Sunny, the 266-chat run, re-checked on main 7787aa9):** a Coaching Form card read "**Observation of
Offense:** Coaching on how to update clients' checking account information …". The coaching form's account field is
"Details of Coaching"; the rules book gave every incident card (Corrective Action, Coaching, Follow-Up Coaching) the
Corrective Action's label.

**Fix (the mechanism):** propose_form's card (and the team Coaching card) carries `account_label`, the label of the
form's own account field (`observation` or `coaching_details`) read from its template document; the rules-book line
writes "**<card.account_label>:** <card.observation>". No form list. Fixtures re-taken (noted in app-config.test).

**Ask Bubbles: same bug.** On Bubbles main 1e58cd6 the rules-book line is identical and its library has the same
fields (coaching_details "Details of Coaching", observation "Observation of Offense"). Port the mechanism, re-take
Bubbles' fixtures, and the replay case below with Bubbles' roster and store.

**Tests:** replay `nov22-agent-loop-coaching-account-label-cases.ts` (the manager's words, an invented person): fails
before (no account_label on the card), passes after; a Corrective Action control keeps "Observation of Offense".
