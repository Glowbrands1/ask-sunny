# Coaching answers link the closest training video — Sunny only (26 Nov 2026)

**Change (Ask Sunny):** a coaching how-to answer names the closest ready video from the Videos library in
`recommendedVideoIds`, which the chat already shows under the answer (`src/lib/ai/coaching-video.ts`, hooked in
`src/app/api/chat/route.ts` on both the agent-loop and the older path). There is no video when nothing in the library
shares a topic word with the question. It is never shown on a card turn, and only to a viewer with `view_videos`.
Replay: `nov26-coaching-video-cases.ts`.

**Ask Bubbles: not ported.** Bubbles has no Videos library: no `/videos` page, no `/api/videos` route, no
`src/lib/videos/` and no `training_videos` table. With no library, there is nothing to link. If Bubbles adds a library,
port `coaching-video.ts` and the two route hooks with it.

The rest of the same change (the coaching prep package in the rules book, the older prompt, the loop's check and Quick
mode) is ported: Ask Bubbles commits `7f20bc8` and `2e2e2db` on `claude/coaching-how-to-script`.
