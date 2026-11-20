# 2026-11-20 — agent loop: the person told by someone else is named, never a pronoun

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet, so it has no reply-side pronoun guard to port to
(`agent-loop/reply-pronouns.ts`). Rule this adds: the pronoun right after "told / asked / reminded / instructed /
directed / warned" and before "to / not / that / if / whether" is the listener; when someone other than the card's
person is telling, it is the card's person and is named, and so is the same pronoun opening a joined clause later in the
sentence ("and she refused", "but he left"). Quotes stay as typed; a peer's own reported clause ("asked whether she could
swap") is unchanged. Port with the loop.
