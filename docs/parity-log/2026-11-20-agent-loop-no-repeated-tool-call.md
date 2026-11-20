# Agent loop: no repeated identical tool call in one turn (QA's f047, 20 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

A 27 s reply made the same tool call with the same input more than once. Within one loop turn (`run.ts`, around each
tool's execute, outside `runTool`), a call to a tool that only reads (find_staff, find_past_forms, read_form, read_policy,
search_knowledge, list_staff, app_help, read_reviews, read_stats), with the same input as an earlier call, returns that
call's result instead of running again. A tool that writes (propose_form, edit_form, open_form, coach_team) always runs
and clears what was kept, so a read after a write reads again; a refused call is not kept, so the retry guard still
counts it. The trace counts the reuses (`repeat_calls_reused`).
