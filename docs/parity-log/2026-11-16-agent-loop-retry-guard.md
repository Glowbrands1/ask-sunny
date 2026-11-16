# 2026-11-16 — agent loop: the retry guard

**Stays Sunny-only for now: Ask Bubbles has no agent loop yet.** In the loop (behind AGENT_LOOP_ENABLED +
AGENT_LOOP_USERS), a tool refused twice in one turn for the same reason_code (whatever the args) gets the fact
`stop_retrying {reason_code, ask_exactly?}`, and any later call of that tool in the turn is refused without running it
(counted in the trace as `agent_loop.stop_retrying`). propose_form's own not_on_roster refusal carries find_staff's
"Reply **use <name>**" line as ask_exactly. When the loop is ported, take the runner change and the replay case
`nov16-agent-loop-retry-guard-cases.ts`, swapping the invented people and the salon/store wording.
