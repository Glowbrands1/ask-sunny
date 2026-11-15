# Agent loop batch F (robustness): Ask Sunny only

**Change in Ask Sunny** (QA's batch F, from Pau's review list; `src/lib/ai/agent-loop/`):

- **F1.** An error or timeout after a card was made, a revising draft opened or fields saved says what was done and that the rest did not finish, and carries the card, draft or update. "Nothing was saved" stays only when nothing was. A model error mid-turn, which `streamText` swallowed and reported as the step limit, now ends the turn as an error.
- **F2.** The step limit with a card or a saved edit names it, then asks for the one thing left.
- **F3.** A refused edit to a finalized form deletes the revision draft that call opened, and opens nothing on screen.
- **F4.** One step budget for the turn: the truncation retry and the self-check hand-backs get only the steps left under the cap. The trace records `steps_used`. A hand-back the budget cuts off before it replies changes no card (found when batch E's Policy-line hand-back met it).
- **F6.** read_stats' figures are never cut inside a line: the cap is 40,000 characters, and past it the text ends at a whole line, with `truncated_salons` named.
- **F7.** Every loop tool gives a salon's name, never its id; find_past_forms reads 200 rows, so the list covers every form the person has.
- **F8.** `FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED` (default off): a value edit moves `form_instances.updated_at` (shared form code, `form-write.ts`).
- **F5.** A turn carrying attachments, a report context, a pending copy or a non-standard answer mode goes to today's path, and the trace records `agent_loop_skipped`.

**Ask Bubbles** (v2-Coding-5, 15 Nov 2026): **F8 is ported** in Ask-bubbles#920 (same bug: same trigger, same writer). F1–F7 are loop-only, and Ask Bubbles has no agent loop on its main yet: port them with the loop.
