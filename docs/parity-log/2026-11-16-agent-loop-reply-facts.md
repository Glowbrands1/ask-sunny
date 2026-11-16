# 2026-11-16 — agent loop: never JSON to a manager; the reply says what the code did

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds: a manager never sees the response
object as text (`unwrapReplyEnvelope`, logged as reply_unwrapped), and the reply is worded from facts about what was
done: edit_form's `form_state` (saved on a draft, so never "press Create") and `revision_draft.reused` (a reused
revision draft is never called new). Port these with the loop.
