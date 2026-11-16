# Agent loop: the offense the manager named is the account; a pronoun in reported speech is the card person's (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

QA's pre-launch items from Runner 2's 266 re-run on launch train 3 (Ask Sunny only):

- **c019** (`tools.ts`, `proposeForm`, `headingTypedIn`): the card's policy heading, as the manual prints it, typed in this
  request as what the employee did ("for Late Opening") means the manager named that policy (`policy_named_by_manager`).
  When the model gave no account, the manager's words for it are the account, and the fact `account_from_named_offense`
  tells the reply. A heading typed as the policy itself ("the Attendance policy") names the policy and makes no account.
  An account the model gave is never replaced. The heading comes from the manual, never from a word list.
- **c090 T5, c091 T5, c247 T1** (`reply-pronouns.ts`): a pronoun in a clause that a named person reports ("<M> asked
  whether she …", "<P> messaged <M> … stating she quit") is now the card person's, whether or not the card's person is
  named in the sentence (Pau's ruling, extended). A reporter who is a pronoun keeps it.

Port both with the loop when Ask Bubbles gets it, on Bubbles' own manual headings (the mechanism, not Sunny's policies).
