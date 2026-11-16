# Agent loop: a name taken as typed is shown in title case (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

QA (train 5): "coaching for test testy on greeting guests", a name not on the staff list typed in lowercase, came back
"Here's the Coaching Form for **test**". In the loop, a name taken as typed with no capital letter is now title-cased
(`shownAsTyped`) on the card's name, the reply_name and the pronoun pass, as today's path does (`offRosterTyped`'s
`titleCased`). A name typed with any capital stays as typed, and a roster match keeps the roster's spelling. Port with the
rest of the loop when Ask Bubbles gets it.
