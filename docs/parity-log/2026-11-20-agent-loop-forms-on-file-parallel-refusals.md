# 2026-11-20 — agent loop: a plain ask for forms on file is never stopped by the retry guard

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Pau's live chat (20 Nov 2026, 14:23Z): find_past_forms
calls with no forms_on_file_evidence, two of them in one model step, tripped the retry guard, so the call with evidence
never ran and the reply blamed "a lookup issue". The loop now: counts refusals in the same model step once; requires
forms_on_file_evidence in find_past_forms' schema; names this turn's message id in the privacy refusal; keeps a form for
"<first name> <start of last name>" ("<P> co"), first word whole (item 27's rule holds); and its rules book never lets a
refusal be told as a lookup problem or "try again". Port with the loop.
