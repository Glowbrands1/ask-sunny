# 2026-11-20 — agent loop: the form is locked to the open card

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds (`lockedForm`, propose_form in tools.ts):
once a card for form X is on screen for a person (the last reply's card record, or the draft open on screen), propose_form
refuses another template for that person (`form_locked`) unless this turn's own words ask: new_form_evidence (another
form), form_change_evidence (this card made a different form, the same request), or exit_evidence for the exit form.
Port with the loop.
