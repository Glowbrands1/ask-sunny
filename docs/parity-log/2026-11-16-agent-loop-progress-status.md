# 2026-11-16 — agent loop: progress statuses while it works (PR 6, item 5)

**Stays Sunny-only for now.** The statuses ("Looking up <name>…", "Building the card…") come from the agent loop's
tool steps, and the loop is not in Ask Bubbles yet (behind AGENT_LOOP_ENABLED here and under rebuild). Only the
loop sends them. The stream's version 2 (`src/lib/api/streamed-response.ts`), the provider's `onProgress` and the
thinking bubble's status are the same in both apps' code shape: take them with the loop when it is ported, swapping
"Sunny" for "Bubbles" in the help status. Version 1 of the stream is unchanged, so nothing changes in Ask Bubbles
until then.
