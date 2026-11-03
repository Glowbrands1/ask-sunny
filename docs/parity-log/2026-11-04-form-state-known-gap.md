## 4 Nov 2026: FORM_STATE_ENABLED is OFF here and ON in Ask Bubbles — KNOWN GAP (no change yet)

Production differs between the two apps.
- **Here it is off.** chat_form_state rows are written by the intent read
  whatever the flag says, but none of this app's rows carries the 'incident'
  text the card path writes when FORM_STATE is on.
- **In Ask Bubbles it is on.** 5 of its 12 rows carry it.

So a card here is built without the saved form state that Bubbles' cards read
(QA, 3 Nov 2026; `src/config/production-flags.json` lists it under "off").

Plan, in this order; the flag is not turned on before the evidence exists:
1. Run the replay pack and the replay eval here with FORM_STATE_ENABLED on, as
   a separate column, and show the eval numbers off vs on: pass counts, the
   cases that move, p50/p95.
2. If nothing gets worse, QA tests turning it on in production here, with
   rollback ready (set it back to 0 and redeploy).
3. Update `production-flags.json` in a one-line PR after any flip.

Until then, any behaviour that depends on saved form state can differ between
the apps, and replay cases that read it are judged with it off here.
