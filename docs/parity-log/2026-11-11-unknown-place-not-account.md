## 11 Nov 2026: UNKNOWN_PLACE_NOT_ACCOUNT_ENABLED — a place after the name that is not a salon is not the account

**Not needed in Ask Bubbles: it does not have this bug.**

QA's D5 follow-up: an all-salon admin's "Create an SDIT EPP for <name> at IA Altoona" (not one of the salons) put the
whole request on the card as "**Observation of Offense:**"; "Create a coaching form for <name> at IA Altoona" put
"<name> at IA Altoona" there. The line is added by `withObservation`/`withAccount` in `ai/keep-filled-slots.ts`; with
the flag on (default off), "at <Place>" straight after the employee's name is where, not what happened
(`ai/unknown-place-not-account.ts`).

Ask Bubbles has no `keep-filled-slots.ts`. Probed on its main (11 Nov 2026, replay, production flags, a global district
manager): "Create a coaching form / a corrective action / an exit form for <invented> at IA Zephyrton" (no such store)
put no account line on any card.
