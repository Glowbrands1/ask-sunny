# The saved form has the card's warning level (QA's round 2, 22 Nov 2026, U09; Ask Bubbles #1016) — not needed in Sunny

**Report (Ask Bubbles):** T1 "create a written CA for <P>." T2 "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On
11-1-26 <P> violated care and cleaning of facilities policy". The card said Written; the saved draft had no
warning_type: Bubbles' Create re-read the conversation and found "Verbal CA" (a prior step), so the card's level was not
saved. Bubbles' fix: Create saves a loop card's level when it is the level the loop's server record holds
(`loopCardSettlement.level`).

**Ask Sunny: already holds.** Sunny's Create (`src/app/api/forms/instances/route.ts`, `statedLevel`) writes a card's
stated verbal / written level through `applyStatedFacts` without re-reading the conversation, so a prior step's "Verbal
CA" never replaces it. The same turns through Sunny's real chat route save Written: the replay case
`nov22-agent-loop-saved-level-is-the-cards-cases.ts` (QA's turns, invented person) passes on main unchanged and is kept
as a guard. No code ported. The sibling fix's other half, a prior step left off on its own (#1015), is ported in the same
pull request (`priorActionsSplit`).
