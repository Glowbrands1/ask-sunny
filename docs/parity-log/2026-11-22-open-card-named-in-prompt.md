# With a card on screen, the model is told which card it is (the 266-chat run's 011): same gap in Ask Bubbles, port pending

**Report (Ask Sunny, the 266-chat run, re-checked on main 7787aa9):** with the Corrective Action card on screen, "it
should be the policy for staying past shceduled shift" got "Which form do you want it on, and who is it for?". The
system block's open-card line said only "A card is open", never which card.

**Fix (the mechanism):** the open-card line names the card's form (the card record's template name; the record holds
no person's name, by design) and says a message that names no other form or person is about that card (a policy,
level, date or account for it changes it with propose_form), never to ask which form or who. A prompt line; no word
list.

**Ask Bubbles: same gap.** On Bubbles main the open-card line in `prompt.ts` is the same bare "A card is open" line.
Port: the `cardOpenForm` input (run.ts passes `cardOnScreen?.templateName`) and the line; the replay case below with
Bubbles' roster and store.

**Tests:** replay `nov22-agent-loop-open-card-named-cases.ts` (011's exact words, invented people): fails before (the
model is not told which card is open), passes after. The reply itself depends on the model: listed for QA's live batch.
