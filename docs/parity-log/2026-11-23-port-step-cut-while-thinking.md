# A loop step cut while thinking is asked again with its tools (port of Ask Bubbles #1060, 190a33d) — ported

**Report (Ask Bubbles, its QA's live regression set, 22 Nov 2026, item 4):** a message with many facts ("last day
worked will be nov 23, notice was given last Monday, eligible for rehire, …") answered "I couldn't finish that in the
steps I have for one message". The first model call ended "length" with no text and no tool call (adaptive thinking
spent the step's output budget); TRUNCATION_RETRY re-asked it without tools, so the call it was thinking towards could
not be made, and the turn read as the step limit.

**Ask Sunny: same code.** Sunny's `run.ts` TRUNCATION_RETRY is the same: the replay case below fails on Sunny main
with STEP_LIMIT_REPLY.

**Port (the mechanism, code only):** a step cut with no text and no tool call is asked again as the loop step it was,
with the tools and twice the output budget, inside the turn's one step budget (no limit raised); its calls and messages
join the turn's for the hand-backs. A reply cut mid-text keeps the toolless rewrite. Sunny's cases skip live runs (the
cut is an app condition a real model cannot be made to show); Bubbles keeps them on the stand-in with
`loopModel(…, { scripted: true })`, which reaches Sunny with #1237.

**Tests:** replay `nov23-agent-loop-step-cut-while-thinking-cases.ts` (Bubbles' manager wording, Sunny's roster and exit
form): fails on main (STEP_LIMIT_REPLY), passes after; the cut-mid-reply control passes on both.
