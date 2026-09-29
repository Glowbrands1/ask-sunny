-- ---------------------------------------------------------------------------
-- WOVEN EMPLOYEE SYNC — protected role overrides, and the directory's change label
--
-- WHAT THIS ADDS, and nothing else:
--
--   employee_role_overrides   one row per PROTECTED Ask Sunny account: the role
--                             and scope level that account keeps whatever its
--                             Woven position says. A person sets each row.
--
--   employee_access_preview   re-created with the same columns in the same
--                             order, plus role_override, effective_role,
--                             effective_scope_level and role_source at the end.
--                             The resolution order is
--                               protected override → confirmed position → none,
--                             and role_differs / primary_salon_differs now read
--                             the effective role, so a protected admin is never
--                             reported as "should be" a lower role.
--
--   employee_directory_view   re-created with the same columns in the same
--                             order, plus last_change_classification at the end,
--                             so the directory can say "Initial import" for the
--                             first load's new_employee events.
--
-- WHAT THIS DOES NOT CHANGE: `app_users`, `auth`, any role, scope, policy or
-- grant outside these objects. The override table REFERENCES app_users (so an
-- override cannot outlive its account) but adds nothing to it — no column, no
-- trigger, no policy. Phase one still has no code path that writes a role; an
-- override is the rule a later, approved role-application step must obey, and
-- the preview already obeys it.
--
-- ACCESS: RLS enabled and forced with no policies, and every privilege revoked
-- from anon and authenticated; the views stay security_invoker and revoked from
-- public, anon and authenticated. Server-only, like the rest of the sync.
-- ---------------------------------------------------------------------------

