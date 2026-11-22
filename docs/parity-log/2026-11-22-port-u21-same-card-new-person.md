# Ported from Ask Bubbles (#1026, U21): "make this for <B> instead of <A>" carries the card's account to <B> (22 Nov 2026)

**Sibling app: ported from Ask Bubbles.** Bubbles noted Sunny had no `same_card_evidence`, and the same person guard.
Mechanism only.

propose_form takes `same_card_evidence`: the manager's words in this message asking for the card on screen (or this
chat's latest card of the form, by the server's record) for this person. It counts as asking for a form for them. With
no account from the model, the card goes back once (`same_card_account_missing`), to be proposed with that card's
account as the chat shows it, with this person's name. The records keep no account text (QA's c163). The fact
`copied_from_card` tells the reply.

QA's ruling (22 Nov 2026): kind `same_form` ("make the same corrective action but for <B>") also copies the earlier
card's level and payroll answer, and the reply says so. Kind `this_card_for` ("make this for <B> instead of <A>") starts
<B> clean. The model says which kind; code does not match the words. The rules book gained one line, and the prompt
fixtures were re-taken.

Replay: `nov22-agent-loop-same-card-new-person-cases.ts` (QA's turns, Sunny's invented Remy Calder and Marnie Holloway).
It fails before the port and passes after; the control (no same_card_evidence) copies nothing.
