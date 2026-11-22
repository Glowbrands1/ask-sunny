# Ported from Ask Bubbles (fee69631): a loop card citing "Care and Cleaning of Equipment and Facilities, p.21" saves it (22 Nov 2026)

**Sibling app: ported from Ask Bubbles** (its QA's round 2, U06/U09/U15/U17). Mechanism only.

Create read a loop card's heading through `namedPolicies`. Its NOT_A_NAME rule reads "of", "to", "with", "by" and
"about" as a sentence about a policy, so "Care and Cleaning of Equipment and Facilities" named nothing. Sunny's pinned
manual (`jba-manual-production-151.json`) has the same section and sixteen more headings like it: Standards of Conduct,
Return of Property, Proper Use of General Operating Equipment, Employment and Supervision of Relatives, Pay on
Separation of Employment, Time Off to Vote or Serve as an Election Officer, and others.

- **Port.** `manualSectionNamedBy` (`named-policy-section.ts`) looks a phrase up as a heading. The draft route looks a
  loop card's heading up that way first, because the tool already checked it is a manual heading. Any other card goes
  through the old reading.
- **Sunny-only (Direct policy).** In Sunny, Policy Violated was already saved through another path, but Direct policy
  was not. With the chunk as production holds it (the heading 105 characters in, after the previous section's tail),
  Sunny's passage picker (`account-passage.ts`, #1194, which Bubbles does not have) quoted that tail when no block of the
  section fit the account. A plain heading with no fitting block now leaves its wording as it was. The text above a
  heading is a general rule only for a list heading (the dress code), as before. When Bubbles ports #1194, this
  fallback goes with it.

Tests: replay `nov22-agent-loop-care-and-cleaning-saved-cases.ts` (QA's turns, invented Remy Calder; both chunk
shapes); unit test `forms/account-passage-previous-tail.test.ts`. Each fails before and passes after.
