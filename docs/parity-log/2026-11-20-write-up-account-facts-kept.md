# Loop-card Create: every fact on the card's account stays, and its prior-actions count survives (20 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and both changes apply only to Create from a loop
card (`cardFromLoop`). Port them with the loop.

Background: QA's live test of #1121 (f061). The tester's chat had one manager turn, a 351-word late-opening account. The
tester's person was the invented "Test Testy"; the replay case uses STAFF's invented Remy Calder.

- **Facts lost.** The saved Observation dropped "this is the third time in two months" and "a customer said she would not
  come back".
  - Create now sends the card's account (`cardAccount`).
  - After drafting, `account-facts-kept.ts` checks each sentence of that account against the drafted Observed part. A
    sentence with several clauses is checked clause by clause.
  - Anything missing is added in the card's own words. This compares the card's record with the app's own text; it
    adds no word list.
- **Prior-actions count lost.** The card showed "Prior actions: Verbal (2), dates not given"; the form saved "Verbal
  coaching — date not given". When a loop card recorded prior actions, the saved line is now the card's own. This
  builds on #1143, which leaves the line blank when the card recorded none, and the branch is stacked on it.
- f062 (the Action Plan should follow the manager's stated step) was dropped: Pau's item 12 ruling, "change nothing
  in the Action Plan", stands.

## Only the missing fact (QA's live test of #1152, f083)

The card's account was appended whole: the lateness and the customer fact twice, plus the manager's "She". Only "this
is the third time in two months" was missing. Now:

- A sentence is split at a comma that starts a new clause, and only the missing clause is added.
- A fact one drafted sentence already holds in other words ("would not return" for "won't come back") counts as
  present.
- A date written out counts as the same date ("November 18, 2026" is 11/18).
- An added clause that opens with she/he opens with the first name. #1145's first-name pass also covers pronouns in
  saved write-ups and runs after this pass.

Still loop-only (`cardFromLoop`); not needed in Ask Bubbles yet.
