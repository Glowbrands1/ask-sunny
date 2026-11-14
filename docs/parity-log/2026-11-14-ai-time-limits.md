# 2026-11-14 — AI time limits (Ask Sunny), gaps in Ask Bubbles

**Sunny change:** every AI call has a hard time limit, whatever `MODEL_RETRY_ENABLED`
says: 45 s for the main answer, 30 s for helper calls (`src/lib/config/ai-timeouts.ts`,
env-overridable: `AI_MAIN_TIMEOUT_MS`, `AI_HELPER_TIMEOUT_MS`; the reader's 3.5 s and
the form patch's 5 s are unchanged). The limit covers the whole call, the SDK's
retries included (`src/lib/ai/time-limit.ts`: an abort signal raced against the
limit, because the SDK's own `timeout` stops at the response headers and an
aborted stream ends quietly). A timeout gives the manager a short message and
writes one server log line (`[ai.timeout] route=… call=… duration_ms=… limit_ms=…`).
Main-call and helper failures are on the server log too (`[ai.failure] …`, status
and error type only), and `errorResponse` logs an AiError's code and status.

**Sibling app: not ported in this change (QA's instruction: don't edit Bubbles).**
The matching gaps in Ask Bubbles, for a later port of the mechanism:

- `callClaude` (main answer) passes no timeout: only the SDK's 10-minute default,
  bounded by the chat route's `maxDuration` (120 s). A stalled stream ends in the
  platform's error, not a reply.
- Drafting (`app/api/forms/instances/[id]/draft/route.ts`) and chat revision
  (`lib/forms/chat-revision.ts`, protected there too) have no time limit.
- `callClaudeTool*`, the form-patch call and the policy pick fail silently: no
  server log line on a failure or a timeout.

Port the mechanism (the config file, `withAiTimeLimit`, the log lines, the 504
message in `chat-error.ts`), not Sunny's wording.
