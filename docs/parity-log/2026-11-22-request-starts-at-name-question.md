# A "Did you mean" for this form starts the request; payroll may come from any turn of it (Ask Bubbles #1043, 80ae960a, U35(ii)) — ported

**Report (Ask Bubbles, its QA's live re-run 2):** T2 "i have an employee, <P> that needs a corrective action form …" got
propose_form's own "Did you mean <P>?"; T3 "verbal warning, no payroll deduct, part-time team member,"; … T11 "Create a
Corrective Action Form from this conversation."; T12 "it was a customer complaint …". The last card and the saved draft
had no level and no payroll.

**Ask Sunny: same gap, found live too.** QA's live set on #1234 (22 Nov 2026), case
`nov22-r2-u35-level-and-payroll-carry-across-no-card-reply`: at T11 the model called propose_form again, in its own words
for the account, with payroll_deduct "no" quoted from T3. The server refused it (`payroll_not_stated`,
`evidence_after_card`). The account no longer matched T3's card, so nothing carried, and the card lost payroll No (4 of 6
live runs). Main passed only when the model made no new card at T11. Payroll could be quoted only from the request's first
turn.

**Port (the mechanism; Sunny's fixtures, names invented):**
- `card-record.ts`: a name question records the form propose_form was making (`templateKey`, a template key, never a name).
- `run.ts`: a name question asked by this turn's propose_form call gets that call's template key.
- `tools.ts`:
  - propose_form's name question for this form about this person marks the request's start, as the card and "who is it
    for?" records do.
  - A walk back that stops at a form request naming nobody runs from this card's earlier request-start record.
  - Payroll may be quoted from any turn of THIS request, as the level. This narrows the 16 Nov rule on purpose.

Still refused: a turn before the request, another person's turn, and "make this for <B> instead of <A>". Records and the
app's own form reader, never a word list.

**Sunny differs from Bubbles:** a new incident still starts clean, read from data. Sunny's own PR 1c case (Remy's "yes",
"thanks", then "another ca for remy calder, late on 11/14 too" after the 11/12 card) would otherwise take the old "yes",
because Sunny's request walk reaches back to the first card. Bubbles has no such case. So when the request's latest card
for this person holds an incident date and this card gives another, an earlier turn's payroll answer is that card's, not
this one's.

**Tests:** replay `nov22-agent-loop-request-starts-at-name-question-cases.ts`.
- Sunny's live case: the model re-proposes at T11 with its own account and payroll quoted from T3.
- The tester's T2–T12 as a salon director and as an admin.
- Three controls.

Without the fix, the three fix cases fail (6 runs across the two flag modes) and the controls pass. With it, everything
passes.

**Live harness:** not run here; the permission check refused the key. QA runs Sunny's live set from their session.
