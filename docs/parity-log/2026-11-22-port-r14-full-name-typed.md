# Ported from Ask Bubbles (#1025, R14): the full name the manager typed, not its first word (22 Nov 2026)

**Sibling app: ported from Ask Bubbles.** Bubbles noted that Sunny's propose_form has the same
`withoutJobTitle(tidyTypedName(…))` and not_on_roster path. Mechanism only.

`typedFullNameOf`: a one-word name nobody on the roster has, which the manager typed in this request as the first word
of exactly one capitalised full name ("Test Employee" in "for Team Member, Test Employee."), goes back to the model with
that full name (`full_name_typed`), so it proposes the card again with it. A full name the manager typed exactly is never
cut down by `withoutJobTitle`. It reads the manager's own words and capitalisation; there is no word list.

Replay: `nov22-agent-loop-full-name-typed-cases.ts`, using QA's wording and QA's own test name (nobody on the directory).
Before the port, every reply asked "use Test"; after it, the card is made for "Test Employee". Unit test:
`agent-loop/typed-full-name.test.ts`, ported as is.
