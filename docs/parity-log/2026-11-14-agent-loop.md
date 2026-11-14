# 2026-11-14 — HR chat tool loop (AGENT_LOOP_ENABLED), Sunny-only for now

**Sunny change:** behind a new default-off master switch `AGENT_LOOP_ENABLED`
(and `AGENT_LOOP_USERS`, a comma-separated list of signed-in emails, case and
spaces ignored), the chat turn is answered by one model with tools whose results
go back to it, step by step (default 6 steps, at most 10): `find_staff`,
`find_past_forms`, `read_form`, `propose_form`, `edit_form`, and a read-only
`read_policy` for the JBA Policy Manual's own wording. The reply is the model's
own, unrewritten, so the next turn's history is too. The hook is one gated branch
in `app/api/chat/route.ts`; the loop is `src/lib/ai/agent-loop/`. Off, the route
never reaches it.

**Sibling app: not ported in this change.** It is a trial on one Sunny test user
(QA's plan), not a fix of a shared bug. Ask Bubbles has the same shape — no tools
for the main chat model in production, tool results never returned to the model,
and the reply rewritten after the answer — so the mechanism ports as is once the
trial is judged: the switch, the tools over Bubbles' own scope helpers (store ↔
salon, Forms Register ↔ Form Monitoring), the loop, the route hook. Port the
mechanism, not Sunny's prompt wording.
