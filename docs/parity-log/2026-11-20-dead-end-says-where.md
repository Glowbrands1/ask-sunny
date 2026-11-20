# 2026-11-20 — when Sunny can't do it, it says where in the app to go

**Sibling app: check, then port with its own destinations.** Behind DEAD_END_SAYS_WHERE_ENABLED (default off). The
system prompt's reports section routes by the person's real permissions from the authorized actor (`WhereToGo` in
`ai/prompts.ts`): view_daily_stats without view_reports → the Home page's Performance section, never "no access";
neither → ask their Salon Director; view_l10_meetings → the L10 page (Resources, then L10), else ask their District
Manager or an admin. Prompt only. Ask Bubbles: port the mechanism with its own pages, roles and store wording; check
whether its assistant store manager role has the same daily-stats-without-reports gap.
