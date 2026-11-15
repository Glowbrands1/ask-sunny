# Agent loop rebuild PR 1a: word lists become evidence (15 Nov 2026)

**Ask Bubbles: not needed yet** (v2-Coding-7). This changes only the agent loop (`src/lib/ai/agent-loop/`): the past-forms privacy gate, the exit check and the name correction now take evidence args instead of reading the manager's message with word lists. Ask Bubbles has no agent loop yet, so port this with the loop.
