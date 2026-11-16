# Agent loop: a warning level stated for this request stays on the card: Ask Sunny only

**Change in Ask Sunny** (Coding-7, 16 Nov 2026; `src/lib/ai/agent-loop/`; QA's 266-chat re-run, c158 and c208): the
card record keeps the warning level the card held (a value, never a name), and a rebuild of the same card (same form,
same person, no new request) keeps it unless this turn's evidence states another. `level_evidence` may also cite an
earlier turn of THIS request: this person's own request turns, from the turn the app answered with this form's card or
its "who is it for?" (the server's records). An earlier remark, another person's turn and a turn before a new request's
boundary never count. Termination keeps its stricter own-turn rule.

**Ask Bubbles: not needed yet.** Ask Bubbles has no agent loop on its main. Port with the loop.
