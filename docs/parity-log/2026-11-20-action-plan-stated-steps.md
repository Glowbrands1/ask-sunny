# The Action Plan adds the steps the manager stated (STATED_PLAN_STEPS_ENABLED, 20 Nov 2026)

**Sibling app: needs porting (the regular-chat half).** Ask Bubbles has the same regular chat, intent reader, card plan
line and draft-route plan builder, so it has the same gap. Port the mechanism behind the same flag (default off), not
this app's plan wording:

- `stated-plan-steps.ts`;
- the intent reader's `planSteps` slot (`intentToolInputSchema`);
- `plan-steps-turn.ts` and the server-ask wrapper;
- `withCardPlanSteps` in the chat route;
- `cardPlanSteps` through Create to the draft route's `planText`.

The agent-loop half (`plan_steps` with `plan_evidence` on propose_form) is Sunny-only until Bubbles has the loop.

Background: f062, from QA's live test of #1121 (item 6). The tester's 351-word late-opening account ended "I want this
documented as a written corrective action and the opening procedures reviewed with <P> this week." The saved plan was
the generic two sentences. Pau reopened it ("YEAH add"). The rule:

- Old Sunny's plan stays exactly as it is.
- Each step the manager stated is added in their own words, lightly tidied, as its own sentence before the closing
  ("Future policy violations …" or the termination sentence).
- A step is never invented. With no step, the plan is byte-identical.

Where the steps come from is a record, not a word list: the regular chat's intent reader (`planSteps`) or the loop
card (`plan_steps`). A step is kept only when its content words are all in the manager's own text.

Behind STATED_PLAN_STEPS_ENABLED (default off; QA flips it after a live test). With the flag off, both tool schemas,
the card and the plan are exactly as before. `ca-action-plan.ts` (protected) is not touched.
