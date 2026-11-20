# 2026-11-20 — agent loop: a roster person is seated only when named or picked

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds (`personNamedOrPicked`, propose_form in
tools.ts): a roster person goes on a card only when the manager's words in the chat name them exactly (full name, or a
whole first or preferred name), as a close spelling (the Did-you-mean, unchanged), or by a recorded pick or confirmation
(a confirmed spelling, an answered name question that offered them, an earlier card for them, the draft open for them);
otherwise `person_not_named` and the who-is-it-for question. Port with the loop.
