# Agent loop hotfix: an account never holds text to the manager (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

QA's hotfix on main d7042447 (Runner 2's c019; live tester r2). After train 4's c019 change, the model wrote its helper
line into the Observation ("Late Opening. — that's your words for the offense; add any details before you press Create."),
so it would have been saved on the form.

- **The offense is the account, exactly.** In `proposeForm`, when the offense the manager named is the account, the account
  is exactly the manager's words for it plus a period. A model account that is only that offense is replaced by those words.
- **No text to the manager in an account.** `withoutTextToManager` checks `what_happened` and `prior_actions`. It takes out
  any sentence or bracketed aside whose second-person word the manager never typed with the same neighbouring word. The
  check reads the manager's own messages, never a phrase list. The fact `account_text_to_manager_removed` tells the reply.
  - Kept: a quoted guest ("you can wait"), and an account written to the employee ("you were scheduled", c200).

Port both with the loop.
