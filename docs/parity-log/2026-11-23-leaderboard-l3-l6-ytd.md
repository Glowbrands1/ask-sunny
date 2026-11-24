# Salon leaderboard: This month, L3, L6 and YTD (Ask Sunny, 23 Nov 2026)

**Change:** on the Salon Leaderboard the toolbar's Week control becomes
"Period" with four choices — This month to date, L3, L6, YTD — and the board
ranks, draws its bars and statuses, and links by the chosen period. L3 / L6 /
YTD come from the Month by month table's totals, against the monthly target
times the months covered (`src/lib/reviews/leaderboard-period.ts`).

**Ask Bubbles: not ported.** Pau's request for Sunny's board ("they dont want
week, they want per month, per 3 months per 6 months and YTD pls and then let
it show in the data below"); a display choice on the reviews page, not a bug in
shared chat, forms, Corrective Action, policy, access or sync code. Bubbles has
the same Month by month totals, so the mechanism ports cleanly if its owners
ask.

**Update, same day: ported.** Pau: "pls do in bubbles too but pls add the per
month for both like September october november and make sure it syncs in the
data below". Sunny's Period now also lists each full month (`yyyy-mm` in the
URL); Bubbles' leaderboard month picker became Period and gained L3, L6 and
YTD (`src/lib/google-reviews/leaderboard-window.ts` there). See both pull
requests on branch `claude/epic-goldberg-in71sf`.
