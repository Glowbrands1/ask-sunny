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
