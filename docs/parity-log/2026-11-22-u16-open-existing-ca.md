# "Put up the verbal CA for <P>" opens the one on file; "with all the same information" copies it (Ask Bubbles #1044, 41d08d8, U16) — ported

**Report (Ask Bubbles, its QA's live round-2 re-run):** "put up the verbal CA for <P>" made a new card ("What
happened?"), and "create a verbal CA for <P> with all the same information given" asked which form to copy. Causes: the
rules book listed only some verbs for a form on file ("open / edit / pull up / show me"), and #1028's level-evidence line
taught "put up the verbal CA" as a new card's level; find_past_forms listed the Written Warning and a revised original
beside the Verbal one, so the copy had no one form to read.

**Ask Sunny: same gap, higher priority (QA).** Sunny's #1224 (the port of #1028) carries the same "put up the verbal CA"
new-card example, the same "Open / edit / pull up / show me" line, and no level narrowing in find_past_forms. The replay
case below fails on main (both forms on file listed for "the verbal CA").

**Port (the mechanism):**
- rules book: a form the manager refers to as one that exists ("the <form> for <P>", "<P>'s <form>", any verb bringing it
  to the screen) is a form on file; only words asking to make one start a card. "With all the same information" after
  forms on file were shown: read that form and propose with its account, policy and the level named. The level-evidence
  line no longer gives "put up the verbal CA" as an example. Fixtures re-taken (noted in app-config.test).
- find_past_forms: a revised original whose revision is listed is not a choice; when the manager's words for the form
  (the model's form and about, and the asking message's quote) hold a level some of the person's forms have ticked
  (their saved warning_type), only those are kept. Form data, no word list.
- Replay harness: `checkOnForm` and `templateIds`, so a case can put forms on file with their level as saved.

**Tests:** replay `nov22-agent-loop-u16-open-existing-ca-cases.ts` (the tester's exact words, an invented person, Sunny's
manual heading and salon): fails before, passes after. It runs under `AGENT_LOOP_LIVE=1` too, but this session has no
model key, so the live harness was not run here.
