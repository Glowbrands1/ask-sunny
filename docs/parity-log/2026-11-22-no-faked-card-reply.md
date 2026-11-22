# A card comes only from propose_form; the app note is never shown (Ask Bubbles #1038, a6f203c, its QA's live re-run 2, "saved ≠ card") — ported

**Report (Ask Bubbles' production):** every saved draft equalled the card it was created from; the replies differed. On
the turns that stated a fact ("payroll is not deductable", "verbal warning", a prior action, more examples for the
Observation) the model called no tool and wrote the reply in card form, "… as you said". Three of those replies ended
with "[app note: this reply showed a card built with propose_form]": `run.ts`'s CARD_NOTE, appended to earlier card
replies in the model's history, copied by the model and shown to the manager.

**Ask Sunny: same gap.** Sunny's `run.ts` appended the same CARD_NOTE to card replies in the history, compared a reply on
a turn with no card call only with the last reply's card (level and policy, no payroll), and never stripped the note.
The replay cases below fail on main.

**Port (the mechanism; Sunny's own labels, names invented):**
- `agent-loop/card-lines.ts`: the card's own labels (the ones Sunny's rules book tells the model to write; a test checks
  each is in the rules book), the lines under them anywhere in a line, and the history stand-in;
- the model's history shows an earlier reply without app notes and without card lines; a card reply's card is one
  "[card shown under this reply: <form>, made by propose_form …]" line (the manager's screen is unchanged);
- rules book: the earlier-card line names that stand-in; a card comes only from propose_form, never card lines on a turn
  without it; a stated fact goes to propose_form first;
- on a turn with no card call, the reply is checked against the card still shown (the last reply's, else this chat's
  latest card record, until a form opens), payroll included; a card line or a copied app note goes back once and is left
  out if it comes back;
- "[app note: …]" is stripped from every reply.

Not ported yet: Bubbles also lists the exit form's own labels as card labels (`EXIT_CARD_LABELS` from
`exit-read-back.ts`). Sunny has no `exit-read-back.ts` until the U22 + B6 port; that port adds them here.

**Tests:** `card-lines.test.ts`; replay `nov22-agent-loop-no-faked-card-reply-cases.ts` (the tester's exact words,
invented people, the live faked replies replayed by stand-ins): 4 cases fail before, pass after. Two older cases that
read the history format change on purpose (`nov14-agent-loop-cases.ts` historyIsTheModelsOwn,
`nov14-agent-loop-guards-cases.ts` earlier-card-was-real), each with a note.

**Live harness:** Sunny has the harness (`AGENT_LOOP_LIVE`, `loop-stand-in.ts`), but this session has no model key, so it
was not run here. The faking is intermittent in production; Bubbles' live runs did not reproduce it before or after, so
the replay cases are the regression proof.
