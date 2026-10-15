# Additional locations on invitations

Administrators can invite someone with a primary area **and** any number of
additional locations, and edit those locations later. Woven can suggest the
values; an administrator reviews and applies them.

## Schema changes

**None.** `app_users.scope_also_covers_area_ids text[]` already existed, is read
into every session by `toAppUserProfile`, and is written by `inviteUser` /
`patchUser`. The invitation form simply sent `[]`. Locations are stored by
**stable id** (`loc-0306`), never by name.

## Authorization

| Scope | Reach |
| --- | --- |
| One salon | primary + each explicitly assigned salon |
| District / region | the area (resolved from reporting, as before) **+ each explicitly assigned salon** |
| Global | everything (unchanged; additional locations are cleared, not stored) |

Fix made: an extra salon id on a **district/region** scope used to be read as an
area id, match nothing, and be silently ignored. It now grants exactly that salon
(`authorized-salons.ts`, and the data-backed `resolveScopeFor` in
`scope/server.ts`). It never widens to an area. If the reporting area query
fails the *areas* still fail closed; a salon someone was explicitly assigned
does not depend on it.

Saved-assignment rules (`normalizeScope`, server side — the form is not a
boundary): de-duplicated, the primary removed, cleared for global, capped at 60,
and every id must be a rostered salon (or, on a district/region scope, a known
area of that kind). Unknown ids are **refused**, not stored.

## Persistence / acceptance / login

The profile row is created at invite time (status `invited`) with scope and
locations. `accept_invitation()` updates **status only** (role, scope and email
are not in its UPDATE), so assignments persist through acceptance and appear on
first login. Editing later: **Edit locations** in the Team list sends the
account's current level and primary unchanged with the new list (audited as
`scope_changed`).

## Woven syncs do not erase manual assignments

Verified in code and tests: the planner never emits a change to
`scope_also_covers_area_ids` (only `CREATE_USER` writes it, as `[]`), and the
apply engine refuses `UPDATE_PRIMARY_LOCATION` / `UPDATE_ROLE`. Hand-granted
extras are only ever *flagged* (`extra_salons_not_granted_by_woven`).

## Woven suggestions (priority 2)

**Investigation.** The synced directory provides: email, name, position (with a
person-confirmed role/scope mapping), primary location and `additional` /
`temporary_or_expiring` affiliations, each by Woven location id, with a
person-reviewed Woven-location → salon map.

**Implemented** (`GET /api/admin/employees/woven/invite-suggestion?email=`,
`invite-suggestion.ts`). Requires `manage_users` **and** `manage_integrations`.
Entering a matching work email shows what Woven knows; nothing is filled until
the administrator clicks **Apply suggestions**, and every field stays editable.

Safety rules: only from *confirmed* mappings; admin/owner/developer are never
suggested; global is never suggested; a mapping can narrow a role's reach but
never widen it; nothing for terminated/unread employees; duplicate Woven emails
suggest nothing; additional locations resolve via the reviewed map by Woven id
(never name, never Woven's raw location number); unmapped locations are named in
a note rather than guessed; temporary/expiring access is never suggested.

## Limitations

- **District/region primary is not suggested.** Woven names a salon, not the
  district/region (those are reporting labels), so the administrator chooses.
- **Roster is the 15 production salons** (`src/data/salons.ts`). A salon not on
  it cannot be assigned until it is added. (The brief's example locations
  — Independence, Lee's Summit — are not on the roster.)
- **Forms for district/region accounts** are still refused
  (`forms/location-scope.ts` fails closed by design); explicit extras do not
  change that. Salon-scoped accounts with extras already work there.
- Woven additional-location data is only as good as the location map: unmapped
  locations are reported, not assigned. This also needs live validation against
  real Woven data; no live Woven/Supabase was available in this environment.
- Local-stack (real Postgres/RLS) suites were **not run** here.
