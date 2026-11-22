# Ported from Ask Bubbles (1b34db2, #1005): an open "Which one should I open?" is answered by the manager (22 Nov 2026, A11)

**Sibling app: ported from Ask Bubbles.** Bubbles found the gap in its live re-run (A11, HIGH) and noted Sunny had it
too (its docs/parity-log/2026-11-22-which-form-needs-the-managers-pick.md). Mechanism only.

`which-form.ts` (from Bubbles; its `store` field is `salon` here). When find_past_forms asks which_form_question, the
turn records the listed forms in `slots.agent_loop.which_form`: one-way keys plus form, status, date and salon, with no
names. While that question is open, open_form and edit_form of a listed form need choice_evidence from this message
naming a fact only that form has, or its number in the list. Otherwise nothing is opened or written, and the question
is asked again.

Sunny never had Bubbles' 21 Nov "open the most recent" rules-book line, so the A11 line is added after
which_form_question rather than replacing it. The prompt fixtures were re-taken for that line. Replay:
`nov22-agent-loop-which-form-needs-pick-cases.ts` (QA's wording, invented Remy Calder). It fails without the guard and
passes with it.

Sunny adaptations:

- **The pick can come in either evidence field.** The manager's pick may arrive as forms_on_file_evidence when those
  words come from THIS message and single out the form by the same checks ("the 10/31 one about …" opens it in one step,
  G4). Words that pick nothing are still refused.
- **Three older stand-ins changed on purpose.** In `nov16-agent-loop-which-form-answer-carries`, `-edit-already-set` and
  `-revision-date-edit`, the stand-in now passes the manager's pick ("the finalized one") as choice_evidence when it
  opens after a which-one question. Each change has a comment, and the expectations are unchanged.
