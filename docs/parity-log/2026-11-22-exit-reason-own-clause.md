# An exit card's reason is the manager's own clause (22 Nov 2026, QA's live L6)

**Sibling app: port to Ask Bubbles** (the same exit account path in `propose_form`, `src/lib/ai/agent-loop/tools.ts`,
checked at Bubbles `4fd060f`). Mechanism only.

QA's live L6 on prod 14fed8c: "exit form for Test Testy, terminated for job abandonment, not eligible for rehire" got
the model's account "job abandonment", so the card's What happened and the saved resignation_reason lost the manager's
"terminated for". `ownClauseHolding` (`forms/own-clause.ts`): an exit account of one clause that is, as whole words,
part of exactly one clause the manager typed in this request becomes that whole clause, as typed. No word list. Tests:
`forms/own-clause.test.ts`; replay `nov22-agent-loop-exit-reason-manager-words-cases.ts` (fails before, passes after);
516 exit-related replay runs pass.
