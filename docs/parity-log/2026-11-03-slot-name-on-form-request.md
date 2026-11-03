# 2026-11-03 — SLOT_NAME_ON_FORM_REQUEST: a lower-case name the slot reading holds reaches the card (Sunny only)

Ask Sunny, QA live check: "Corrective action for the primary salon manager: on
Monday 10/05/2026 <name> was working …", the name typed in lower case and not
on the roster, came back "Who is this Corrective Action Form for?". The slot
reading held the name, but Sunny production runs with FORM_STATE_ENABLED off
(none of its chat_form_state rows carries the card path's `incident`), so on a
turn the slot reading did not call a form turn nothing put the name in front of
the question, and the proposal reads capitalised names only. Sunny's fix puts
"The employee is …" in front (SLOT_NAME_ON_FORM_REQUEST_ENABLED, default off).

Not needed in Ask Bubbles today: Bubbles production runs with FORM_STATE on
(its chat_form_state rows carry the card path's `incident`), so the saved state
puts the name in front of the proposal's question. If FORM_STATE is ever turned
off here, port the Sunny mechanism (`withSlotEmployeeLine` in
`ai/intent-slots.ts`, its `!formTurn` branch).
