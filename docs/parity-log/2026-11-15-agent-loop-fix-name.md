# Agent loop fix-name, a verified name correction is saved: Ask Sunny only

**Change in Ask Sunny** (Coding-7, 15 Nov 2026; `src/lib/ai/agent-loop/tools.ts`, `src/lib/forms/form-write.ts`; the
rebuild plan's `fix-name`): `edit_form` intent `correct_name`, once its checks pass (name_evidence from this message whose
quote holds the changed words, `employee_name` only, the roster checks and "Did you mean <name>?"), now saves the new
name: only the Employee Name line, as the manager's correction (`nameCorrectionWrite`, path "correction", via chat), and
the form's subject column with it. Before, the writer refused `employee_name` and the draft kept the old name. Nothing
else on the form changes. Flag-off (FORM_EDIT_SINGLE_WRITER), the manager's save and the subject column, as today's chat.

**Also live s10** (Pau's ruling, 16 Nov 2026): on a card not yet created (for a roster person or, as in the live
chat, a name not on the roster), a typed name that corrects the card's name (same form, shares its first or last name) goes through the roster check in `propose_form`: an exact roster
match is used, a close spelling asks "Did you mean <name>?" with keep-as-typed, and no match is refused
(`name_correction_not_on_roster`) and the card keeps its name until the manager replies "use <name>".

After #1051 the s10 "Did you mean" is recorded like find_staff's (`effects.nameQuestion`) and its answer is read through
`confirmed-spelling.ts`; the rules book teaches the `name_corrected` fact. `src/lib/forms/employee-match.ts` gains
`saysNo` (an export of today's `NEGATIVE` reading, no behaviour change on the old chat path).

**Ask Bubbles: not needed yet.** Ask Bubbles has no agent loop on its main. Port with the loop, on Bubbles' own data
(store, Forms Register). `nameCorrectionWrite` is a one-writer helper used only by the loop.
