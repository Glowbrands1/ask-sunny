# Agent loop G4 follow-up: a description that singles out one form opens it (15 Nov 2026)

**Ask Bubbles: not needed yet** (v2-Coding-7). The change is in the agent loop only:

- `find_past_forms` (`src/lib/ai/agent-loop/tools.ts`) now names a form with no salon as "no salon".
- When several forms fit an open request, `find_past_forms` adds a `single_out` fact. The rules book's Open lines tell the model to open the one form the manager's words fit, and to list the candidates only when several still fit. The model decides; code only informs.

Ask Bubbles has no agent loop yet. When the loop is ported, port this with it, with the wording changed for stores (store ↔ salon, "no store").

Case: `nov15-agent-loop-g4-single-out-the-one-with-no-salon`, with Remy Calder as the invented name.
