# KEEP_ROSTER_EXACT_NAME_ENABLED: the slot keeper keeps an exact roster name with a not-a-name word in it (Sunny only)

**Report.** QA, 4 Nov 2026, live: Pau's message 1 for the QA test account's own roster entry, a name that ends in "One". The reply said "I'll draft a Corrective Action Form for <that name>", but the card's Employee was empty ("Not yet — tell Sunny who this form is about").

**Cause.** This was not the shared-login exclusion or the self exclusion. Two steps combine:

1. The slot keeper (`src/lib/ai/keep-filled-slots.ts`, `keptName` / `isFragment`) reads any name that contains a word from `NOT_A_TYPED_NAME` ("one", `src/lib/forms/name-words.ts`) as a fragment.
2. `newestName` finds several candidates in the message and so returns none, which leaves the card's employee null.

The reply sentence had already been written from the name. `matchEmployeeName` does not help either: it compares word by word, so a two-word roster first name is never `exact`.

**Fix.** Behind the flag, default off: a name that is somebody's whole roster name (first or preferred, then last) is never a fragment, and the card keeps the roster's own spelling. Names that are not on the roster are handled as before; QA L23's "One Tanner" is still dropped.

**Why Sunny only.** Ask Bubbles has no slot keeper (no `keep-filled-slots.ts`, `grounded-turn` or `keptName`), so this blanking path does not exist there. Bubbles' readers still treat "one" as a stop word, but there that produces a shorter name or a "who is this for?" question, not a reply that drafts for a name the card does not hold.
