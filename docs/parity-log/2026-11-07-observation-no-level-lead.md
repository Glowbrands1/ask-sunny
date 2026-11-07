# Sunny-only: the warning level never leads the Observation (OBSERVATION_NO_LEVEL_LEAD_ENABLED)

The flip-3 tester's D shape, in this app (QA, 6–7 Nov 2026): "create a CA for <name>, verbal, she was late on
10-20-26" made the card's Observation of Offense "verbal, she was late on 10-20-26". `managerAccount`
(`ai/remap-incident.ts`, the Observation's path in `keep-filled-slots.ts`) kept every comma clause that was not
the request or the name. With the flag on, a clause that is only a warning level is not part of the account.

Not needed in the sibling app as this change: its card has no Observation line and its `remap-incident.ts` has no
`managerAccount`. The same shape there showed as the card's Issue ("**Issue:** verbal"), which its
ISSUE_IS_THE_ACCOUNT_ENABLED (Ask-bubbles #518, merged 7 Nov 2026) fixes: a bare level clause or a short clause
naming the person is passed over.
