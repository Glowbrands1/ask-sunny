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

## Pau's rulings, same day (via QA): the full write-up, the card's policy, no invented date

- **Going Forward.** It was missing on every Corrective Action and on Coaching forms where the manager typed no plan, on
  both paths, loop or not. `DRAFT_NO_INVENTED_PLAN_ENABLED` removed it. Pau wants the full write-up, so the flag is now off
  in `src/config/production-flags.json`; QA turns it off in Vercel. The code is unchanged.
- **The card's policy is the saved form's.** For a loop card (`cardFromLoop`), the card's heading is read as the manager
  naming that policy (`loopCardHeading` is added to `policyNotes`), so every policy reader cites it. A card citing Other
  alone sets Type of Offense to Other, Policy Violated to "Other — <topic>" and Direct policy to blank, and the plan is
  rebuilt from that line.
- **No date the manager did not state.** `withoutUnstatedDates` (`form-date-grounding.ts`) runs on the drafted
  Observation sections and the Action Plan. It takes out any date whose day the manager never stated, and logs it. A day
  word they used ("today", "yesterday") counts as stated.
- **The coaching Other topic is the topic.** `other-write-in.ts` reads the text after the form's own employee name
  ("Coaching for <name> on greeting guests at the door" → "Greeting guests at the door").
