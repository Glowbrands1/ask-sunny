# Agent loop: payroll stated for this request stays on the card: Ask Sunny only

**Change in Ask Sunny** (Coding-7, 16 Nov 2026; `src/lib/ai/agent-loop/`; QA's 266 re-run, c022): the card record keeps
the payroll answer the card held and its amount (values, never names), and a rebuild of the card on screen (the last
reply showed it) keeps them when this turn's evidence states none. A card shown again after a turn with no card (PR 1c),
a new request, and another person's or form's card never get them; a carried answer is never read back "as you said".

**Ask Bubbles: not needed yet.** Ask Bubbles has no agent loop on its main. Port with the loop.
