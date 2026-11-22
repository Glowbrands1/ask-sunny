# An exit card's reply reads back only what Create saves (Ask Bubbles #1034 be02f5a, U22, and #1036 898ae08, B6) — ported

**Report (Ask Bubbles):**
- U22 (its QA's round 2): an exit reply read back "**Date that notice was given:** 11/14/2026" (never stated, never
  saved) and labelled the account "**Reason for Resignation:**" (it is saved to Additional Details).
- B6 (its live re-run 2): (b) "… eligible for rehire, notice will be attached …" got "aren't fields I can set from here"
  while Create saved eligible_for_rehire = yes; (a) "she is resigning due to second job I'm ready for the draft" called no
  tool and replied "Noted the reason — **Reason for Resignation:** Second job." Nothing was saved.

**Ask Sunny: same gap.** Sunny's exit card result had no list of what Create saves, and its reply check read no exit
field line. The replay cases below fail on main.

**Port (the mechanism; Sunny's own exit form labels from `exit-library.ts` / `exit-facts.ts`, names invented):**
- `agent-loop/exit-read-back.ts`: the exit card's `reads_back` lists the lines Create saves: the dates the exit form's
  reader read, the account under the field it is saved to (Reason for Resignation on a termination, Additional Details
  otherwise), and the exit form's own Details reader's lines (How Employee Resigned, the reason, the yes/no answers);
- `run.ts`: a reply line under one of the exit form's own labels that is not one of those goes back once and is then
  left out, never offered as a change; on a turn with no card call and an exit card on screen, a Details or answer line
  (a label anywhere in the line) goes back the same way; a date line stating no date stays;
- rules book: reads_back is the only exit lines the reply reads back, every one is saved at Create, and a detail added
  after the card reaches the form only through propose_form.

`EXIT_CARD_LABELS` is exported (as in Bubbles) so the "card comes only from propose_form" port
(`2026-11-22-no-faked-card-reply.md`) can add the exit form's labels to its card labels once both are merged.

**Tests:** `exit-read-back.test.ts`; replay `nov22-agent-loop-exit-reads-back-saved-cases.ts` and
`nov22-agent-loop-exit-claims-only-saved-cases.ts` (the testers' exact words, Sunny's job title and invented people):
5 cases fail before, pass after.

**Live harness:** Sunny has the harness (`AGENT_LOOP_LIVE`), but this session has no model key, so it was not run here.
