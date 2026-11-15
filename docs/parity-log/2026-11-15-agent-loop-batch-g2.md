# Agent loop batch G2 (QA's live run part 2 on batch G, 15 Nov 2026)

**Item 5 is ported** to Ask Bubbles in Glowbrands1/Ask-bubbles#932 (saveInstanceValues moves updated_at, same flag). **The rest is not needed yet** (v2-Coding-7): every other item is in the agent loop (`src/lib/ai/agent-loop/`). Ask Bubbles has no agent loop yet. When the loop is ported, port these with it: the stated-level write and `saved_level`, `exit_not_asked`, `termination_mentioned_not_stated`, the prior-actions lock, and the kept-date refusal. Use Bubbles' store wording.
