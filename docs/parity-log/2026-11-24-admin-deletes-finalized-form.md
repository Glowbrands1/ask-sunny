# Administrators may delete a finalized form (ported from Ask Bubbles)

**Date:** 24 Nov 2026. **Status:** ported (Ask Bubbles PR 1142, `73230ff`).

Pau, on Ask Bubbles' Forms Register: "why cant delete? in bubbles". A finalized
Corrective Action had no "…" menu because only drafts could be deleted. Pau chose
that administrators (admin, owner, developer) can delete a finalized form, then
asked for the same here.

Same three changes, name mapping Forms Register ↔ Form Monitoring:

- `deleteInstance(id, by, { allowFinalized })`: a draft as before; a `finalized`
  form only with the option; a `revised` form never. Deleting a finalized
  revision puts the earlier version back to `finalized`.
- `DELETE /api/forms/instances/{id}` passes the option for `ADMIN_CONSOLE_ROLES`
  only; every other role still gets the 409.
- Form Monitoring offers Delete on a finalized form to those roles, with a warning
  in the confirmation. Bulk delete, the demo sweep, the chat and the agent loop
  still delete drafts only.

The deletion record is unchanged and covers a finalized form too: replay case
`nov24-agent-loop-admin-asks-who-deleted-the-finalized-form` asks `read_form_deletions`.
Test names are invented (Garnet Fairbrook).
