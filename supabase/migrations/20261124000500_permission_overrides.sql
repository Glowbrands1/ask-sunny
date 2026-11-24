-- ---------------------------------------------------------------------------
-- PERMISSIONS MATRIX, SAVED (Pau, 23 Nov 2026): administrators tick and untick
-- what each role can do on the Permissions screen, and the server enforces it.
--
-- ONE ROW PER ROLE THAT HAS BEEN CHANGED. A role with no row uses the app's
-- built-in defaults (`DEFAULT_PERMISSION_MATRIX`), so an empty table changes
-- nothing. `permissions` is that role's WHOLE list once it has a row.
--
-- WHAT IS NEVER STORED OR ENFORCED FROM HERE, however a row is written: the
-- administrator roles (always full access) and the locked cells
-- (manage_users, manage_integrations, view_l10_meetings and the admin-only
-- reports). `src/lib/permissions` drops them when it merges, so a bad row
-- cannot lock the administrators out or widen an admin-only screen.
--
-- ADDITIVE ONLY. Two new tables; nothing existing is read, rewritten or dropped.
--
-- RLS IS ENABLED WITH NO POLICIES: a browser client reads zero rows through
-- PostgREST however it signed in. Every read and write runs on the server under
-- the secret key (`src/lib/permissions/store.ts`), after the admin check.
-- ---------------------------------------------------------------------------

create table public.permission_overrides (
  role text primary key,
  permissions text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- One row per ticked or unticked cell, so "who gave Salon Directors X, and when"
-- has an answer.
create table public.permission_override_audit (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  changed_by text not null default '',
  role text not null,
  permission text not null,
  granted boolean not null
);

create index permission_override_audit_changed_at_idx
  on public.permission_override_audit (changed_at desc);

alter table public.permission_overrides enable row level security;
alter table public.permission_overrides force row level security;
alter table public.permission_override_audit enable row level security;
alter table public.permission_override_audit force row level security;

revoke all on public.permission_overrides, public.permission_override_audit from anon, authenticated;
grant all on public.permission_overrides, public.permission_override_audit to service_role;
