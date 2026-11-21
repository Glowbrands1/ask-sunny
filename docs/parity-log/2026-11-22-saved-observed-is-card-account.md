# The saved Observed part is the card's own account (22 Nov 2026, QA's live L4/L5)

**Sibling app: port to Ask Bubbles** (the same Create path: `withAccountFactsKept(timed, body.cardAccount…)` in
`src/app/api/forms/instances/[id]/draft/route.ts`, checked at Bubbles `4fd060f`). Mechanism only.

QA's live L4/L5 on prod 14fed8c: the card read "…to show the team the new puppy" and Create saved the drafting model's
"…to show the team a new puppy"; "The shift lead <S1> told Test to go home and Test refused." saved as "Shift lead <S1>
told Test to go home, and Test refused.". The keep-the-facts passes only add what the drafter dropped; they never undo
its rewording.

`withCardObserved` (`account-facts-kept.ts`) makes the Observed part of a loop card's drafted account the card's own
account (`cardAccount`, the card's issue text): the drafted label line and every later part (Expectation, Going
Forward, Action Plan) stay as drafted. One source of truth; no wording list. Tests: `forms/card-observed.test.ts`;
replay `nov22-agent-loop-saved-equals-card-cases.ts` (the drafter writes QA's saved text; fails before, passes after).
