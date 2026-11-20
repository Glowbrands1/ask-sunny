# 2026-11-20 — agent loop: the time watch covers each model call; the reviser has its own budget

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. From QA's code audit on main d7960a5f (items 14a, 14b,
15). Rules this adds, to port with the loop:

- Each model call (the loop's steps, the token-limit retry, each step of a hand-back) gets its own first-token wait and
  gap limit (`StreamWatch.attempt`/`idle`, `time-limit.ts`). A tool's work and the code's checks between calls are not
  timed by them (`toolStarted`/`toolFinished`); only the turn's total limit holds over them.
- A turn that stops (timeout or model error) while a tool is still running waits for it, within the time the route has
  left (`TOOL_SETTLE_MS`, `msLeftForCleanup`), so the reply states what it saved; if it still has not finished, the
  reply says to check the form, never "nothing was saved".
- coach_team's "create all" drafts count as done (`draftsCreated`, through `coachingForEveryoneTurn`'s `onCreated`).
- The form's reviser (edit_form with no values) is charged to the turn's step budget only up to what the pre-check
  reserves (`reviserModelCalls()`); its real call count stays in the trace (`tool_model_calls`).

The `onCreated` hook on `coachingForEveryoneTurn` is optional and unused by the chat route, so the route is unchanged.
