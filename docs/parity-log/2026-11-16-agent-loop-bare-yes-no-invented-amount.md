# 2026-11-16 — agent loop: a bare "yes" to a two-question card invents no payroll amount

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds: (1) the rules book and tool
descriptions give a placeholder amount ("$<amount>"), never a figure the model can copy; (2) the self-review fallback
never echoes a value the manager did not type in the chat; it asks that field's question instead ("Is payroll deduct
applicable, and how much?"); (3) a one-word answer quoted whole while the card asks payroll and level answers neither,
and the reply asks which it answers and, for payroll, the amount (`levelAnswerUnclear` / `payrollAnswerUnclear` in
tools.ts). Port with the loop.
