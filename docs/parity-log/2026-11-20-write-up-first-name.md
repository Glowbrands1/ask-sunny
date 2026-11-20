# Loop-card Create: the saved write-up calls the employee by first name (20 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and this applies only to Create from a loop card
(`cardFromLoop`). Port it with the loop.

Background: Pau's saved-form review, relayed by QA (item 15; Runner 2's c151). Names in the cases are invented.

- The exit form's Reason for Resignation was saved as "She said her new job pays more.", and drafted text kept "her
  shift". The saved write-up has no she/her/he/him for the employee.
- Fix: the loop's reply pronoun pass (`reply-pronouns.ts`) runs on the saved text and on the exit Details lines, with
  the employee's first name (`first-name-write-up.ts`). It reads the saved text, not the manager's messages. Text in
  quotes, and the manual's quoted policy fields, stay exactly as written.

The older chat path (not the loop) is unchanged.

**19. The second mention reads naturally** (QA's production audit, same day). The swap wrote "<P> did not come into
<P>'s scheduled shift today".

- Saved text: the forms' own natural rewrite (`nameInsteadOfPronouns`, "for the shift", "and did not call") runs
  first, then the reply pass for anything it leaves. The exit Reason now reads "Remy said the new job pays more".
- Replies and the card's account line: the reply pass (`reply-pronouns.ts`) turns a possessive right after a
  preposition into "the" when the sentence already names the person, and drops a repeated subject after
  "and/but/or/then". A possessive elsewhere ("said her car broke down") keeps the owner as the name, so the meaning is
  never lost.
- Rules book: the model's own second mention in a sentence, in replies and in what_happened, drops the possessive or
  the repeated subject. Never "<P>'s shift" after <P>, never "their shift". The fixtures are updated on purpose.
- Not covered by code: a repeated subject after "when/because" ("<P> was out of dress code when <P> came into work").
  The rules book now asks the model to write that naturally. Code keeps the name there, because rewriting the verb is
  not safe.
