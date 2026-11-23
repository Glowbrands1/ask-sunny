# Agent loop: a switched-from card never created is not in Form Monitoring (21 Nov 2026)

**Report (QA2, #1172's live test on 3b0038f4):** T1 "ca for <P>, late on 11/18" (a card, Create never pressed), T2 "make it a coaching form". The reply said "The earlier Corrective Action card stays as it is; it's left unused unless you'd like it deleted from Form Monitoring." Nothing was created, so nothing is in Form Monitoring.

**Mechanism (Sunny):**
- `propose_form` (tools.ts): on a form switch (verified `form_change_evidence`) away from this person's card or open draft, the card's facts carry `form_changed: { from, earlier_created }`. `lockedForm` now says `created`: false for the last reply's card (never created), true for the draft open on screen.
- Rules book: the after-a-switch line says the created form is left as it is (Form Monitoring) only when `earlier_created` is true; a Card replies line for `earlier_created` false says never mention Form Monitoring or deleting it.
- run.ts honesty review: a reply that speaks of Form Monitoring, deleting or "left unused" when this turn's card was switched from a card never created goes back to the model once; still wrong, those sentences are taken out. Trace: `honesty_review.earlier_draft`.
- Replay: `nov21-agent-loop-switch-earlier-card-not-created-cases.ts` (QA2's turns; invented name), failing first; control: a created draft may still be named.

**Sibling app:** Ask Bubbles' loop copy (#991) has the same switch path and Forms Register wording; the mechanism is sent to Coding-D to port (Form Monitoring ↔ Forms Register).
