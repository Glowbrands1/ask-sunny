# 2026-11-20 — agent loop: payroll is on every form whose template asks it

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds (propose_form in tools.ts): payroll is
kept on the card, on the same evidence, for every form whose own template document has a payroll field (the Corrective
Action's payroll deduct, the exit form's "Is Payroll Deduction applicable?"), so the reply never says the exit form has
no payroll question; the warning level stays Corrective Action only. Port with the loop.
