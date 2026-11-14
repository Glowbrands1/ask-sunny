# DM L10: no ranking on IDS

**Change.** The DM L10 tab's IDS no longer shows the "Everyone's top three" table, the Rank buttons or the Priority
badges (`RANKING = false` in `src/features/l10/meeting/_components/Ids.tsx`). The team works IDS the way it did in
Bloom Growth: a list of issues, solved in turn.

**Ask Bubbles: not needed now; carry it over.** Ask Bubbles has no L10 tab yet. The team asked for the same in Ask
Bubbles' L10 meetings: when they are copied from `src/features/l10`, keep `RANKING = false`.
