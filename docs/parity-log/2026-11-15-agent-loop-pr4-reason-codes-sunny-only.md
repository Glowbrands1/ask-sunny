## 15 Nov 2026: agent loop rebuild, PR 4 (refusals carry a reason code) — Sunny-only

Pau's audit: a refusal says why with a fixed `reason_code`; the trace's `error_kind` is that code (it was read from the error's
wording by `ERROR_KINDS`, which logged the privacy and right-person refusals as plain "refused"). Every `error:` a tool returns now
carries a code (`reason-codes.test.ts` guards it); `find_staff` carries `not_on_roster` and `ambiguous_person`; an edit on the
card on screen is `not_a_saved_form` ("That's the card on screen; it isn't created yet. Change it with propose_form."), a real
write error is `write_failed`; a refused edit on a finalized form is `finalized_revision_refused` (the revision draft is still
deleted, and a failed delete is logged and reported as `revision_cleanup: failed`); a date after today is `date_after_today`
(G11 kept). A loop turn is also logged with a real category from the tools it called (`agent-loop/turn-category.ts`: card, edit, open_form, past_forms, policy, chat → the analytics taxonomy's existing values), never from the message text; and a refused edit never deletes a revision draft that was already open before the call. The evidence-based codes (level_not_stated, payroll_not_stated, privacy_not_asked on edit_form) follow once
`evidence.ts` lands.

Sibling app (Ask Bubbles): not needed. Bubbles has no agent loop (`src/lib/ai/agent-loop/`), no tools and no trace steps.
