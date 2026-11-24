# 2026-11-20 — leaving early is not lateness; the write-up never invents a telling (f082)

**Telling guard ported to Ask Bubbles** in Glowbrands1/Ask-bubbles#979 (`a995ddf`): the same narrative guard
(`narrative-draft.ts`, `GROUNDED_SPECIFICS`) drops a drafted sentence asserting the employee was told / informed /
reminded / warned unless the manager's notes describe a telling. **The left_early attendance kind stays Sunny-only for
now**: it is the agent loop card's `attendanceKind` (with #1137's absence), and Bubbles has no agent loop. Port it with the
loop.
