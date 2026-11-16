# Agent loop: the open card keeps its payroll; a coaching card's policy is its own (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

Runner 2's 266 on train 4 (d7042447):

- **c163.** Payroll Yes, set at T4, was dropped at T6 ("we have already done coaching"): T5's reply showed no card, so
  nothing counted as on screen for the carry. Now the chat's latest card, rebuilt with the same account (a one-way key on
  the card record), keeps its payroll. A new account is a new card and carries nothing.
- **c014 T6.** A coaching card made "from this conversation" copied the CA's Standards of Conduct. A card other than a
  Corrective Action now cites a manual heading only when the manager named it for this card, or the topic reader fits it to
  this card's account (`policy_not_for_this_card`).

Port with the rest of the loop when Ask Bubbles gets it.

QA then ordered c163's three items, and two more are fixed here:

- **(1)** A "Did you mean <A>?" returned in a turn is recorded with the people it offers. A card for an offered person waits
  for the manager's answer in a later turn: it is refused in propose_form, or withdrawn if a parallel call already made it,
  and the question ends the reply.
- **(2)** A one-word message that answers the chat's recorded name question is never also payroll or level evidence
  (`answer_to_name_question`).
