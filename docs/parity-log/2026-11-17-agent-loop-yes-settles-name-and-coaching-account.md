# Agent loop: a yes to the Did-you-mean settles the name; a coaching topic stays the account (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

Two regressions from #1087 and #1092, found by Runner 2's 266 re-run on main 33863575:

- **c163: the "yes" was not accepted.** The answer to a recorded name question is now the first later manager turn that
  answers it (a yes or an offered full name, a no, the typed name, or somebody's full name), not just the next turn. A turn
  that does not answer it ("can you make a verbal warning Ca") leaves it open: no card is built under the offered name,
  and the later "yes" settles the person for every turn after (`confirmed-spelling.ts`).
- **c243 / c244 / c075: the coaching topic left the account.** The "Other — <topic>" policy never takes the account's
  place. With no account from the model, a coaching card's topic (its kept topic, else its Other topic when the words are
  the manager's own) is the account, and the policy line is in addition (`tools.ts`, beside `offenseAccount`).

Rules book: the account rule above (a coaching topic the manager gave is still the account; the policy is in addition).

Port with the rest of the loop when Ask Bubbles gets it.
