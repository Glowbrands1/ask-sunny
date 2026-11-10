# Sunny-only: ACCOUNT_BEFORE_REQUEST_ENABLED (the account given before "Create a coaching form." reaches the draft)

A manager's production chat, relayed by coding 3 (5 Nov 2026): "<name> marked a session as complete but the guest
hadn't been sprayed yet" → "Create a coaching form." → "yes". The card showed her account as its Observation but cited
only the request and "yes", so Create never handed it to the drafting model. With the flag, a manager turn before the
card's first cited turn whose words the card's Observation shows in full is cited too (`ai/account-turn-sources.ts`).

Not needed in the sibling app (checked on its main 14510ae4): its replay twin
`nov5-coding3-account-before-the-request-reaches-the-draft` already holds on its production flags, so the drafting
model is handed her account there.
