## 3 Nov 2026: "Yes" to "Is this for <name>?" keeps the form request — ported from Ask Bubbles (52a0699) (FIRST_NAME_YES_KEEPS_REQUEST_ENABLED, default off)

Replay set b2 in Ask Bubbles: the first name came in an account, the form was
asked for in the next turn, and "Yes" to "Is this for <full name>?" rewrote
the turn into the account alone (`answeredNow`, `ai/first-name-suggest.ts`):
no card. Ask Bubbles' entry for that fix said Sunny never asks the question
in that chat; with FIRST_NAME_SUGGEST_ENABLED recorded as on in production
it does, and the card still comes, so this is a parity port (Pau, master plan v4: same flag in both
apps), not a fix of a live failure here. Same code path, same flag; off,
unchanged.
