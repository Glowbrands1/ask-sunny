# Loop-card Create: the saved payroll amount is the card's own (20 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and this applies only to Create from a loop card
(`fromAgentLoop` / `cardFromLoop`). Port it with the loop.

Background: QA's code audit on d7960a5f (item 20). Names in the cases are invented.

- (a) `instances/route.ts` re-read the whole chat with `payrollAmountFromConversation`, and the latest amount won. A
  later turn's figure replaced the card's: Remy's card said $20, a later "$45 back in October" saved $45.
  - QA's own shape (a later card for another person) is refused at Create on d7960a5f ("This proposal is out of date").
    The case uses the same reader with the same person.
- (b) The loop asked for the amount and the manager answered "25". The card showed $25, but the bare-figure reader only
  counts an answer to the app's own `PAYROLL_AMOUNT_QUESTION`. The card's draft line "Payroll deduct amount: $25"
  matched no pattern either, so the saved amount was blank.
- Fix (`card-payroll-amount.ts`): for a loop card, the instance writes the card's own amount, and the draft step reads
  the card's own line. Both read the card's record; the conversation is not re-read. Every other card is unchanged.
