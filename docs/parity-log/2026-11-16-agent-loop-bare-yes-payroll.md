# 2026-11-16 — agent loop: a bare "yes" is no payroll answer to two questions (fix batch item 7)

**Stays Sunny-only for now: Ask Bubbles has no agent loop yet.** In the loop (behind AGENT_LOOP_ENABLED +
AGENT_LOOP_USERS), the card record now keeps which CA-only fields the card asked about (`asked`). After "Payroll deduct
and warning level aren't set; tell me if they apply.", a one-word message passed whole as the payroll evidence sets
nothing (`payroll_not_stated`, `answer_to_two_questions`) and the reply asks payroll alone. When the loop is ported,
take the mechanism (the record's `asked`, the one-word format check) and the replay case
`nov16-fix-batch-bare-yes-payroll-cases.ts`, swapping the invented people and the salon/store wording.
