# Agent loop: the offense the manager named is the account; reported speech by reporter; a weekday is no person (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

These are QA's pre-launch items from Runner 2's 266 re-run on launch train 3. They change Ask Sunny only.

- **c019** (`tools.ts`, `proposeForm`, `headingTypedIn`):
  - When the card's policy heading, as the manual prints it, is typed in this request as what the employee did ("for
    Late Opening"), the manager has named that policy (`policy_named_by_manager`).
  - If the model gave no account, the manager's words for the offense become the account, and the fact
    `account_from_named_offense` tells the reply.
  - A heading typed as the policy itself ("the Attendance policy") names the policy but makes no account.
  - An account the model gave is never replaced.
  - The heading comes from the manual, never from a word list.
- **c090 T5, c091 T5, c247 T1** (`reply-pronouns.ts`, `trustedReporters`, `appConfig().leadershipTitle`):
  - A pronoun in a clause a named person reports ("<M> asked whether she …", "<P> messaged <SD> … stating she quit") is
    replaced only when the reporter is one of these: the card's person, the signed-in manager, a roster person whose job
    title leads others (manager, director, lead or supervisor, read from the roster's title), or "you" / "I".
  - A peer or a guest as reporter keeps the pronoun. So does a reporter who is a pronoun.
  - The reporter is the name right before a finite verb, or the sentence's first named person for a participle.
- **c200** (`tools.ts`, `holdsWeekday`): a capitalised pair holding a weekday ("Both Sundays") is never reported as
  another person in the account (`account_names_other_person`). The weekday names come from the calendar (Intl), not a
  list.

Port all of these with the loop when Ask Bubbles gets it. Use Bubbles' own manual headings and job titles in its
`appConfig`: port the mechanism, not Sunny's policies or titles.
