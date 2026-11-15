## 15 Nov 2026: times shown to people are in the business zone (CT in Sunny) — mechanism for both apps

Pau: "The whole app and chat should be in CT." The database keeps UTC; only display and tool output changed.
`lib/business-date.ts` gains `formatBusinessTime` ("Nov 14, 6:01 AM CT") and `formatBusinessDay` ("Nov 14"), both from the
business zone (`NEXT_PUBLIC_BUSINESS_TIMEZONE`), with the label taken from the zone (CST/CDT → CT, EST/EDT → ET), so a
different business zone shows its own label. Surfaces moved off UTC or the host's zone: the agent loop's `read_reviews`
`last_sync`, the Bed/Spa "loaded" time the chat reads (`formatLoadedAt`), the Salon Performance data-source panel, the admin
feedback queue and usage-shape dates, the L10 assistant history and notification dates. Calendar-date labels, report period
labels, cron schedules and the spend guard's UTC day are unchanged on purpose.

Sibling app (Ask Bubbles): ported (branch claude/central-time-display, fb43a993): the same helper and the feedback-queue change,
with a test. Bubbles' business-date.ts already defaults to America/Chicago; both apps read the label from the zone and
nothing is hard-coded twice. Bubbles has no agent loop, Salon Performance panel or L10 panel.
