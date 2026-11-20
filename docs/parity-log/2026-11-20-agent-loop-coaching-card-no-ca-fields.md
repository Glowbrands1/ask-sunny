# 2026-11-20 — agent loop: a coaching card never mentions payroll deduct or a warning level

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds (propose_form's card result, tools.ts):
the Corrective-Action-only fields (warning_level, payroll_deduct, payroll_amount) are on a Corrective Action card's
result only; on a Coaching card they came back null and the model said "Payroll deduct and warning level aren't set".
Port with the loop.
