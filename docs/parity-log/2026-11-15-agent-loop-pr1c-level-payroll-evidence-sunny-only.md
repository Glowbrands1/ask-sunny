## 15 Nov 2026: agent loop rebuild, PR 1c + PR 4 part 2 (a level and a payroll answer are kept only on evidence) — Sunny-only

Owner's audit: no word list reads the manager's message. A warning level (verbal / written) and a payroll answer are kept only on
the model's `level_evidence` / `payroll_evidence` (a manager message id and a real quote, `evidence.ts`); code checks only that the
quote is in that turn and where the turn sits, never what it means. Removed: `LEVEL_OR_PAYROLL_ANSWER` (the "this message is only a
level or payroll answer" regex; now "the evidence quote is the whole message"), `payrollStated` and the level regexes in propose_form
and edit_form (bug 1: "she was written up before" in an earlier turn no longer unlocks written). Refusals `level_not_stated` /
`payroll_not_stated`, with the evidence check's reason (`evidence_quote_not_found`, `evidence_not_this_turn`, …). propose_form
accepts the message being answered or the manager message before it (a level stated with the request survives the answer to the
card's date question); edit_form accepts only the message being answered.

Sibling app (Ask Bubbles): not needed. Bubbles has no agent loop, tools or evidence arguments.

Guards added at QA's ruling: an evidence turn that names a different roster person than the card's is refused (`other_person`);
payroll counts only from the message being answered or an answer right after a reply naming this card's employee
(`evidence_after_card`). Remaining: full per-card scoping comes with the server-side card store in PR 2.
