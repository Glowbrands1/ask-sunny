# 2026-11-20 — the exit form's payroll question: ticked, reason in Additional Details

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds: an exit card with the payroll question
unanswered says so (`unset` payroll_deduct, as the Corrective Action's card); on a form whose payroll question has no
amount line the amount is `not_on_this_form` and the card says `payroll_question_only`; Create writes the loop exit card's
account in Additional Details as the manager's statement. The rules book says never to call a field missing unless
propose_form says not_on_this_form. Port with the loop.
