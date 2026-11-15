# Agent loop batch J, kept items (15 Nov 2026)

QA's salvage of batch J (#1018, closed) after the agent-loop rebuild decision
(`docs/agent-loop/rebuild-plan.md`). This PR keeps J5 (Late Opening refusal),
J8 (hand-back cache), J9 (short tool inputs), J10 (`first_token_ms`), the
`isoDate` leading-year fix (every format: `2026/12/20`, `T09`, `9am`,
`at 9:00`), the amount-unknown reader after "but"/comma/semicolon and the
payroll-clause fix on today's path. J1's cardClaims extensions, J2, J3's
readers, J4 and J7 are dropped; the rebuild redoes them as evidence args.

**Ask Bubbles:**
- The amount reader is ported in Ask Bubbles #930.
- The payroll-answer case is in Bubbles #931.
- The agent-loop items (J5, J8, J9, J10, `isoDate`) are loop-only. Ask Bubbles has no agent loop yet. They go over with the loop's port, not separately.
