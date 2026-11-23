# The card/reply keeps whose it is: the first possessive of the named person is "<Name>'s" (port of Ask Bubbles #1075, 9ce649e) — ported

**Report (Ask Bubbles, Pau's round 3, U23):** "about her personal life" read "about the personal life" on the card and in
the reply, and "her boyfriend" "the boyfriend": whose it was got lost.

**Ask Sunny: same code.** Sunny's `reply-pronouns.ts` has the same possessive pass (the replay case fails on main).

**Port (QA's ruling, option B, card/reply pass only):** the first possessive of the person already named keeps its
owner ("<Name>'s"); "the" only after a place or time preposition (item 19) or once the sentence already said whose
(QA2's R3 puppy: "show <P>'s team the new puppy"). The saved write-up's pass (`employee-reference.ts`, HR's 3 Oct
design) is untouched, so the card and the saved form may differ on a possessive, by design.

**Tests:** `reply-pronouns-possessive-repeat.test.ts` (the R3 puppy expectation CHANGED ON PURPOSE, with a comment; U23's
T5/T6 and two controls); replay `nov23-agent-loop-possessive-keeps-owner-cases.ts` (Bubbles' T5/T6 wording, Sunny's
salon and roster): fails on main, passes after.
