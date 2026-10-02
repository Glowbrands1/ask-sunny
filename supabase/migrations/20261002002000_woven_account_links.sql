-- ============================================================================
-- WOVEN → ASK SUNNY ACCESS: the identity link, and a record of planned actions
-- ============================================================================
--
-- STAGE 1 OF THE ACCESS SYNC. This migration lets Ask Sunny SAY, durably and
-- explicitly, which Woven employee each account belongs to (or that it belongs
-- to none), and record what an access sync WOULD do. It changes no access:
--
--   * no app_users row is inserted, updated or deleted;
--   * no auth.users row is touched;
--   * no role, status, scope or salon assignment changes;
--   * the only function that writes records SHADOW runs and refuses any other
--     mode — there is no apply path in this migration.
--
-- THE LINK (`employee_account_links`) — one row per Ask Sunny account:
--
--   woven_linked        this account IS that Woven EmployeeID. After linking,
--                       the EmployeeID is authoritative; email is never used
--                       to re-match. Three per-field flags say what Woven may
--                       later manage: status (termination), primary location,
--                       role. All default OFF.
--   not_woven_managed   this account is NOT a Woven employee (an admin, a
--                       test account, a vendor). Absence from Woven means
--                       nothing for it, and no Woven action ever touches it.
--
-- An account with NO row is unclassified: the planner only proposes a link
-- for it (FLAG_LINK_REVIEW) and never acts on it.
--
-- BACKFILL (deterministic, at apply time):
--   1. Every protected override (`employee_role_overrides`) that names a Woven
--      EmployeeID becomes `woven_linked`, with ALL THREE managed flags OFF —
--      protected accounts are never managed by Woven.
--   2. Every account that has no override and whose email matches NO Woven
--      employee becomes `not_woven_managed` (owner decision, 2 Oct 2026:
--      "existing accounts with no Woven match are NOT MANAGED BY WOVEN").
--   Accounts with exactly one email match are left unclassified, for a person
--   to confirm the link (stage 2). Nothing is linked by email automatically.
--
-- Every table: RLS enabled and forced, no policies, revoked from the browser
-- roles. Every function and view: revoked from public, anon, authenticated.
--
-- Applied only with approval, verbatim, in one transaction. Idempotent.

-- ------------------------------------------------------------- the link ---

