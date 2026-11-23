# The resignation reason the manager gives, in any wording, reaches the exit card and the saved form (Ask Bubbles #1047, c722fe71, its QA's live round 3, B6) — ported

**Report (Ask Bubbles' production):** T6 "she is resigning due to second job I'm ready for the draft"; the reply and the
saved draft had no Reason for Resignation.

**Ask Sunny: same gap.** Sunny's loop card had no reason field. A resignation's reason came only from the exit form's
Details reader (`exit-details.ts` `reasonIn`), so wordings such as "she found a better paying job elsewhere" were dropped,
and a model handed back for claiming the reason with no tool call had nothing to call propose_form with. The replay cases
below fail on main.

**Port (the mechanism; Sunny's own exit labels, names invented):**
- `src/lib/forms/exit-reason-said.ts` (`reasonFromQuote`): the reason is kept only when every word of it (three letters or
  more) is in the manager's quoted words. No word list; code reads no phrasing.
- propose_form takes `exit_reason` with `exit_reason_evidence` (the manager's words in this request, `answerEvidence`), on a
  resignation only; reads_back lists it under "Reason for Resignation".
- Create (`/api/forms/instances`) checks the quote against the chat's manager turns again before saving it as the
  manager's statement; a termination keeps its own reason path.
- Rules book: pass exit_reason when the manager says why the person is leaving, none when no reason was given (fixtures
  re-taken, noted in `app-config.test.ts`).

**Tests:** `exit-reason-said.test.ts`; replay `nov22-agent-loop-b6-resignation-reason-cases.ts` (the tester's T1, T5 and T6
word for word, invented person): the three fix cases fail before (6 runs: both flag modes), pass after; two controls (a
reason with a word the manager never said, no reason given) pass before and after.

**Live harness:** not run here (the permission check refused the key); QA runs Sunny's live set from their session.
