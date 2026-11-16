# Agent loop: a turn's records are found without matching message ids (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

QA's production traces: the name question's answer ("no", "use <typed>") was asked again on every turn although each
turn's record was written: the records were matched only by the history's message ids, which did not equal the
trace's message_id. Each loop turn now writes `question_key` (a one-way key of the manager's message) and `replyTurns`
finds a record by id, else by that key; the loop's trace row is written before the reply returns. Port with the loop.

**Root cause (QA's production chat_traces).** The first message of a new chat was traced with `conversation_id` NULL
(the inline ask, `use-inline-ask.ts`, sent no conversationId), and `readLoopRecords` read traces by conversation only,
so turn 1's records were never fetched. It now reads this user's traces by this conversation OR by the message ids of
the request's own history, and the inline ask sends conversationId on every send. The `question_key` match is a
fallback only, for a history whose ids do not match.
