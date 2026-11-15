## 15 Nov 2026: times shown to people are in the business zone (CT in Sunny) — mechanism for both apps

Pau: "The whole app and chat should be in CT." The database keeps UTC; only display and tool output changed.
`lib/business-date.ts` gains `formatBusinessTime` ("Nov 14, 6:01 AM CT") and `formatBusinessDay` ("Nov 14"), both from the
business zone (`NEXT_PUBLIC_BUSINESS_TIMEZONE`), with the label taken from the zone (CST/CDT → CT, EST/EDT → ET), so a
different business zone shows its own label. Surfaces moved off UTC or the host's zone: the agent loop's `read_reviews`
`last_sync`, the Bed/Spa "loaded" time the chat reads (`formatLoadedAt`), the Salon Performance data-source panel, the admin
feedback queue and usage-shape dates, the L10 assistant history and notification dates. Calendar-date labels, report period
labels, cron schedules and the spend guard's UTC day are unchanged on purpose.

Sibling app (Ask Bubbles): same mechanism, its own zone. Bubbles' `business-date.ts` already defaults to America/Chicago.
Checked against it: `features/admin/analytics/feedback-queue.tsx` has the same host-zone `toLocaleString`/`toLocaleDateString`
(`longDate`/`shortDate`), so the helper and that change belong there too. Bubbles has no agent loop, no Salon Performance
panel and no L10 panel. Not ported in this pull request (this session reads Bubbles, it cannot push there): QA to have a
session with push access port `formatBusinessTime`/`formatBusinessDay` and the feedback-queue change as
`Port from Ask Sunny (<sha>): times in the business zone`. Never copy Central into Bubbles: it reads its own setting.