create table if not exists public.employee_account_links (
  app_user_id           uuid primary key references public.app_users (id) on delete restrict,
  management            text not null check (management in ('woven_linked', 'not_woven_managed')),
  source_system         text not null default 'woven' check (source_system = 'woven'),
  external_employee_id  text check (external_employee_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  link_method           text not null check (link_method in (
                          'override_backfill',      -- from employee_role_overrides
                          'unmatched_backfill',     -- no Woven email match at migration time
                          'admin_confirmed_email',  -- a person confirmed a single exact email match
                          'admin_manual',           -- a person linked or classified it by hand
                          'provisioned'             -- created from Woven (a later, approved stage)
                        )),
  managed_status        boolean not null default false,
  managed_location      boolean not null default false,
  managed_role          boolean not null default false,
  provisioned_by_source text check (provisioned_by_source in ('woven')),
  first_provisioned_at  timestamptz,
  last_synced_at        timestamptz,
  terminated_at         timestamptz,
  access_revoked_at     timestamptz,
  revoked_woven_status  text check (revoked_woven_status in ('terminated')),
  reactivated_at        timestamptz,
  reason                text check (reason is null or (length(btrim(reason)) between 1 and 300)),
  set_by                text not null check (length(btrim(set_by)) between 1 and 120),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint employee_account_links_linked_names_employee
    check ((management = 'woven_linked') = (external_employee_id is not null)),
  constraint employee_account_links_unmanaged_manages_nothing
    check (management = 'woven_linked' or not (managed_status or managed_location or managed_role)),
  constraint employee_account_links_revocation_has_reason
    check (access_revoked_at is null or revoked_woven_status is not null)
);

/* One account per Woven employee: an EmployeeID is never linked twice. */
create unique index if not exists employee_account_links_one_account_per_employee
  on public.employee_account_links (source_system, external_employee_id)
  where external_employee_id is not null;

comment on table public.employee_account_links is
  'One row per Ask Sunny account: woven_linked (this account IS that Woven EmployeeID; the id is authoritative after linking) or not_woven_managed (never touched by a Woven action). The managed_* flags say what Woven may manage; all default off. No row = unclassified (only a link is ever proposed). Read by the access planner; never written by the directory sync.';

drop trigger if exists employee_account_links_touch_updated_at on public.employee_account_links;
create trigger employee_account_links_touch_updated_at
  before update on public.employee_account_links
  for each row execute function public.touch_updated_at();

alter table public.employee_account_links enable row level security;
alter table public.employee_account_links force row level security;
revoke all on public.employee_account_links from public, anon, authenticated;

-- ------------------------------------------------ planned-action record ---

create table if not exists public.employee_access_runs (
  id                 uuid primary key default extensions.gen_random_uuid(),
  mode               text not null check (mode in ('shadow')),
  requested_by       text not null check (length(btrim(requested_by)) between 1 and 120),
  directory_run_id   uuid references public.employee_sync_runs (id) on delete set null,
  policy_version     text not null check (policy_version ~ '^[a-z0-9._-]{1,40}$'),
  status             text not null check (status in ('completed', 'aborted')),
  guard_codes        text[] not null default '{}',
  counts             jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  created_at         timestamptz not null default now(),
  constraint employee_access_runs_aborted_names_a_guard
    check ((status = 'aborted') = (cardinality(guard_codes) > 0))
);

create index if not exists employee_access_runs_recent on public.employee_access_runs (created_at desc);

comment on table public.employee_access_runs is
  'One row per recorded access-planning run. Mode is SHADOW only: actions are calculated and recorded, never applied. An aborted run names the mass-change guards that tripped.';

create table if not exists public.employee_access_actions (
  id                    uuid primary key default extensions.gen_random_uuid(),
  access_run_id         uuid not null references public.employee_access_runs (id) on delete restrict,
  external_employee_id  text check (external_employee_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  app_user_id           uuid,
  action                text not null check (action in (
                          'NO_CHANGE', 'CREATE_USER', 'UPDATE_PRIMARY_LOCATION', 'UPDATE_ROLE', 'DISABLE_TERMINATED',
                          'FLAG_LINK_REVIEW', 'FLAG_DUPLICATE_EMAIL', 'FLAG_MISSING_EMAIL', 'FLAG_UNMAPPED_POSITION',
                          'FLAG_UNMAPPED_LOCATION', 'FLAG_UNKNOWN_STATUS', 'FLAG_REHIRE_REVIEW', 'FLAG_NOT_WOVEN_MANAGED',
                          'FLAG_EMAIL_CHANGE_REVIEW', 'FLAG_MISSING_FROM_WOVEN', 'FLAG_ROLE_REVIEW', 'FLAG_LOCATION_REVIEW',
                          'FLAG_PROTECTED_ACCOUNT', 'FLAG_LINKED_EMPLOYEE_NOT_FOUND', 'FLAG_STATUS_CONFLICT'
                        )),
  is_primary            boolean not null,
  reason_codes          text[] not null default '{}',
  before_values         jsonb,
  after_values          jsonb,
  woven_source_at       timestamptz,
  result                text not null check (result in ('shadow')),
  processed_at          timestamptz not null default now(),
  constraint employee_access_actions_names_someone
    check (external_employee_id is not null or app_user_id is not null)
);

create index if not exists employee_access_actions_by_run on public.employee_access_actions (access_run_id, action);

comment on table public.employee_access_actions is
  'Append-only. What an access-planning run decided for each employee or account, with before/after values and reasons. result = shadow: recorded, NOT applied.';

create or replace function public.employee_access_actions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'employee_access_actions is append-only'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists employee_access_actions_append_only on public.employee_access_actions;
create trigger employee_access_actions_append_only
  before update or delete on public.employee_access_actions
  for each row execute function public.employee_access_actions_guard();

drop trigger if exists employee_access_runs_append_only on public.employee_access_runs;
create trigger employee_access_runs_append_only
  before update or delete on public.employee_access_runs
  for each row execute function public.employee_access_actions_guard();

alter table public.employee_access_runs enable row level security;
alter table public.employee_access_runs force row level security;
alter table public.employee_access_actions enable row level security;
alter table public.employee_access_actions force row level security;
revoke all on public.employee_access_runs from public, anon, authenticated;
revoke all on public.employee_access_actions from public, anon, authenticated;

-- --------------------------------------------------- the planner's read ---
--
-- The ONLY way the access planner sees accounts: a read-only view, so the
-- employee-sync code never names `app_users` (a guarantee its tests enforce).

create or replace view public.employee_access_accounts
with (security_invoker = true) as
select
  u.id                          as app_user_id,
  u.email,
  u.display_name,
  u.role,
  u.status,
  u.scope_level,
  u.scope_primary_area_id,
  u.scope_also_covers_area_ids,
  l.management,
  l.external_employee_id        as linked_external_employee_id,
  l.link_method,
  coalesce(l.managed_status, false)   as managed_status,
  coalesce(l.managed_location, false) as managed_location,
  coalesce(l.managed_role, false)     as managed_role,
  l.terminated_at,
  l.access_revoked_at,
  l.reactivated_at,
  o.external_employee_id        as override_external_employee_id,
  o.locked_role,
  o.locked_scope_level
from public.app_users u
left join public.employee_account_links l on l.app_user_id = u.id
left join public.employee_role_overrides o on o.app_user_id = u.id;

comment on view public.employee_access_accounts is
  'Read-only. Each Ask Sunny account with its Woven link (if any) and protected override (if any), for the access planner. Grants, links and changes nothing.';

revoke all on public.employee_access_accounts from public, anon, authenticated;

-- ---------------------------------------------- recording a shadow run ---

create or replace function public.employee_access_record_shadow_run(
  p_requested_by      text,
  p_directory_run_id  uuid,
  p_policy_version    text,
  p_guard_codes       text[],
  p_counts            jsonb,
  p_actions           jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_run uuid;
begin
  if jsonb_typeof(p_actions) is distinct from 'array' then
    raise exception 'employee_access_record_shadow_run: actions must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  /* One recorder at a time, so two schedules cannot interleave their runs. */
  perform pg_advisory_xact_lock(hashtext('employee_access_record_shadow_run'));

  insert into public.employee_access_runs (mode, requested_by, directory_run_id, policy_version, status, guard_codes, counts)
  values (
    'shadow', p_requested_by, p_directory_run_id, p_policy_version,
    case when cardinality(coalesce(p_guard_codes, '{}')) > 0 then 'aborted' else 'completed' end,
    coalesce(p_guard_codes, '{}'), coalesce(p_counts, '{}'::jsonb)
  )
  returning id into v_run;

  insert into public.employee_access_actions (
    access_run_id, external_employee_id, app_user_id, action, is_primary, reason_codes,
    before_values, after_values, woven_source_at, result
  )
  select
    v_run,
    a ->> 'external_employee_id',
    nullif(a ->> 'app_user_id', '')::uuid,
    a ->> 'action',
    coalesce((a ->> 'is_primary')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(a -> 'reason_codes')), '{}'),
    a -> 'before_values',
    a -> 'after_values',
    nullif(a ->> 'woven_source_at', '')::timestamptz,
    'shadow'
  from jsonb_array_elements(p_actions) as a;

  return v_run;
end;
$$;

comment on function public.employee_access_record_shadow_run(text, uuid, text, text[], jsonb, jsonb) is
  'Records one SHADOW access-planning run and its actions in one transaction. Writes only employee_access_runs and employee_access_actions; never app_users, auth or a link. There is no apply mode.';

revoke all on function public.employee_access_record_shadow_run(text, uuid, text, text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.employee_access_actions_guard() from public, anon, authenticated;

-- -------------------------------------------------------------- backfill ---

insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, set_by, reason)
select o.app_user_id, 'woven_linked', o.external_employee_id, 'override_backfill',
       'migration:20261002002000', 'Protected override: linked, never managed by Woven'
from public.employee_role_overrides o
where o.external_employee_id is not null
on conflict (app_user_id) do nothing;

insert into public.employee_account_links (app_user_id, management, link_method, set_by, reason)
select u.id, 'not_woven_managed', 'unmatched_backfill',
       'migration:20261002002000', 'No Woven employee matched this account at migration time'
from public.app_users u
where not exists (select 1 from public.employee_role_overrides o where o.app_user_id = u.id)
  and not exists (
    select 1 from public.employee_access_directory d
    where d.email_address is not null and lower(d.email_address) = lower(u.email)
  )
on conflict (app_user_id) do nothing;
