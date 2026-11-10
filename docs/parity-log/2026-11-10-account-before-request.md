# ACCOUNT_BEFORE_REQUEST_ENABLED: the sibling app needs it too (port: coding 5)

A manager's production chat, relayed by coding 3 (5 Nov 2026): "<name> marked a session as complete but the guest
hadn't been sprayed yet" → "Create a coaching form." → "yes". The card showed her account as its Observation but cited
only the request and "yes", so Create never handed it to the drafting model. With the flag, a manager turn before the
card's first cited turn whose words the card's Observation shows in full is cited too (`ai/account-turn-sources.ts`).

**Corrected 10 Nov 2026 (QA's P14 triage).** This entry first said the fix was not needed in the sibling app, because
its replay twin `nov5-coding3-account-before-the-request-reaches-the-draft` holds on its production flags. That twin
is a single account turn. Pau's P14 (Sunny production, 9 Nov 2026) has the same bug in a longer shape: the account over
several turns, the app's answers between them, then "create a coaching form for <first name>" and a name-confirm
"yes". Replayed on the sibling app's main (a529c29e) with its production flags and an invented name, the drafting
model there is handed only the request and "yes", not the account. So the sibling app has the bug. QA assigned the
port to coding 5 (10 Nov 2026); this entry no longer says it stays Sunny-only.
