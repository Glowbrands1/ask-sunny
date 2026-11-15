# Agent loop PR 3, tools return exactly what was saved: Ask Sunny only

**Change in Ask Sunny** (v2-Coding-9, 15 Nov 2026; `src/lib/ai/agent-loop/`, rebuild plan PR 3): `edit_form` returns
`saved: [{field, before, after}]` read back from the database after the write (text, tick boxes and the date), and
`refused: [{field, reason_code}]`; `propose_form` returns `not_on_card: [{field, reason_code}]` (replacing the fact
`not_kept`); a finalized form's revision returns `revision_draft: {id, from_id}`; the turn's summary, the partial reply and
the step-limit reply use the saved list; the trace holds field names and reason codes, never values.

**Ask Bubbles: not needed yet.** Ask Bubbles has no agent loop on its main. Port with the loop, on Bubbles' own data.
