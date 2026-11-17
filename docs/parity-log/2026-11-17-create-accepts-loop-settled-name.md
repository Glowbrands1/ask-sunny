# Create reads the agent loop's card with the loop's record for it (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet; its Create check reads the chat as before.

Runner 2's saved-form run on 33863575: 6 of 138 loop cards were refused at Create as out of date (c003, c039, c134, c210,
c220, c232). In every one the loop had seated the right person with its own evidence checks; Create's name reader re-read
the whole chat and took a job title before the name ("Tanning Consultant <name>", "TC <name>"), a salon after it, metric
words ("resubmit", "LPSVA"), or a person named only in a write-up pasted after the card as the form's person.

For the loop's own card (its trace record for this proposal id, with this very name; `lib/ai/agent-loop/settled-names.ts`),
Create's currency check reads:
- the turns after the card's own turn (the loop read the ones before with its checks);
- another person as somebody on the manager's roster, and the names the loop settled as the card's person (its recorded
  name questions) as the card's person;
- "Its a CA" as the form the manager says it is;
- never a "Did you mean" read from a reply's text, which passed a card whoever the chat named after it.
A switch to somebody on the roster after the card is still refused. Any other card is read as before.

Port with the rest of the loop when Ask Bubbles gets it.
