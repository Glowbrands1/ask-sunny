# Ported from Ask Bubbles (136d85d, #1006): a corrected spelling of the card's person is that person; a timed-out turn gets a saved reply (22 Nov 2026, A1)

**Sibling app: ported from Ask Bubbles.** Bubbles found both issues in its live re-run (A1, blocker) and noted that
Sunny has the same rule (its docs/parity-log/2026-11-22-corrected-spelling-is-the-card-person.md). Mechanism only.

- **Corrected spelling.** `cardNameCorrection` now also takes a full name whose first and last names are each a close
  spelling of the open card's person's (within two letters and a third of the longer name) as that person,
  corrected. This holds even when the message asks for another form. Before, "Her name is <P2>" after a card for
  "<P1>" was refused as person_change_not_asked.
- **Timeout reply.** A loop turn that runs out of time with nothing done now returns a normal reply, saved with the
  chat: "I ran out of time before I could answer that, so nothing was changed." Before, it threw a 504 that was never
  saved, so the turn showed no reply on reload.

Sunny adaptations to the replay cases (`nov22-agent-loop-name-correction-same-person-cases.ts`,
`nov22-agent-loop-timeout-stored-reply-cases.ts`):

- Sunny's invented person and place replace the sibling app's: Marnie Holloway, Kearney, tanning consultant.
- Sunny asks "Did you mean" for any misspelling within A1's reach, so the card is <P1>'s only after the manager keeps
  the name as typed. T2 is therefore "no" rather than the sibling app's "I already told you the employee name". T1, T3
  and T4 are QA's words.

Each case fails before the port and passes after.
