# App Switcher access (DJ Wade, Colene Schildt)

Link-only change: no role, permission or scope changes. The switcher is shown to
administrators (unchanged) and to a verified, active user whose own
`app_users.can_switch_apps` is true (read under RLS, fails closed, not writable
from a browser — see the migration's guard trigger).

Existing accounts (read-only check): DJ Wade is `regional_manager`, Colene
Schildt is `district_manager`, both active.

Execution order (not yet run anywhere):
1. Deploy the app code — safe first; the flag read fails closed until the column exists.
2. Apply `supabase/migrations/20261013002000_app_switcher_grant.sql` (schema only).
3. Run `supabase/ops/app-switcher-grant.sql`: grants exactly the two named,
   active, correctly-roled accounts, and raises (rolling back) otherwise.

The Ask Bubbles side, including direct provisioning of the two missing accounts,
is in Ask Bubbles' `docs/app-switcher-provisioning.md`.
