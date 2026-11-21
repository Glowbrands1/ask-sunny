# The form lock is left only by words that name the other form (22 Nov 2026, board f108)

**Sibling app: port to Ask Bubbles** (the same lock: `changeAsked = verifyEvidence(input.form_change_evidence, …)` in
`src/lib/ai/agent-loop/tools.ts`, checked at Bubbles `4fd060f`). Mechanism only; Bubbles' template names are its own.

The form lock (QA item 7, 20 Nov) trusted the model's quote: any words really in this turn passed as
form_change_evidence or new_form_evidence, whatever they said. A quote of the account ("she said she'd be late again")
switched the open Corrective Action card to a Coaching card nobody asked for.

To leave the lock for another template, the quote must now name that form (`quoteNamesForm`: the template's name or
short name without "Form", or the initials of a name of two or more words, as whole words), or the turn must answer
Sunny's own offer of it (the reply right before names it). The refusal tells the model to ask "Do you want this to be a
<Form> instead of the <Locked>?". Tests: `agent-loop/form-lock-names-form.test.ts`; replay
`nov22-agent-loop-form-lock-quote-names-form-cases.ts` (invented Remy Calder; fails before, passes after; two controls).
