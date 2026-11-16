# Agent loop: the level said with the request is set by code (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

QA's live re-test on 63ba4c48 (c_pay r1): for "written CA for <A>, late 11/14, payroll deduct $20", propose_form returned
`level_not_given`, and the model stopped without proposing again (1 run in 2). Now propose_form sets the level itself in
this case:

- the card is a Corrective Action, and the model sent no level;
- no termination was asked for or said;
- exactly one Type of Warning option is written right before one of the form's own words in THIS message ("written CA",
  "verbal warning").

Those words, as typed, are the evidence, and they pass the same evidence, person and offer checks as a model-given level.
"written closing checklist", "written up before" and a termination stay unset. Port with the rest of the loop when Ask
Bubbles gets it.

c158 (Runner 2, 63ba4c48): for "I need to create a verbal corrective action form", the model asked "Who is this Corrective
Action Form for?" without calling a tool, so no person-asked record was written. The level quoted from that turn was then
refused (evidence_after_card, then evidence_not_this_turn). The app's own question for this form, in the reply right after a
manager turn, now marks that turn as the request's start, as the record does.
