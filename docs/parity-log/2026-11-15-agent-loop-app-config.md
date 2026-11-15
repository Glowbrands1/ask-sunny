# 2026-11-15 — agent loop app config (PR 5)

**Stays Sunny-only for now; the mechanism is what Ask Bubbles takes.**

`src/lib/ai/agent-loop/app-config.ts` holds the app name, brand, place word,
staff system ("Woven"), form keys and roster reader; the rules book, prompt and
tool texts take their words from it. Ask Bubbles gets the same file with its own
values (store, its staff system, its form keys) when the agent loop is ported to
it. The loop is not yet in Ask Bubbles (it is behind AGENT_LOOP_ENABLED here and
under rebuild), so there is nothing to port into today. No Sun Tan City wording
is to be copied across.

Not yet templated: reply notes inside `data-tools.ts` handlers and the
"Form Monitoring" name (Forms Register in Ask Bubbles).
