# 2026-11-24 — FORM_DATE_IS_TODAY: the last check on the chat's card (Ask Sunny only)

Ask Sunny's chat runs steps after the proposal that keep a card's slots across turns
(`src/lib/ai/keep-filled-slots.ts`, `src/lib/ai/form-card-slots.ts`, the intent read's slots). With
`FORM_DATE_IS_TODAY_ENABLED` on they put the incident's date back on the card. `withFormDatedToday`
(`src/lib/forms/form-date-today.ts`), the last step in the chat route, leaves only the date the manager gave the form,
or none.

Not ported to Ask Bubbles: it has none of these slot-keeping steps. Its eval (`evals/replay.eval.ts`) and the
replay case `nov24-form-date-is-today-late-september-11` show its chat card undated with the flag on.
