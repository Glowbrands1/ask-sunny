# 17 Nov 2026: STC DM L10 — one New Issue button, numbered priorities (ported from Ask Bubbles)

The owner asked for two of Ask Bubbles' DM L10 changes (Glowbrands1/Ask-bubbles#953, squash `7041933`) here:

- "in ask sunny DM L10 there 2 of these, just need 1": the New Issue bar showed on every page next to the To-do List's
  and IDS's own add rows. It is now a floating "+ New Issue" button that opens a window (`NewIssueButton` in
  `meeting/_components/BloomShell.tsx`).
- "in ask sunny, we should be able to label 1 2 3 and appear that they are indeed 1 2 3 in ranking": the IDS "!"
  circles are numbered 1, 2, 3 in the order picked, and those issues sit on top in that order (`lib/priority.ts`,
  `Issue.priorityOrder`; `priority: true` is kept so the Hub still shows its "!").

The rest of Ask Bubbles' DM L10 changes (its segue, scorecard, rocks, to-do and panel layout choices) stay
Bubbles-only until this team asks for them: `docs/parity-log/2026-11-17-dm-l10-*.md` in Ask Bubbles lists them.
