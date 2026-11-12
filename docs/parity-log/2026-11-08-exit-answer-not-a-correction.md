# Not needed here: an exit answer's "not returned" corrects no person (the sibling app's EXIT_ANSWER_NOT_A_CORRECTION_ENABLED)

The sibling app's live tester (QA, 8 Nov 2026): a district manager's six-turn exit chat filled the address, last day
worked, items, key, wage/bonus and not-eligible-for-rehire at turn 1, and from turn 2 every one of them was "Left blank
for you to review". There, "store items not returned … not eligible for rehire" was read as names negated, so turn 1
counted as a name correction naming other people, and the turns about this form started after it. Its fix
(EXIT_ANSWER_NOT_A_CORRECTION_ENABLED, default off) is two Pau-approved lines in its `forms/proposal.ts`.

Not needed in this app: checked on main 1a6c330 on 8 Nov 2026 with the same six turns (salon wording, the person
invented) under production's flags before and after round 5 (#684). Turns 2-4 keep every fact turn 1 stated: an exit
card here is read from the whole manager window, not from the turns about this form (`ai/form-proposal.ts`
`proposalContent(proposal, correctiveAction ? scoped : context, …)`), so the cut never reaches the exit card.
