# Board f111: the words the loop searched with are on the chat trace (agent_loop_queries) — Ask Bubbles port later, through QA

**Ask (QA, 23 Nov 2026):** save the words the loop searched with (find_staff, policy, forms queries) in the trace record,
for later checks. No manager-visible change; no extra personal data beyond the query already sent.

**Change (Ask Sunny):** `run.ts` records, per search-tool call, `{ step, tool, query }` in a slot of its own,
`slots.agent_loop_queries`: find_staff's name, find_past_forms' person, form and dates, read_policy's heading,
search_knowledge's query (`searchedWords`). Each passes `redactTraceText` (the same redaction `original_query` gets) and is
capped at 200 characters. The words come from the manager's own messages, which the same row already stores in
`original_query`. `slots.agent_loop.steps` stays value-free: the nov14 trace case's no-names check is unchanged and still
covers every step. No hashing (QA).

**Guard (the repository is public):** `trace-queries.test.ts` fails if any committed file under src, docs, supabase or
scripts names `agent_loop_queries` beyond the code that writes it, the tests that read it and this entry, so no fixture or
dump of searched words can be committed.

**Ask Bubbles:** same trace and loop; port later, through QA.
