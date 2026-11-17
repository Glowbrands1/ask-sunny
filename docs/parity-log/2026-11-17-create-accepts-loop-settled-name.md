# Create accepts the name the agent loop settled for its card (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet; its Create check reads the chat as before.

Runner 2's saved-form run on 33863575: 6 of 138 loop cards were refused at Create ("This proposal is out of date: the
conversation now says the form is for <typed>, not <card name>", c003). The loop had settled the typed spelling as the
card's person with its recorded Did-you-mean and the manager's yes; Create's currency check reads the chat's words only,
and its reader of a "Did you mean" (a reply that starts with the question, a bare yes) missed the loop's: a question after
other words, a yes going on with the account, a reworded question.

For the loop's own card (its trace record for this proposal id, with this very name), the check is given the names the
loop settled as its person: the card's name and the typed spellings its recorded name questions asked about while
offering that person (`lib/ai/agent-loop/settled-names.ts`). The check is not loosened: anybody else named is read as
before, and for such a card the reply-text reader no longer accepts the card's name whoever the chat named after it, so a
switch to another person after the card is refused.

Port with the rest of the loop when Ask Bubbles gets it.
