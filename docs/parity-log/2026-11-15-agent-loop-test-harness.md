# 2026-11-15 — agent loop test harness (PR 7)

**Stays Sunny-only for now.** The phrasing table (`src/lib/ai/agent-loop/phrasing-table.ts`), the switch-off case and
the uncreated-card cases test the agent loop, which is not in Ask Bubbles yet (it is behind AGENT_LOOP_ENABLED here
and under rebuild). When the loop is ported, take these files with it, swapping Sunny's invented people and the
salon/store wording; the mechanism (same structured tool args, same outcome for every phrasing; the route never enters
the loop when it is off) is the same. The missing sf-s cases (s1–s3, s5–s10, s30–s33) are skipped for now (QA, 15 Nov 2026).
