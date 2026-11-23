# A typed name's possessive never keeps the person off the roster (the 266-chat run's 053/116/117/138/237/239): same bug in Ask Bubbles, port pending

**Report (Ask Sunny, the 266-chat run, re-checked on main 7787aa9):** "Odalys Brindle's, today, - …" (and "For
Tavish Marisol's", "Odalys Brindle's utilized tanning equipment …") carded the name with the "'s": "**Odalys Brindle's**
isn't on your salon's Woven staff list, so I've used the name as you typed it", or asked "Did you mean …?" for a person
on the roster. Cause: no step read a trailing possessive as grammar; `tidyTypedName` only tidies spacing.

**Fix (the mechanism, no word list):** `possessiveRead` (`employee-match.ts`): a trailing 's / ’s on the typed name
leaves only when the name without it is the one the roster matches (QA's ruling). The name as typed is kept when it
matches exactly itself, when it has no possessive (a surname ending in s, "Ross"), or when the name without it matches
nobody. Applied in `matchEmployeeName` and at the loop's two typed-name reads (find_staff, propose_form).

**Ask Bubbles: same bug.** On Bubbles main 1e58cd6 `employee-match.ts` has no possessive read, and find_staff and
propose_form read the typed name the same way (`tools.ts` 1324, 3574). Port the mechanism, the unit tests and the
replay case below with Bubbles' roster and store.

**Tests:** `employee-match.test.ts` ("a typed name's trailing possessive", with "Ross" controls); replay
`nov22-agent-loop-possessive-typed-name-cases.ts` (138's exact words, invented people): fails before (the card keeps
"Remy Calder's"), passes after; the "Juno Ross" control passes on both.
