# 2026-11-20 — agent loop: read_form keeps every field's status on a long write-up

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds: read_form lists every filled field, in
the template's order; when the values run past the limit, only the longest texts are cut (`fitToLimit`, each keeps at
least 200 characters and says how much more is on the form) and truncated_fields names them. empty_fields lists only
fields that really are empty. Port with the loop.
