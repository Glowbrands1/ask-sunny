# 2026-11-20 — a home starter's follow-up carries one example answer

**Sibling app: check, then port if its starters match.** Behind STARTER_FOLLOW_UP_EXAMPLE_ENABLED (default off). When
the app's own home starter "Create a coaching form." or "Show me training related to this issue." is the chat's first
message, the who-question (or Sunny's "which issue?", when no training was shown) carries one short example answer
(`ai/starter-follow-up.ts`, applied last in `server-ask.ts`). Keyed to the starter texts in `ai/quick-questions.ts`, never
to a manager's own words. Ask Bubbles has its own starters: port the mechanism with its own texts and examples (store
wording), never Sunny's.
