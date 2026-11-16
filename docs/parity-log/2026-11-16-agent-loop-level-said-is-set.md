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
