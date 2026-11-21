# 2026-11-20 — agent loop: coach_team's "create all?" is read from a record, never the reply's wording

**The mechanism is ported; the loop part stays Sunny-only for now.** The `coaching-for-everyone.ts` and `swapName` fixes
(A: "All team members" is swapped only as a whole phrase; B: each failed draft is named with why, and an empty failed draft
is never "already made"; C: an ordinary yes such as "yes please" or "go ahead and make them" answers "create all?";
D: "this coaching for the whole team" copies the open draft) are ported to Ask Bubbles. Ask Bubbles has no agent loop yet,
so this part is not ported: a turn whose coach_team asked "create all?" writes a `team_confirm` record (a one-way key of
the open draft), and the next turn reads the answer against that record, so a confirmation the model words its own way
still counts. Port it with the loop.
