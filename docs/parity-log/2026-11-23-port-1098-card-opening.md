# Port from Ask Bubbles (#1098, 9f6babf): an exit reply's unsaved line leaves alone, and a card reply that names no form opens with the card's own opening (23 Nov 2026)

**Source:** Ask Bubbles #1098 (merged, 9f6babf; coder 5). Mechanism only; this app's people and forms.

Ask Bubbles' QA (u22 live records): the exit reply opened on "<P> shows as no longer active …" with no form named. There
were two causes, and both are the same code here.

1. `withoutUnsavedExitLines` (exit-read-back.ts) left the whole reply line out when an unsaved exit label was anywhere on it.
   The live reply wrote its opening and the unsaved notice date on one line, so the opening left with it. Now only the
   sentence holding the unsaved label leaves; a line with nothing else left still goes.
2. A reply with this turn's card that named no form got no opening. `withCardOpening` (card-opening.ts, called in run.ts)
   puts "Here's the <form> for **<reply name>**." first, built from the card, never from a word list.

Tests: card-opening.test.ts and two exit-read-back.test.ts cases (ported). Replay, in
`nov22-agent-loop-exit-reads-back-saved-cases.ts` (Perpetua Lindqvist):
- `nov23-u22-exit-unsaved-line-on-opening-line-keeps-opening` and `nov23-u22-card-reply-with-no-opening-gets-the-cards`
  fail before and pass after.
- The twice case's pattern allows the form's name in bold, changed on purpose and commented.
