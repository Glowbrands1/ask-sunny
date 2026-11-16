# Hotfix: the saved Corrective Action carries the policy the agent-loop card cited (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet, and only an agent-loop card carries `policyLine`, which
is where the "Other — <topic>" is read from. Port it with the loop: the change in the drafting route
(`cardOther`) is generic, and keyed on the form's own Other option and Policy Violated field.

QA's hotfix on main 6d0b4ab1 (the tester's form 7545d162): an agent-loop CA card citing "Other — <topic>" saved with no
Type of Offense, an empty Policy Violated and an Action Plan on "the applicable company policy". The draft request
carried only the card's heading ("Other" is none of the manual's), so the drafter was told "APPROVED POLICY: none found".

- `cardOtherTopic` (`lib/forms/card-policy.ts`) reads the "Other — <topic>" off the card's own policy line.
  `createInlineForm` sends it as `cardOther`, behind NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED.
- `POST /api/forms/instances/[id]/draft`, on a form whose Type of Offense offers Other:
  - the drafter is told the card cites Other — <topic>;
  - the form's Other box is ticked beside any other box;
  - Policy Violated reads "Other — <topic>" (or has it added after a cited heading), so the Action Plan names the topic.
- A heading on the card ("Attendance p.14") was already carried. A replay case now checks Policy Violated and Direct
  policy on the saved form.
