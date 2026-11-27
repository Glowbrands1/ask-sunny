# Voice input screenshots (VOICE_INPUT_ENABLED, 27 Nov 2026)

Taken from a local `next dev` run in demo mode (no Supabase, no Leadership Hub), Chromium with its fake microphone,
and `POST /api/chat/voice` stubbed in Playwright (no AssemblyAI call). To show the mic in demo mode the run used an
uncommitted local change that let `voiceInputEnabledFor` and the layout accept the demo identity; the committed code
keeps voice off in demo mode.

- `chat-*`: box A (the chat composer). `overview-*`: box B (the Overview band). `reviews-*`: the Google Reviews ask
  bar (the extra box). Box C (report ask bars) needs reporting data and box D (L10 assistant) needs the Leadership Hub,
  so neither opens locally; their DOM tests cover them.
- `*-1-idle`, `*-2-first-use-notice`, `*-3-recording-timer`, `chat-4-50s-warning`, `*-5-transcribing`,
  `*-6-text-in-box-check-the-words`, `chat-7-cut-off-offer`, `*-8/9/10-phone-390-*` (a 390 px phone).
- `chat-error-*`: every message (the other boxes show three, to show where their line sits).
- `not-listed-*`: the switch on, the signed-in email not on `VOICE_INPUT_USERS`: no mic.
- `flag-off-*`: `VOICE_INPUT_ENABLED` off: nothing changed.
