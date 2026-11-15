# 2026-11-16 — agent loop: "final warning" ticks no level (fix batch item 2)

**Stays Sunny-only for now: Ask Bubbles has no agent loop yet.** In the loop (behind AGENT_LOOP_ENABLED +
AGENT_LOOP_USERS), a warning level is kept only when the manager's quoted level_evidence names that option of the
Corrective Action Form's Type of Warning (verbal, written). A bare "final warning" ticks nothing (`level_not_stated`,
`level_not_in_evidence`) and the reply asks "Which is it: Verbal Warning, Written Warning or Termination?" (Pau's
ruling, 16 Nov 2026); "final written" still ticks Written. When the loop is ported, check Ask Bubbles' own form options
before taking the option words, and take the replay case `nov16-fix-batch-final-warning-cases.ts` with invented people.
