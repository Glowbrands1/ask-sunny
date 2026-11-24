# A name typed surname first is the roster's person (the 266-chat run's 117): same gap in Ask Bubbles, port pending

**Report (Ask Sunny, the 266-chat run, re-checked on main 7787aa9):** a pasted write-up named the person surname first
with a possessive ("… it was confirmed that <Last> <First>'s utilized tanning equipment …"), and the name was never
read as the roster's person.

**Fix (the mechanism, roster data only):** `matchEmployeeName` reads the roster's own "<last> <first>" order when the
typed order matches nobody, for one person only (two people with that name reversed is no match; the typed order wins
when it matches someone). With the possessive read (#1246), "<Last> <First>'s" is that person. find_staff's order-free
match already found a reversed name alone; the possessive read and the older chat path use matchEmployeeName.

**Ask Bubbles: same gap.** Bubbles' `employee-match.ts` has no reversed-order read. Port it after the possessive port
(the parity entry 2026-11-22-typed-name-possessive), with the unit tests and the replay case below with Bubbles'
roster and store.

**Tests:** `employee-match.test.ts` ("a typed name in the roster's last-first order", three controls); replay
`nov22-agent-loop-reversed-name-cases.ts` (117's exact words, an invented person): fails with #1246 alone, passes with
this fix.
