# 2026-11-16 — agent loop: a change the draft already holds is said so

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds: when edit_form's requested value equals
what the draft already holds (any field: the date, the warning level, payroll deduct, the payroll amount), the result
reports it as `already_set {field, value}`, never as `unchanged`, and the reply says "The date on the draft is already
<value>", with no "didn't update" and no re-ask (tools.ts, edit_form's direct-values path). Port with the loop.
