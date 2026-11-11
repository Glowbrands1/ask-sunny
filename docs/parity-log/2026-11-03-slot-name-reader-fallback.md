# 2026-11-03 — SLOT_NAME_ON_FORM_REQUEST: the AI reader's quoted name when the slot model names nobody (Sunny only, for now)

QA live check, 17:50 UTC: "Corrective action: corin bellweather was rude to a
guest at the front desk on Monday", a first turn that gave a card at 16:26,
came back "Who is this Corrective Action Form for?". The production trace shows
the slot model returned no employee that time (model variance), while the AI
reader quoted the name and the code rejected it only as not on the roster.
Sunny now keeps that quoted name (`quotedEmployee` in `ai/reader/check.ts`) and,
with SLOT_NAME_ON_FORM_REQUEST on, uses it when the slot reading has none —
form turns included.

Ask Bubbles: not ported yet. Bubbles has the same AI reader and the same
capitalised-only proposal reader, so a lower-case name the slot model misses
can fail the same way even with FORM_STATE on (the saved state has no name
either). Port the whole mechanism (`withSlotEmployeeLine`, `quotedEmployee`)
once QA's Sunny live check of both sentences passes.
