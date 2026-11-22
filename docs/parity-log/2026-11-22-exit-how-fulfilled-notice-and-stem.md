# Exit card: a fulfilled notice the reader cannot read is carried by exit_how; the label check reads stems and contractions (22 Nov 2026)

**Report (QA's B6 re-run, Sunny side):** T1 "can you make me an exit form for <P> … she gave 2 weeks notice and is
fulfilling them …". Sunny's exit reader (`exit-facts.ts`) reads a notice served only in the past ("worked out her
notice"), so the live present tense ticked nothing, and the model's exit_how was the only reading. QA's ruling: no new
reader phrases; the model's exit_how, kept by #1214's label check (`quoteNamesOption`), carries it.

**Mechanism (Sunny, #1215, stacked on #1214):**
- exit_how accepts `submitted_fulfilled_notice`; the card files it in its own group and Create writes it to the group
  that holds the option on the draft's template version (`resignation_notice`). Tool schema and rules book say so
  (prompt fixtures re-taken).
- `quoteNamesOption`: a word sharing a stem of 6+ letters with a label word names it ("fulfilling" / "Fulfilled"); a
  contraction is its two words ("didn't" = "did not"); a typed word that merely starts with a label word of 3 letters
  never names it. Before this, "notice" named the label's "not", so "gave 2 weeks notice and is fulfilling them" named
  "Did not fulfill required 14 day / 30 day notice" (3 of 6 words).
- Replay: `nov22-agent-loop-exit-notice-one-decision-cases.ts` (`nov22-b6-live-wording-*`, invented person), failing
  first; unit: `quote-names-option.test.ts`.

**Ask Bubbles: same gaps, port needed.** Bubbles' `quoteNamesOption` (#1013) has the same "notice" → "not" match and no
stem rule, and its exit_how has no `submitted_fulfilled_notice`. Bubbles' own reader already reads the present tense
("is fulfilling them"), so the live wording is lower risk there, but a model exit_how of notice_not_fulfilled quoting
those words passes Bubbles' label check today.
