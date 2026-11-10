## 10 Nov 2026: NO_CARD_NO_DRAFT_CLAIM (#233) — rebuilt for Ask Bubbles only; not needed here

#233 (QA B22-2, 25 Oct 2026, never merged) added a guard that rewrites the answering model's claim "A new Corrective
Action Form draft is open for <B> … press Finalize on the card" when no card came back. QA's triage of the October
pull requests (#796, `docs/parity-log/oct-pr-triage.md`) found, on main with production's flags, that the false claim
is gone here: the route answers that turn deterministically. What was still live here was the no-card bug underneath,
for QA's wording with a title ("now one for Test Employee Two, tanning consultant, late today"). It is fixed by
SECOND_PERSON_ACCOUNT_WORDS_ENABLED in this pull request.

In the sibling app the triage still saw the model's claim returned unchanged after a no-card turn, so the guard is
rebuilt there (QA, 10 Nov 2026).
