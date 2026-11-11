## 3 Nov 2026: Step B, one form-update path — ported from Ask Bubbles (d130fa40, 24ef9bb1, 618bed02 with the claim rule of 0a17bd82) (FORM_PATCH_REDUCER_ENABLED, FORM_REPLY_FROM_DIFF_ENABLED, default off)

Ported in three commits. They use the same modules, the same flags, the same
system prompt and the same claim rule as Ask Bubbles. The `checkedClaim` rule
is QA's ruling on H1–H5: a reply is replaced only when none of its claimed
keys changed, and provenance counts as a change. Each replay case is the
mechanism of a Bubbles report, told in this app's setting with invented
people. No Buff City Soap wording is used.

### Behaviour differences from Ask Bubbles

1. **The payroll deduction never reaches the Action Plan.** This app runs
   `ACTION_PLAN_MANAGER_ONLY_ENABLED` in production, so the Action Plan is
   the manager's alone. `syncCorrectiveActionPlan` returns at once, so
   neither the draft write's `settle()` nor a patch turn's payroll change
   writes a deduction sentence into the plan. The stated "$3.25" goes only
   to the Payroll deduction amount field (`PAYROLL_AMOUNT_KEY`), verbatim.
   - Replay case `nov3-stepb-payroll-as-given` asserts exactly that.
   - The case already holds with production's flags, so it is "fixed" here
     and open in Ask Bubbles.
2. **The Daily Stats edit took a different wrong path here.** The turn was
   "Add that she Must Practice the sanitizing checklist every shift with
   <coworker> before Daily Stats." with a Coaching draft open.
   - In Ask Bubbles it fell through to the knowledge answer.
   - Here, with production's flags, the roster name gate in the revision
     (`chat-revision.ts`) and the open-draft turn (`open-draft-turn.ts`) both
     return null.
   - `answerQuestion`'s card intake then reads "Add that …" as an edit of the
     card still in the thread (FORM_EDIT_DATE_RULES_ENABLED,
     `ai/edit-date-rules.ts`). It offers a NEW proposal card that says
     "Added to **Observation of Offense** …", while the open draft stays
     unchanged. No answering model is called.
   - That path is last in the cascade. The patch turn already runs before
     the redraft, the revision, the open-draft turn and `answerQuestion`
     whenever a form is open and the flag is on. No protected file needed
     editing.
   - With the flag off, the order is unchanged.
   - Case: `nov3-stepb-daily-stats-edit`.
3. **The copy case asks for the copy before naming the new person.** This is
   case `nov3-stepb-copy-keeps-details`, the b13 mechanism.
   - In Ask Bubbles' order ("Do the same coaching form for <new>" and then
     "can you create the same draft that we did with <first> …"), this app
     puts the first person's card back on screen once she is named again.
   - That card reading is outside Step B (the patch model reads both turns
     as "other", and the old path answers them). So the case names the copy
     first, then the new person.
   - The card behaviour is left as it is. It is not a form update.
4. **Code adaptations, not behaviour changes:**
   - This app's `priorActionLine` takes `(step, iso, topic, description)`.
     The reducer test passes its arguments in that order.
   - The amount key and question are `PAYROLL_AMOUNT_KEY` and
     `PAYROLL_AMOUNT_QUESTION` (`payroll-amount-field.ts`).
   - `AskResponse` needs `recommendedVideoIds` here.
   - The header label is "Salon".
   - The draft route hands the reducer the write it already made: `kept`,
     after `retainFilledFields`. It puts `formDiff` after this app's
     payroll-amount re-apply, so the realized diff includes that amount.
   - This app has no `which` step.

### Unchanged

- The date case (`nov3-stepb-date-as-given`) stays open, as in Ask Bubbles:
  the repeated date is the Observation's own sentence, and Step B does not
  rewrite sentences.
- Dependencies `ai` 6.0.322 and `@ai-sdk/anthropic` 3.0.138 are pinned
  exactly.
- `zod/v4` is imported from this app's zod 3.25.76. The JSON-schema snapshot
  is byte-identical to Ask Bubbles'.
