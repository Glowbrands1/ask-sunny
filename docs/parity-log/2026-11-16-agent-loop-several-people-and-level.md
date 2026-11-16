# Agent loop: one card on screen with the next person offered; a level said with the request is ticked (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

QA's live re-test on 269ac0d9, two items:

- **Several people in one message.** The model called propose_form for two people in one step. The calls ran together,
  both passed the one-card check, and the second card replaced the first while the reply described both. The one-card rule
  is now checked again where the card is set: another person's card in the same turn is refused (`one_card`), and the
  reply ends with the app's offer of that person's form. A one-word answer to that offer builds the card and is never that
  card's payroll or level answer (`answer_to_offer`).
- **A level said with the request.** "written CA for <A>, …, payroll deduct $20" left the level unset: the model sent
  none. A Corrective Action card with no level whose message names exactly one of the form's Type of Warning options now
  gets the `level_not_given` fact, as a card with no policy gets `policy_not_given`. The evidence check still decides.

Port with the rest of the loop when Ask Bubbles gets it.
