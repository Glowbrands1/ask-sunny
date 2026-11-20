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
