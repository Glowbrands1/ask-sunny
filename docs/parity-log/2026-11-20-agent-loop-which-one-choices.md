# 2026-11-20 — agent loop: the which-one choices tell themselves apart

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds: every which-one list (find_past_forms,
and the card-on-screen "Which one: the <card> on screen, or …" question) names each form on file by a choice line built
by code from its record: form · status · date · salon (store in Bubbles), plus the created time when two listed forms
share the form and date (`formChoices` in tools.ts). The rules book has the reply list those lines as given. Port with
the loop.
