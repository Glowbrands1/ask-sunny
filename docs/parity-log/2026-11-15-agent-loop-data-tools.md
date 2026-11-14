# Agent loop app data tools (read_reviews, read_stats): Ask Sunny only for now

**Change in Ask Sunny.** The agent loop (AGENT_LOOP_ENABLED, behind AGENT_LOOP_USERS) gains two tools that read the
app's own figures: `read_reviews` (the Google Reviews page's snapshot and feed, gated on View Google reviews) and
`read_stats` (Daily Stats, Sales Totals and Comp through `loadReportBriefing` and the flagged breakdown, gated on View
reports; a Daily Stats "what to focus on" adds the Daily Stats Interpretation Framework's guide). Pau's scope rules are
enforced in the tools: a manager's primary and additional salons only, a global admin every salon as one summary, a
salon outside access refused with nothing read, rankings limited to the manager's own rows with a line that the
others are not visible. See `src/lib/ai/agent-loop/data-tools.ts`.

**Ask Bubbles: not ported yet** (v2-Coding-5, 15 Nov 2026). Ask Bubbles has no agent loop on its main
(`src/lib/ai/agent-loop/` does not exist there), so there is nothing to register the tools in. When the loop is
ported, port these two tools with it: the same mechanism over Bubbles' own reviews and report reads, with its store
names and scope (salon ↔ store). No company data moves between the apps.