create table if not exists public.employee_role_overrides (
  /* The Ask Sunny account. Keyed on the id, never an email: some accounts' app_users.email is not their sign-in email. */
  app_user_id uuid primary key references public.app_users (id) on delete cascade,

  /*
   * The Woven employee this account is, when known — verified by a person
   * (the account's sign-in email equals Woven's EmailAddress). This is how the
   * preview finds the account for a directory row whose email does not match
   * app_users.email.
   */
  external_employee_id text unique
    check (external_employee_id is null or external_employee_id ~ '^[A-Za-z0-9._:-]{1,64}$'),

  locked_role        public.app_user_role not null,
  locked_scope_level public.app_scope_level not null,

  reason text not null check (length(btrim(reason)) between 1 and 300),
  set_by text not null check (length(btrim(set_by)) between 1 and 120),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists employee_role_overrides_touch_updated_at on public.employee_role_overrides;
create trigger employee_role_overrides_touch_updated_at
  before update on public.employee_role_overrides
  for each row execute function public.touch_updated_at();

alter table public.employee_role_overrides enable row level security;
alter table public.employee_role_overrides force row level security;
revoke all on table public.employee_role_overrides from anon, authenticated;

comment on table public.employee_role_overrides is
  'Protected Ask Sunny accounts: the role and scope level each keeps regardless of its Woven position. Wins over the position map in every resolution (employee_access_preview.effective_role). Set by a person; the sync never writes it. Changes no app_users row by itself.';

-- --------------------------------------------------------- access preview ---

create or replace view public.employee_access_preview
with (security_invoker = true) as
select
  d.id as employee_id,
  d.external_employee_id,
  d.employment_status,
  d.email_address,
  ('duplicate_email' = any (d.data_issues)) as email_is_duplicated,
  d.position_id,
  pm.status               as position_mapping_status,
  coalesce(pm.is_confirmed, false) as position_mapping_confirmed,
  pm.ask_sunny_role       as mapped_role,
  pm.ask_sunny_scope_level as mapped_scope_level,
  d.primary_woven_location_id,
  s.salon_number          as mapped_primary_salon_number,
  u.id                    as app_user_id,
  u.role                  as app_user_role,
  u.status                as app_user_status,
  u.scope_level           as app_user_scope_level,
  u.scope_primary_area_id as app_user_scope_primary_area_id,
  /* Phase 2 question: no login yet, and everything a provisioning rule would need is confirmed. */
  (u.id is null
     and d.employment_status = 'active'
     and d.email_address is not null
     and not ('duplicate_email' = any (d.data_issues))
     and coalesce(pm.is_confirmed, false)
     and s.salon_number is not null) as would_provision_candidate,
  /* Phase 3 question: Woven says terminated, the Ask Sunny login is not disabled. */
  (u.id is not null and d.employment_status = 'terminated' and u.status <> 'disabled') as would_deactivate_candidate,
  /* Phase 4 question: the EFFECTIVE role (override first) differs from the account's role. */
  (u.id is not null
     and coalesce(ov.locked_role, case when coalesce(pm.is_confirmed, false) then pm.ask_sunny_role end) is not null
     and u.role is distinct from coalesce(ov.locked_role, case when coalesce(pm.is_confirmed, false) then pm.ask_sunny_role end)) as role_differs,
  /* Phase 5 question: a salon-scoped login whose salon differs from Woven's mapped primary. A protected account's scope is its override's. */
  (u.id is not null and ov.app_user_id is null and u.scope_level = 'salon' and s.salon_number is not null
     and u.scope_primary_area_id is distinct from ('loc-' || s.salon_number)) as primary_salon_differs,
  /* ---- added by 20260930000100: the resolution, stated ---- */
  ov.locked_role as role_override,
  coalesce(ov.locked_role, case when coalesce(pm.is_confirmed, false) then pm.ask_sunny_role end) as effective_role,
  coalesce(ov.locked_scope_level, case when coalesce(pm.is_confirmed, false) then pm.ask_sunny_scope_level end) as effective_scope_level,
  case
    when ov.app_user_id is not null then 'override'
    when coalesce(pm.is_confirmed, false) then 'position'
    else 'none'
  end as role_source
from public.employee_access_directory d
left join public.woven_position_map pm on pm.woven_position_id = d.position_id
left join public.woven_location_map lm on lm.woven_location_id = d.primary_woven_location_id and lm.status = 'mapped'
left join public.salons s on s.id = lm.salon_id
left join public.employee_role_overrides ov on ov.external_employee_id = d.external_employee_id
left join public.app_users u
  on (ov.app_user_id is not null and u.id = ov.app_user_id)
  or (ov.app_user_id is null and d.email_address is not null and lower(u.email) = lower(d.email_address));

-- ------------------------------------------------------- directory view ---

create or replace view public.employee_directory_view
with (security_invoker = true) as
select
  d.id, d.external_employee_id, d.employee_login_id, d.external_hris_id,
  d.first_name, d.last_name, d.preferred_first_name, d.email_address,
  d.employment_status, d.employment_status_code,
  d.hire_date, d.start_date, d.termination_date, d.termination_last_day_worked, d.termination_type_code,
  d.position_id, d.position_name,
  pm.status        as position_mapping_status,
  pm.is_confirmed  as position_mapping_confirmed,
  d.primary_woven_location_id, d.primary_location_name,
  lm.status        as primary_location_mapping_status,
  ps.salon_number  as primary_salon_number,
  aff.additional_locations,
  aff.temporary_or_expiring_locations,
  coalesce(aff.active_location_count, 0) as active_location_count,
  coalesce(aff.has_unmapped_location, d.primary_woven_location_id is not null) as has_unmapped_location,
  d.has_multiple_location_access, d.has_all_location_access, d.woven_login_allowed,
  d.woven_location_ids, d.affiliations_verified_at, d.data_issues,
  d.first_seen_at, d.last_seen_at, d.last_synced_at, d.missing_sync_count,
  lc.change_kind  as last_change_kind,
  lc.detected_at  as last_change_at,
  coalesce(rc.kinds, '{}') as changes_last_30_days,
  /* ---- added by 20260930000100 ---- */
  lc.classification as last_change_classification
from public.employee_access_directory d
left join public.woven_position_map pm on pm.woven_position_id = d.position_id
left join public.woven_location_map lm on lm.woven_location_id = d.primary_woven_location_id
left join public.salons ps on ps.id = lm.salon_id
left join lateral (
  select
    jsonb_agg(jsonb_build_object('wovenLocationId', a.woven_location_id, 'name', a.location_name, 'number', a.location_number))
      filter (where a.access_type = 'additional') as additional_locations,
    jsonb_agg(jsonb_build_object('wovenLocationId', a.woven_location_id, 'name', a.location_name, 'number', a.location_number, 'expiresOn', a.expires_on))
      filter (where a.access_type = 'temporary_or_expiring_access') as temporary_or_expiring_locations,
    count(*) as active_location_count,
    bool_or(m.status is distinct from 'mapped' and m.status is distinct from 'ignored') as has_unmapped_location
  from public.employee_location_affiliations a
  left join public.woven_location_map m on m.woven_location_id = a.woven_location_id
  where a.employee_id = d.id and a.active
) aff on true
left join lateral (
  select c.change_kind, c.detected_at, c.classification from public.employee_directory_changes c
   where c.employee_id = d.id order by c.detected_at desc limit 1
) lc on true
left join lateral (
  select array_agg(distinct
           case when c.change_kind = 'new_employee' and c.classification = 'new_hire' then 'new_hire'
                else c.change_kind::text end) as kinds
    from public.employee_directory_changes c
   where c.employee_id = d.id and c.detected_at > now() - interval '30 days'
) rc on true;

revoke all on public.employee_access_preview from public, anon, authenticated;
revoke all on public.employee_directory_view from public, anon, authenticated;

comment on view public.employee_access_preview is
  'What provisioning, deactivation, role and salon-scope phases WOULD do, as questions. effective_role resolves protected override → confirmed position → none; role_source says which. Read-only; nothing acts on it in phase one.';
comment on view public.employee_directory_view is
  'The employee directory with affiliations, mapping state and recent changes; last_change_classification lets the screen say "Initial import". Contains names and emails: server-only, shown behind manage_users.';
