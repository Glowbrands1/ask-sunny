# 2026-11-16 — agent loop: the "Did you mean" answer (fix batch item 4)

**Stays Sunny-only for now.** The change is in the agent loop (`src/lib/ai/agent-loop/confirmed-spelling.ts`,
`tools.ts` find_staff and propose_form, one rules-book line), which Ask Bubbles does not have yet (it is behind
AGENT_LOOP_ENABLED + AGENT_LOOP_USERS here). Today's chat path is untouched: its `readNameConfirmation` and
`settledNameQuestions` in `src/lib/forms/employee-match.ts` are only read, not changed.

When the loop is ported, take the mechanism with it: a spelling the manager confirmed through the app's own
"Did you mean **<A>**?" (a bare yes, or <A>'s full name typed back as whole words) counts as <A> when the card picks
this person's turns, and find_staff returns `confirmed_by_manager` so the model proposes instead of asking again.
Swap Sunny's invented people and the salon/store wording; there is no word list to port.

**Item 3 (same PR, also Sunny-only):** an answer to the "Did you mean **<A>**?" that names somebody else in full (a
pasted account about <B>) is not a yes; propose_form refuses <A> with `right_person` and the model asks or looks up
<B> (`answerNamesSomeoneElse` in the same file). Port it with item 4.

**Item 6 (same PR, also Sunny-only):** when the manager's message answers the loop's own "Who is this <form> for?"
and the reply came with no find_staff, card or staff list (a bare first name not looked up, or read as an acronym),
run.ts hands the turn back once with an [app check] to look the name up (`answersWhoQuestion`, trace `who_review`).
Port it with the loop.
