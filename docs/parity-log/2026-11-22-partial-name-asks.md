# A partial name never seats a roster person on a card without asking (22 Nov 2026, board f110)

**Sibling app: port to Ask Bubbles** (same `rosterMatches` / `findStaff` in `src/lib/ai/agent-loop/tools.ts`, checked
at Bubbles `4fd060f`). Mechanism only; no names or roster wording.

#1160 (f065) made a partial name ask on forms on file ("show me forms for Tes"). The card side still took a typed word
that only STARTS a roster name as that name: "ca for Rowan Kes" made Rowan Kestrel's card with no question, and "ca for
Row Kes" returned Rowan from find_staff and then refused the card with "Who is this form for?". A single partial word
("Row") already asked, through the close-spelling check.

`findStaff` now keeps only the people whose names the typed words hold whole (`namedWholly`); when none are, the people
the words only start are a Did-you-mean (`close_spelling_not_confirmed`, recorded as a name question), unless this chat
already confirmed that spelling for one of them. propose_form's own lookup uses the same code. Tests:
`agent-loop/partial-name.test.ts`; replay `nov22-agent-loop-partial-name-asks-cases.ts` (invented Rowan Kestrel; fails
before the fix, passes after, with the whole-name control).
