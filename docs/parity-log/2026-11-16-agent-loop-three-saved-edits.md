# 2026-11-16 — agent loop: three saved edits in one turn (PR 6 guard)

**Stays Sunny-only for now.** The replay case `nov16-pr6-three-saved-edits-reply-lists-all` tests the agent loop,
which is not in Ask Bubbles yet (behind AGENT_LOOP_ENABLED here and under rebuild). It is test-only: no app code
changed. When the loop is ported, take the case with it, swapping the invented person and the salon/store wording;
the mechanism (three edit_form calls in one turn, one through the form's reviser, end with a reply under the step
limit that names every saved change) is the same.
