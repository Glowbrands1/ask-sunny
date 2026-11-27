# Voice input in the AI chat boxes (Ask Sunny only, 27 Nov 2026)

**Request (the owner, 27 Nov 2026):** a mic in every AI chat box (the chat, the Overview band, a report's ask bar
and the L10 Leadership Assistant; also the Google Reviews ask bar, which sends to `/api/chat` the same way). A recording of up to 60 seconds goes to the server, AssemblyAI Sync turns it into
text, the text lands in that box for the person to check and edit, and they press Send as usual. Off by default
(`VOICE_INPUT_ENABLED`), and on only for the emails on the server-only `VOICE_INPUT_USERS`.

**Changed (Ask Sunny):** `src/lib/voice/` (limits, who gets it, the AssemblyAI call, spelling hints, the usage
counters and trace row, the streamed upload), `POST /api/chat/voice`, `src/features/voice/` (the shared mic button
and recorder), the four boxes, the `(app)` layout's `VoiceAccessProvider`, the spend meter's `"voice"` source, and
`supabase/migrations/20261127002000_voice_usage.sql`. The agent loop, its tools, `prompt.ts`, `rules-book.ts` and
`agent-loop/switch.ts` are unchanged; the answer is text in the chat as before.

**Ask Bubbles: not ported.** Ask Bubbles gets its own voice change in a separate pull request, built from its own
prompt in a parallel session; nothing is copied between the two apps.
