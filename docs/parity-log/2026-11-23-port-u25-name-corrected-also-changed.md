# Port of Ask Bubbles #1113 (cbfd1847, its QA's round 2 U25): a corrected name says what else changed; the card's line labels stay out of the coaching write-up

**In Ask Bubbles:** U25 T5 "create coaching form for <P>; coaching on under performance" corrected the card's name and
dropped T4's coaching topic, but the reply said "nothing else changed"; the saved Coaching Details read
"Observed:\nWhat happened: <P> had under performance."

**Ported to Ask Sunny (same gaps on main 403c464):**
- The card record keeps the card's coaching topic (`card-record.ts`, `run.ts`).
- `name_corrected` carries `also_changed`: what differs from the card the name was corrected on: coaching topic, the
  account, policy, warning level and payroll deduct (`tools.ts`). Sunny's card record holds the account as a one-way key
  of the model's account (`accountKey`, compared as Bubbles compares its shown-account key) and has no salon slot, so
  Bubbles' store item is not ported.
- The rules book's name_corrected line says "nothing else changed" only when also_changed is empty. Fixtures re-taken.
- `loopCoachingWriteUp` drops the card's own line labels (`CARD_LINE`, now exported from `draft-notes.ts`, where
  `notesWithoutCardLines` already used the same pattern inline) from the start of a section line.
- Not ported: Bubbles' `still-need.test.ts` pin. Sunny has no `stillNeedWithoutQuestion` check in its pack.

**Tests:** replay cases `nov23-u25-name-corrected-says-what-else-changed` and `nov23-u25-saved-details-no-what-happened-label`
(T1–T5 verbatim from U25, an invented person off Sunny's roster) fail before and pass after;
`loop-coaching-write-up.test.ts` (3 tests, 2 fail before).
