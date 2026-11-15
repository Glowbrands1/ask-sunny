# Agent loop batch G2 (QA's live run part 2 on batch G, 15 Nov 2026)

**Ask Bubbles: not needed yet** (v2-Coding-7). Every item is in the agent loop (`src/lib/ai/agent-loop/`) or in `dictatedPlanWrite`, which only the loop calls. Ask Bubbles has no agent loop yet. When the loop is ported, port these with it: the stated-level write and `saved_level`, `exit_not_asked`, `termination_mentioned_not_stated`, the prior-actions lock, the updated_at touch, and the kept-date refusal. Use Bubbles' store wording.
