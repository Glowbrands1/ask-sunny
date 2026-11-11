## 4 Nov 2026: FORM_STATE_ENABLED is OFF in both apps — not a gap (corrected)

Correction to an earlier note that said Ask Bubbles runs FORM_STATE_ENABLED
on. QA, 3 Nov 2026: Bubbles' 12 chat_form_state rows all come from one
11-minute window on 24 Oct 2026, with none since, and its production-flags
file lists the flag "off". This app lists it "off" too (none of its rows
carries the card's incident text).

So the two apps behave the same here. Before either app turns it on:
1. Run the replay pack and the replay eval with FORM_STATE_ENABLED on, as a
   separate column, and show the numbers off vs on: pass counts, the cases
   that move, p50/p95.
2. If nothing gets worse, QA tests it in production with rollback ready (set
   it back to 0 and redeploy).
3. Update production-flags.json in a one-line PR after any flip.
