# "Open <First>s ca" asks about <First>'s forms, not someone else's (22 Nov 2026, QA's shadow re-run S1)

**Sibling app: port to Ask Bubbles** (the same `formsOnFileAskedFor` person guard in `src/lib/ai/agent-loop/tools.ts`,
checked at Bubbles `4fd060f`). Mechanism only.

QA's 266-chat shadow re-run (S1, high): "open <First>s ca", a possessive typed with no apostrophe, was read as a name
of its own ("<First>s"). The forms-on-file person guard therefore kept <First>'s forms closed as someone else's
(privacy_not_this_person), and the loop went round for six turns. `withRosterPossessives`: a word that is a roster
person's first, preferred or last name followed by a bare "s", and is not itself a roster name, is that name's
possessive. Read from the roster's own names; no word list. Tests: `agent-loop/roster-possessive.test.ts`; replay
`nov22-agent-loop-possessive-no-apostrophe-opens-cases.ts` (invented Remy Calder; fails before, passes after;
"open Junos ca" still keeps Remy's forms closed).

S1(b), a bare "1" or "yes" answering the loop's own question, is a separate item.
