# Agent loop batch G (a form open on screen): Ask Sunny only for now

**Change in Ask Sunny.** These come from the agent loop's first live test with a draft open (AGENT_LOOP_ENABLED, behind AGENT_LOOP_USERS):
- **G0:** rewording is paused (Pau, 15 Nov 2026). A reword request writes nothing and returns `reword_paused`.
- **G3:** an added fact goes at the end of the Observed section. `add_changed_sentences` and `add_not_at_end_of_observed` report when it doesn't.
- **G4:** a form on file is opened by person, form, date and words. An open request never makes a new card, and REOPEN_CLOSE_SPELLING covers misspelled names.
- **G5:** a payroll answer on a draft is written. `writeRevisionEdits` gains an optional `managerStated` (payroll deduct and its amount only). The agent loop's `edit_form` passes it after its stated-by-the-manager guard. Without the option, the write layer refuses manager fields exactly as before, so today's app path is unchanged.

**Ask Bubbles: not needed yet** (v2-Coding-7, 15 Nov 2026). Ask Bubbles has no agent loop on its main (`src/lib/ai/agent-loop/` does not exist there), so nothing would call `managerStated` or the loop's tools. When the loop is ported, port these with it: the same mechanism, with Bubbles' store names (salon ↔ store) and its own payroll field keys. No company data moves between the apps.

**QA's design (15 Nov 2026, after two reviews):** the termination reader's widening is reverted to main in both apps, so Glowbrands1/Ask-bubbles#922 (which carried only that widening) is closed unmerged. In the loop, the model decides a termination and code locks it on a termination word (`termination-word.ts`). That lock, Create's server-side check and the date and plan locks are loop-only for now, because Ask Bubbles has no agent loop. Port them with the loop.
