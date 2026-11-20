# Loop-card Create: Prior actions stay blank unless the card recorded them (20 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and this applies only to Create from a loop card
(`cardFromLoop`). Port it with the loop.

Background: Pau's saved-form review, relayed by QA (item 13). Names in the cases are invented.

- The drafter wrote Prior actions "None — first occurrence" when the manager said nothing about earlier steps.
- Fix: Create sends the prior actions the loop's card recorded (`cardPriorActions`). When the card recorded none, the
  drafter's Prior actions line is left blank. No new word list: the card's record decides.

Item 12 (the Action Plan) was dropped by Pau's ruling (20 Nov 2026): the Action Plan is unchanged.
The older chat path (not the loop) is unchanged.
