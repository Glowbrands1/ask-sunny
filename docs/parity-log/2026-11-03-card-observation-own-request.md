## 3 Nov 2026: a new request's card reads back only that request — Sunny (CARD_OBSERVATION_OWN_REQUEST_ENABLED, default off)

QA live check, 3 Nov 2026 (NEW_REQUEST_OPEN_DRAFT on): the new card for "make
me a CA for <name> for being late to opening this morning" read "Observation
of Offense: …rugs untl 12;30pm <name> for being late to opening this
morning". On, the card's Observation read-back (`keep-filled-slots.ts`) reads
only the turns of the current request (`currentRequestTurns`, as Prior
Actions already does). Ask Bubbles has no such read-back; checked separately.
