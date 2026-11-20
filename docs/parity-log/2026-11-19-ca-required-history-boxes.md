## 19 Nov 2026: Corrective Action history line becomes two required boxes (revision 9) — ported to Ask Bubbles as revision 8

HR via Pau, after meeting with their director, for both apps: remove the line
"List previously received coaching and/or corrective action with date signed"
and add two separate boxes the form creator must fill in. Box 1 "List date of
JBA policy manual signed by employee"; box 2 "List previous coaching and
corrective actions and include date signed by employee in past 90 days".

Same code in both apps; what differs:

- **Revision number.** Ask Sunny's seed goes 8 → 9, Ask Bubbles' 7 → 8. In
  both, a library on an earlier revision gets a new version; forms filed on
  earlier versions keep the document they were signed on.
- **Ask Sunny's production Corrective Action is an authored version**, so
  revision 9 is held back by the sync until `TEMPLATE_SEED_OVERRIDE=dpoa:9` is
  set for one visit to Forms → Form Templates (as for revision 8).
- **Ask Bubbles' parity test** pins its templates to Ask Sunny's published
  snapshot; the new box is set aside there (like the payroll amount line) and
  the label, help and required mark are on the approved list as HR-1.
- **Required is a flag.** `REQUIRED_FIELDS_AT_FINALIZE_ENABLED` (default off,
  both apps): with it on, Finalize refuses a blank required box (HTTP 422 with
  the box's name); a draft may stay blank. Off, a form files as before. Neither
  production-flags.json changes: QA flips it.
- **Chat and box 2.** `prior_actions` keeps its key, so the AI loop, the draft
  grounding and the Form Monitoring history lines keep reading and writing it.
  A manual date a manager mentions ("previous coaching jba manual 10-15-26")
  still lists as a row in box 2, and the chat's intake question keeps its
  wording.
- **Chat and box 1.** `policy_manual_signed` belongs to the form creator
  (responsibility `manager`): nothing drafts it and the assistant's draft write
  is rejected. The creator can set it by prompting the chat ("set the manual
  date to 01/01/2026"): the patch path writes it as their own edit, only in
  words the latest message holds (`verbatimKeys`, as the job title), and a
  date they did not type is refused. An `edit_form` call with explicit values
  still goes through the revision writer, which cannot write it.
