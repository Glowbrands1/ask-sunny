-- ============================================================================
-- WOVEN → ASK SUNNY ACCOUNT LIFECYCLE: create + invite, link, revoke on Terminated
-- ============================================================================
--
-- STAGE 5 OF THE ACCESS SYNC, and deliberately narrow. Three things only:
--
--   CREATE_USER         an Active, approved-position (Salon Director /
--                       Assistant Salon Director) Woven employee with no
--                       account gets one: invited, linked to their Woven
--                       EmployeeID, status managed by Woven. Supabase Auth
--                       emails them an invitation; they choose their own
--                       password. No password exists anywhere in this file.
--   LINK_EXISTING       exactly one Woven employee and exactly one
--                       unprotected, unclassified account share an exact
--                       (case-insensitive) email: the EmployeeID link is
--                       stored, once. Nothing about the account changes.
--   DISABLE_TERMINATED  Woven's own Terminated status, read in the latest
--                       run, on a linked account whose status Woven manages:
--                       app_users.status = disabled, the link records the
--                       termination. (The Supabase Auth ban and session
--                       revocation are the server's half — src/lib/auth/
--                       revocation.ts — and are recorded here afterwards.)
--
-- NOT HERE, ON PURPOSE: role changes, salon moves, district/region scope,
-- re-enabling a rehire. `managed_role` and `managed_location` are never set
-- true by anything in this file, and no function below writes a role, a
-- scope or a salon to an EXISTING account.
--
-- WHAT EVERY FUNCTION BELOW RE-CHECKS, INSIDE ITS OWN TRANSACTION
--
--   The server plans from the database and then calls these. Between the two
--   a person may act or a sync may land, so each function re-verifies the
--   facts it depends on (the link, the Woven status read in the latest run,
--   the approved position, the email) under row locks and refuses with a
--   named error otherwise. A refusal changes nothing.
--
-- NOTHING IS DELETED. No function deletes a user, a profile, a link or a
-- record. `auth.users` is read only (to tie an auth user to the EmployeeID it
-- was created for) and never written.
--
-- PRIVILEGES: still no UPDATE, DELETE or TRUNCATE on any table for anyone but
-- the owner. Every write goes through a SECURITY DEFINER function with an
-- empty search_path, executable by service_role only.
--
-- ORDER: after 20261006001000_woven_adoption_and_credentials.sql, whose audit
-- actions this keeps and whose link-update guard this widens to the lifecycle
-- columns only (section 1b).
--
-- Applied only with approval, verbatim, in one transaction. Idempotent.

-- --------------------------------------------- 1. the link: invites, method ---

alter table public.employee_account_links
  add column if not exists invite_delivery_status text,
  add column if not exists invite_sent_at          timestamptz,
  add column if not exists invite_accepted_at      timestamptz,
  add column if not exists invite_error            text,
  add column if not exists invite_attempts         integer not null default 0,
  add column if not exists last_invite_attempt_at  timestamptz;

alter table public.employee_account_links drop constraint if exists employee_account_links_invite_delivery_status_check;
alter table public.employee_account_links add constraint employee_account_links_invite_delivery_status_check
  check (invite_delivery_status is null or invite_delivery_status in ('not_sent', 'sent', 'failed'));
alter table public.employee_account_links drop constraint if exists employee_account_links_invite_error_check;
alter table public.employee_account_links add constraint employee_account_links_invite_error_check
  check (invite_error is null or invite_error ~ '^[a-z0-9_.:-]{1,80}$');
alter table public.employee_account_links drop constraint if exists employee_account_links_invite_attempts_check;
alter table public.employee_account_links add constraint employee_account_links_invite_attempts_check
  check (invite_attempts >= 0);

/* LINK_EXISTING's method. Every earlier value stays valid. */
alter table public.employee_account_links drop constraint if exists employee_account_links_link_method_check;
alter table public.employee_account_links add constraint employee_account_links_link_method_check
  check (link_method in (
    'override_backfill', 'unmatched_backfill', 'admin_confirmed_email', 'admin_manual', 'provisioned',
    'email_discovery'   -- one exact, unambiguous email match, linked by the lifecycle sync
  ));

/*
 * 1b. THE LINK-UPDATE GUARD (20261006001000) allowed only the three managed
 * flags to change. The lifecycle also records, on the same row, what happened
 * to the account: its invitation and its termination. Those columns may now
 * change too — through this file's SECURITY DEFINER functions only, since
 * service_role's column UPDATE grant stays exactly the three flags. The link's
 * IDENTITY (account, EmployeeID, management, method, source, provenance) still
 * never changes.
 */
create or replace function public.employee_account_links_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mutable constant text[] := array[
    'managed_status', 'managed_location', 'managed_role', 'updated_at',
    'invite_delivery_status', 'invite_sent_at', 'invite_accepted_at', 'invite_error', 'invite_attempts', 'last_invite_attempt_at',
    'terminated_at', 'access_revoked_at', 'revoked_woven_status', 'last_synced_at'
  ];
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'employee_account_links: only managed_status, managed_location and managed_role can change (and, through the lifecycle functions, the invitation and termination record); a link''s identity never does'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.employee_account_links_guard_update() from public, anon, authenticated, service_role;

drop trigger if exists employee_account_links_guard_update on public.employee_account_links;
create trigger employee_account_links_guard_update
  before update on public.employee_account_links
  for each row execute function public.employee_account_links_guard_update();

/* This lifecycle never manages role or location. Accounts it provisions or links carry both OFF. */
comment on column public.employee_account_links.invite_delivery_status is
  'Woven-provisioned accounts only: not_sent / sent / failed. invite_error holds a short code, never a provider message or a link.';

-- ------------------------------------- 2. the run record: apply runs too ---

alter table public.employee_access_runs add column if not exists finished_at timestamptz;

alter table public.employee_access_runs drop constraint if exists employee_access_runs_mode_check;
alter table public.employee_access_runs add constraint employee_access_runs_mode_check
  check (mode in ('shadow', 'apply'));
alter table public.employee_access_runs drop constraint if exists employee_access_runs_status_check;
alter table public.employee_access_runs add constraint employee_access_runs_status_check
  check (status in ('running', 'completed', 'aborted', 'failed'));
alter table public.employee_access_runs drop constraint if exists employee_access_runs_shadow_is_final;
alter table public.employee_access_runs add constraint employee_access_runs_shadow_is_final
  check (mode = 'apply' or status in ('completed', 'aborted'));

/* At most one apply run at a time, enforced by Postgres. */
create unique index if not exists employee_access_runs_one_running
  on public.employee_access_runs (mode) where status = 'running';

alter table public.employee_access_actions add column if not exists result_code text;
alter table public.employee_access_actions drop constraint if exists employee_access_actions_result_check;
alter table public.employee_access_actions add constraint employee_access_actions_result_check
  check (result in (
    'shadow',    -- shadow mode: calculated, recorded, not applied
    'planned',   -- apply run: not a lifecycle mutation, or that capability is off — recorded only
    'skipped',   -- apply run: a lifecycle mutation that was NOT attempted (guard, allowlist, re-check)
    'applied',   -- apply run: completed
    'failed'     -- apply run: attempted and did not complete; result_code says where
  ));
alter table public.employee_access_actions drop constraint if exists employee_access_actions_result_code_check;
alter table public.employee_access_actions add constraint employee_access_actions_result_code_check
  check (result_code is null or result_code ~ '^[a-z0-9_.:-]{1,80}$');

alter table public.employee_access_actions drop constraint if exists employee_access_actions_action_check;
alter table public.employee_access_actions add constraint employee_access_actions_action_check
  check (action in (
    'NO_CHANGE', 'CREATE_USER', 'LINK_EXISTING', 'UPDATE_PRIMARY_LOCATION', 'UPDATE_ROLE', 'DISABLE_TERMINATED',
    'FLAG_LINK_REVIEW', 'FLAG_DUPLICATE_EMAIL', 'FLAG_MISSING_EMAIL', 'FLAG_UNMAPPED_POSITION',
    'FLAG_UNMAPPED_LOCATION', 'FLAG_UNKNOWN_STATUS', 'FLAG_REHIRE_REVIEW', 'FLAG_NOT_WOVEN_MANAGED',
    'FLAG_EMAIL_CHANGE_REVIEW', 'FLAG_MISSING_FROM_WOVEN', 'FLAG_ROLE_REVIEW', 'FLAG_LOCATION_REVIEW',
    'FLAG_PROTECTED_ACCOUNT', 'FLAG_LINKED_EMPLOYEE_NOT_FOUND', 'FLAG_STATUS_CONFLICT'
  ));

/*
 * Runs are append-only EXCEPT the one transition an apply run needs: running →
 * completed / aborted / failed, written once, touching only the outcome
 * columns. Actions stay strictly append-only (the stage-1 trigger).
 */
create or replace function public.employee_access_runs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'running'
     and new.status in ('completed', 'aborted', 'failed')
     and new.id = old.id and new.mode = old.mode and new.requested_by = old.requested_by
     and new.directory_run_id is not distinct from old.directory_run_id
     and new.policy_version = old.policy_version and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'employee_access_runs is append-only'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists employee_access_runs_append_only on public.employee_access_runs;
create trigger employee_access_runs_append_only
  before update or delete on public.employee_access_runs
  for each row execute function public.employee_access_runs_guard();

revoke all on function public.employee_access_runs_guard() from public, anon, authenticated, service_role;

-- --------------------------------------------- 3. the audit vocabulary ---
--
-- ADDITIVE ONLY: every value of 20261006001000 stays. `src/test/audit-actions.ts`
-- reads the latest definition of this constraint.

alter table public.app_user_audit drop constraint if exists app_user_audit_action_check;
alter table public.app_user_audit add constraint app_user_audit_action_check
  check (action in (
    'invited',
    'invite_resent',
    'invitation_accepted',
    'reset_requested',
    'role_changed',
    'status_changed',
    'scope_changed',
    'access_revoked',
    'access_restored',
    'access_revocation_incomplete',
    'managed_flags_changed',
    'credentials_reset',
    'woven_provisioned',
    'woven_linked',
    'invite_failed'
  ));

-- ------------------------------------------- 4. the planner's read, extended ---

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
  o.locked_scope_level,
  l.invite_delivery_status,
  l.invite_sent_at,
  l.invite_accepted_at,
  l.invite_attempts,
  l.invite_error
from public.app_users u
left join public.employee_account_links l on l.app_user_id = u.id
left join public.employee_role_overrides o on o.app_user_id = u.id;

revoke all on public.employee_access_accounts from public, anon, authenticated, service_role;
grant select on public.employee_access_accounts to service_role;

-- ------------------------------------------------ 5. shared re-checks ---
--
-- The facts every mutation depends on, as one function each, so the three
-- mutations cannot disagree about them.

/* The latest FINISHED directory sync succeeded. A failed latest run means the directory is not current. */
create or replace function public.employee_access_directory_is_current()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select r.status::text = 'succeeded'
    from public.employee_sync_runs r
    where r.status::text <> 'running'
    order by r.started_at desc
    limit 1
  ), false);
$$;

/* Woven's status for one employee AS ASK SUNNY MAY ACT ON IT: only when read in the latest run, else unknown. */
create or replace function public.employee_access_observed_status(p_external_employee_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select case when d.missing_sync_count > 0 then 'unknown' else d.employment_status::text end
    from public.employee_access_directory d
    where d.source_system = 'woven' and d.external_employee_id = p_external_employee_id
  ), 'not_found');
$$;

/* Protected: a role override, or an administrative role. Never provisioned, linked by email, or disabled by Woven. */
create or replace function public.employee_access_is_protected(p_app_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.employee_role_overrides o where o.app_user_id = p_app_user_id)
      or exists (select 1 from public.app_users u where u.id = p_app_user_id and u.role::text in ('admin', 'owner', 'developer'));
$$;

-- ---------------------------------------------- 6. an apply run's record ---

create or replace function public.employee_access_begin_apply_run(
  p_requested_by     text,
  p_directory_run_id uuid,
  p_policy_version   text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
begin
  /* A run that died mid-flight (a crashed function) must not hold the lock forever. */
  update public.employee_access_runs
     set status = 'failed', finished_at = now(), guard_codes = '{}'
   where status = 'running' and created_at < now() - interval '30 minutes';

  begin
    insert into public.employee_access_runs (mode, requested_by, directory_run_id, policy_version, status)
    values ('apply', p_requested_by, p_directory_run_id, p_policy_version, 'running')
    returning id into v_run;
  exception when unique_violation then
    raise exception 'employee_access_apply_in_progress' using errcode = 'lock_not_available';
  end;
  return v_run;
end;
$$;

create or replace function public.employee_access_finish_apply_run(
  p_run         uuid,
  p_status      text,
  p_guard_codes text[],
  p_counts      jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.employee_access_runs
     set status = p_status,
         guard_codes = case when p_status = 'aborted' then coalesce(p_guard_codes, '{}') else '{}' end,
         counts = coalesce(p_counts, '{}'::jsonb),
         finished_at = now()
   where id = p_run and mode = 'apply' and status = 'running';
  if not found then
    raise exception 'employee_access_finish_apply_run: no running apply run %', p_run
      using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.employee_access_record_apply_actions(p_run uuid, p_actions jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_actions) is distinct from 'array' then
    raise exception 'employee_access_record_apply_actions: actions must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from public.employee_access_runs where id = p_run and mode = 'apply' and status = 'running';
  if not found then
    raise exception 'employee_access_record_apply_actions: no running apply run %', p_run
      using errcode = 'no_data_found';
  end if;

  insert into public.employee_access_actions (
    access_run_id, external_employee_id, app_user_id, action, is_primary, reason_codes,
    before_values, after_values, woven_source_at, result, result_code
  )
  select
    p_run,
    a ->> 'external_employee_id',
    nullif(a ->> 'app_user_id', '')::uuid,
    a ->> 'action',
    coalesce((a ->> 'is_primary')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(a -> 'reason_codes')), '{}'),
    a -> 'before_values',
    a -> 'after_values',
    nullif(a ->> 'woven_source_at', '')::timestamptz,
    a ->> 'result',
    nullif(a ->> 'result_code', '')
  from jsonb_array_elements(p_actions) as a;
  get diagnostics v_count = row_count;

  if exists (
    select 1 from public.employee_access_actions where access_run_id = p_run and result = 'shadow'
  ) then
    raise exception 'employee_access_record_apply_actions: an apply run records no shadow results'
      using errcode = 'check_violation';
  end if;
  return v_count;
end;
$$;

-- -------------------------------------- 7. which auth user is this email? ---
--
-- Read-only. Lets a retry find the auth user an earlier, interrupted attempt
-- created, and tell it apart from somebody else's credential: an auth user
-- the lifecycle created carries the EmployeeID in `app_metadata`, which only
-- the service key can write.

create or replace function public.employee_access_auth_user_by_email(p_email text)
returns table (
  id                               uuid,
  email_confirmed                  boolean,
  provisioned_external_employee_id text,
  has_profile                      boolean,
  banned                           boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    au.id,
    au.email_confirmed_at is not null,
    au.raw_app_meta_data ->> 'external_employee_id',
    exists (select 1 from public.app_users u where u.id = au.id),
    coalesce(au.banned_until > now(), false)
  from auth.users au
  where lower(au.email) = lower(btrim(p_email));
$$;

-- --------------------------------------------------- 8. CREATE_USER ---

create or replace function public.employee_access_provision_account(
  p_app_user_id         uuid,
  p_external_employee_id text,
  p_email               text,
  p_display_name        text,
  p_role                text,
  p_primary_area_id     text,
  p_set_by              text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email     text := lower(btrim(p_email));
  v_dir       record;
  v_link      record;
  v_auth      record;
  v_role      text;
  v_area      text;
begin
  if p_app_user_id is null or p_external_employee_id is null or v_email = '' then
    raise exception 'provision_invalid_input' using errcode = 'invalid_parameter_value';
  end if;
  if p_role not in ('salon_director', 'assistant_salon_director') then
    raise exception 'provision_role_not_auto_provisioned' using errcode = 'check_violation';
  end if;

  /* One provisioning per employee and per email at a time. */
  perform pg_advisory_xact_lock(hashtext('woven-provision-employee:' || p_external_employee_id));
  perform pg_advisory_xact_lock(hashtext('woven-provision-email:' || v_email));

  /* IDEMPOTENT: this exact account was already provisioned for this employee. */
  select * into v_link from public.employee_account_links where app_user_id = p_app_user_id;
  if found then
    if v_link.management = 'woven_linked' and v_link.external_employee_id = p_external_employee_id and v_link.link_method = 'provisioned' then
      return 'already_provisioned';
    end if;
    raise exception 'provision_account_already_linked' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.employee_account_links l where l.source_system = 'woven' and l.external_employee_id = p_external_employee_id) then
    raise exception 'provision_employee_already_linked' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.app_users u where u.id = p_app_user_id or lower(u.email) = v_email) then
    raise exception 'provision_account_exists' using errcode = 'unique_violation';
  end if;

  /*
   * The auth user is the one created FOR this employee (its app_metadata, which
   * only the service key can write, names the EmployeeID), for this email, and
   * nobody has used it yet (email unconfirmed). Supabase Auth stores a random,
   * never-disclosed hash for a user created without a password; the person
   * replaces it with their own when they accept the invitation.
   */
  select au.email, au.raw_app_meta_data ->> 'external_employee_id' as external_id, au.email_confirmed_at
    into v_auth
    from auth.users au where au.id = p_app_user_id;
  if not found or lower(v_auth.email) <> v_email or v_auth.external_id is distinct from p_external_employee_id then
    raise exception 'provision_auth_user_mismatch' using errcode = 'check_violation';
  end if;
  if v_auth.email_confirmed_at is not null then
    raise exception 'provision_auth_user_already_confirmed' using errcode = 'check_violation';
  end if;

  /* Woven, re-read now: Active in the latest run, unique email, no status conflict, approved position, salon. */
  if not public.employee_access_directory_is_current() then
    raise exception 'provision_directory_not_current' using errcode = 'check_violation';
  end if;
  select d.* into v_dir from public.employee_access_directory d
   where d.source_system = 'woven' and d.external_employee_id = p_external_employee_id
   for share;
  if not found then
    raise exception 'provision_employee_not_found' using errcode = 'no_data_found';
  end if;
  if public.employee_access_observed_status(p_external_employee_id) <> 'active' then
    raise exception 'provision_employee_not_active' using errcode = 'check_violation';
  end if;
  if 'status_termination_conflict' = any (v_dir.data_issues) then
    raise exception 'provision_status_conflict' using errcode = 'check_violation';
  end if;
  if lower(btrim(coalesce(v_dir.email_address, ''))) <> v_email then
    raise exception 'provision_email_mismatch' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.employee_access_directory d where lower(btrim(d.email_address)) = v_email) <> 1 then
    raise exception 'provision_duplicate_email' using errcode = 'check_violation';
  end if;

  select p.ask_sunny_role::text into v_role
    from public.woven_position_map p
   where p.woven_position_id = v_dir.position_id and p.status::text = 'mapped' and p.is_confirmed;
  if v_role is distinct from p_role then
    raise exception 'provision_position_not_approved' using errcode = 'check_violation';
  end if;

  select 'loc-' || s.salon_number into v_area
    from public.woven_location_map m
    join public.salons s on s.id = m.salon_id
   where m.woven_location_id = v_dir.primary_woven_location_id and m.status::text = 'mapped';
  if v_area is distinct from p_primary_area_id then
    raise exception 'provision_location_not_mapped' using errcode = 'check_violation';
  end if;

  insert into public.app_users (
    id, email, display_name, role, status, scope_level, scope_primary_area_id, scope_also_covers_area_ids, created_by, updated_by
  ) values (
    p_app_user_id, v_email, left(coalesce(nullif(btrim(p_display_name), ''), v_email), 120),
    p_role::public.app_user_role, 'invited', 'salon', p_primary_area_id, '{}', null, null
  );

  insert into public.employee_account_links (
    app_user_id, management, source_system, external_employee_id, link_method,
    managed_status, managed_location, managed_role,
    provisioned_by_source, first_provisioned_at, last_synced_at, invite_delivery_status, reason, set_by
  ) values (
    p_app_user_id, 'woven_linked', 'woven', p_external_employee_id, 'provisioned',
    true, false, false,
    'woven', now(), now(), 'not_sent', 'Created from Woven: approved position, Active', left(p_set_by, 120)
  );

  insert into public.app_user_audit (target_user_id, target_email, actor_user_id, actor_email, action, from_value, to_value)
  values (p_app_user_id, v_email, null, left(p_set_by, 120), 'woven_provisioned', null, p_role || ' ' || p_primary_area_id);

  return 'created';
end;
$$;

-- ------------------------------------------------- 9. LINK_EXISTING ---

create or replace function public.employee_access_link_existing(
  p_app_user_id          uuid,
  p_external_employee_id text,
  p_set_by               text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    record;
  v_dir     record;
  v_link    record;
  v_email   text;
  v_mapped  text;
  v_managed boolean;
begin
  perform pg_advisory_xact_lock(hashtext('woven-provision-employee:' || p_external_employee_id));

  select * into v_link from public.employee_account_links where app_user_id = p_app_user_id;
  if found then
    if v_link.management = 'woven_linked' and v_link.external_employee_id = p_external_employee_id then
      return 'already_linked';
    end if;
    raise exception 'link_account_already_classified' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.employee_account_links l where l.source_system = 'woven' and l.external_employee_id = p_external_employee_id) then
    raise exception 'link_employee_already_linked' using errcode = 'unique_violation';
  end if;

  select u.* into v_user from public.app_users u where u.id = p_app_user_id for update;
  if not found then
    raise exception 'link_account_not_found' using errcode = 'no_data_found';
  end if;
  if public.employee_access_is_protected(p_app_user_id) then
    raise exception 'link_protected_account' using errcode = 'check_violation';
  end if;
  if v_user.status::text = 'disabled' then
    raise exception 'link_account_disabled' using errcode = 'check_violation';
  end if;
  v_email := lower(btrim(v_user.email));

  if not public.employee_access_directory_is_current() then
    raise exception 'link_directory_not_current' using errcode = 'check_violation';
  end if;
  select d.* into v_dir from public.employee_access_directory d
   where d.source_system = 'woven' and d.external_employee_id = p_external_employee_id;
  if not found then
    raise exception 'link_employee_not_found' using errcode = 'no_data_found';
  end if;
  if public.employee_access_observed_status(p_external_employee_id) <> 'active' then
    raise exception 'link_employee_not_active' using errcode = 'check_violation';
  end if;
  if 'status_termination_conflict' = any (v_dir.data_issues) then
    raise exception 'link_status_conflict' using errcode = 'check_violation';
  end if;
  /* EXACT match only: the same address, compared case-insensitively. No fuzzy matching. */
  if lower(btrim(coalesce(v_dir.email_address, ''))) <> v_email then
    raise exception 'link_email_mismatch' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.employee_access_directory d where lower(btrim(d.email_address)) = v_email) <> 1 then
    raise exception 'link_duplicate_email' using errcode = 'check_violation';
  end if;

  /*
   * Woven manages ONLY employment status, and only for a salon-level Salon
   * Director / Assistant Salon Director whose approved Woven position is one
   * of those two. Everyone else is linked with every managed flag off.
   */
  select p.ask_sunny_role::text into v_mapped
    from public.woven_position_map p
   where p.woven_position_id = v_dir.position_id and p.status::text = 'mapped' and p.is_confirmed;
  v_managed := v_user.role::text in ('salon_director', 'assistant_salon_director')
               and v_user.scope_level::text = 'salon'
               and v_mapped in ('salon_director', 'assistant_salon_director');

  insert into public.employee_account_links (
    app_user_id, management, source_system, external_employee_id, link_method,
    managed_status, managed_location, managed_role, last_synced_at, reason, set_by
  ) values (
    p_app_user_id, 'woven_linked', 'woven', p_external_employee_id, 'email_discovery',
    v_managed, false, false, now(), 'One exact email match to one unprotected account', left(p_set_by, 120)
  );

  insert into public.app_user_audit (target_user_id, target_email, actor_user_id, actor_email, action, from_value, to_value)
  values (p_app_user_id, v_user.email, null, left(p_set_by, 120), 'woven_linked', null,
          'employee:' || p_external_employee_id || case when v_managed then ' status_managed' else '' end);

  return 'linked';
end;
$$;

-- ----------------------------------------------- 10. the invite record ---

create or replace function public.employee_access_record_invite(
  p_app_user_id uuid,
  p_outcome     text,
  p_error_code  text,
  p_set_by      text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_outcome not in ('sent', 'failed') then
    raise exception 'record_invite_invalid_outcome' using errcode = 'invalid_parameter_value';
  end if;
  update public.employee_account_links
     set invite_delivery_status = p_outcome,
         invite_sent_at = case when p_outcome = 'sent' then now() else invite_sent_at end,
         invite_error = case when p_outcome = 'failed' then coalesce(nullif(p_error_code, ''), 'unknown') else null end,
         invite_attempts = invite_attempts + 1,
         last_invite_attempt_at = now()
   where app_user_id = p_app_user_id and management = 'woven_linked';
  if not found then
    return false;
  end if;

  select u.email into v_email from public.app_users u where u.id = p_app_user_id;
  insert into public.app_user_audit (target_user_id, target_email, actor_user_id, actor_email, action, from_value, to_value)
  values (p_app_user_id, coalesce(v_email, ''), null, left(p_set_by, 120),
          case when p_outcome = 'sent' then 'invited' else 'invite_failed' end,
          null, case when p_outcome = 'failed' then coalesce(nullif(p_error_code, ''), 'unknown') else null end);
  return true;
end;
$$;

-- --------------------------------------------- 11. DISABLE_TERMINATED ---

create or replace function public.employee_access_disable_terminated(
  p_app_user_id          uuid,
  p_external_employee_id text,
  p_set_by               text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link   record;
  v_status text;
begin
  select * into v_link from public.employee_account_links where app_user_id = p_app_user_id for update;
  if not found or v_link.management <> 'woven_linked' or v_link.external_employee_id is distinct from p_external_employee_id then
    raise exception 'disable_not_linked' using errcode = 'check_violation';
  end if;
  if not v_link.managed_status then
    raise exception 'disable_status_not_managed' using errcode = 'check_violation';
  end if;
  if public.employee_access_is_protected(p_app_user_id) then
    raise exception 'disable_protected_account' using errcode = 'check_violation';
  end if;

  /*
   * ONLY Woven's own Terminated, read in the latest run, from a directory
   * whose latest finished sync succeeded. Missing, unknown, stale or a past
   * TerminationDate on an Active employee: refused.
   */
  if not public.employee_access_directory_is_current() then
    raise exception 'disable_directory_not_current' using errcode = 'check_violation';
  end if;
  if public.employee_access_observed_status(p_external_employee_id) <> 'terminated' then
    raise exception 'disable_not_terminated_in_latest_read' using errcode = 'check_violation';
  end if;

  select u.status::text into v_status from public.app_users u where u.id = p_app_user_id for update;
  if not found then
    raise exception 'disable_account_not_found' using errcode = 'no_data_found';
  end if;

  if v_status <> 'disabled' then
    update public.app_users set status = 'disabled', updated_by = null where id = p_app_user_id;
    insert into public.app_user_audit (target_user_id, target_email, actor_user_id, actor_email, action, from_value, to_value)
    select p_app_user_id, u.email, null, left(p_set_by, 120), 'status_changed', v_status, 'disabled'
      from public.app_users u where u.id = p_app_user_id;
  end if;

  update public.employee_account_links
     set terminated_at = coalesce(terminated_at, now()),
         revoked_woven_status = 'terminated',
         last_synced_at = now()
   where app_user_id = p_app_user_id;

  return case when v_status = 'disabled' then 'already_disabled' else 'disabled' end;
end;
$$;

/* After the Auth ban + session revocation: stamp the link, and audit either way. */
create or replace function public.employee_access_record_revocation(
  p_app_user_id uuid,
  p_ok          boolean,
  p_detail      text,
  p_set_by      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.employee_account_links
       set access_revoked_at = coalesce(access_revoked_at, now()),
           revoked_woven_status = 'terminated'
     where app_user_id = p_app_user_id and terminated_at is not null;
    if not found then
      raise exception 'record_revocation_not_terminated' using errcode = 'check_violation';
    end if;
  end if;
  insert into public.app_user_audit (target_user_id, target_email, actor_user_id, actor_email, action, from_value, to_value)
  select p_app_user_id, u.email, null, left(p_set_by, 120),
         case when p_ok then 'access_revoked' else 'access_revocation_incomplete' end,
         'woven:terminated', left(coalesce(p_detail, ''), 200)
    from public.app_users u where u.id = p_app_user_id;
end;
$$;

-- ----------------------------- 12. accepting an invitation stamps the link ---
--
-- Identical to 20260905001000 except for the one marked statement.

create or replace function public.accept_invitation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_status    public.app_user_status;
  v_email     text;
  v_confirmed boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;

  select status, email into v_status, v_email
  from public.app_users
  where id = v_uid
  for update;

  if not found then
    raise exception 'No Ask Sunny profile exists for this account.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status = 'disabled' then
    raise exception 'This account is disabled.' using errcode = 'insufficient_privilege';
  end if;

  if v_status = 'active' then
    return jsonb_build_object('status', 'active', 'changed', false);
  end if;

  select (email_confirmed_at is not null) into v_confirmed
  from auth.users where id = v_uid;

  if not coalesce(v_confirmed, false) then
    raise exception 'This account has not confirmed its email address.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.app_users
     set status = 'active'
   where id = v_uid
     and status = 'invited';

  /* NEW: a Woven-linked account records when its invitation was accepted. Nothing else on the link changes. */
  update public.employee_account_links
     set invite_accepted_at = now()
   where app_user_id = v_uid
     and invite_accepted_at is null;

  insert into public.app_user_audit (
    target_user_id, target_email, actor_user_id, actor_email, action,
    from_value, to_value
  )
  values (v_uid, v_email, v_uid, v_email, 'invitation_accepted', 'invited', 'active');

  return jsonb_build_object('status', 'active', 'changed', true);
end;
$$;

revoke execute on function public.accept_invitation() from public;
revoke execute on function public.accept_invitation() from anon;
grant execute on function public.accept_invitation() to authenticated;

-- ---------------------------------------------------------- 13. grants ---

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.employee_access_directory_is_current()',
    'public.employee_access_observed_status(text)',
    'public.employee_access_is_protected(uuid)',
    'public.employee_access_begin_apply_run(text, uuid, text)',
    'public.employee_access_finish_apply_run(uuid, text, text[], jsonb)',
    'public.employee_access_record_apply_actions(uuid, jsonb)',
    'public.employee_access_auth_user_by_email(text)',
    'public.employee_access_provision_account(uuid, text, text, text, text, text, text)',
    'public.employee_access_link_existing(uuid, text, text)',
    'public.employee_access_record_invite(uuid, text, text, text)',
    'public.employee_access_disable_terminated(uuid, text, text)',
    'public.employee_access_record_revocation(uuid, boolean, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

/* The server's entry points. The three helper predicates stay owner-only. */
grant execute on function public.employee_access_begin_apply_run(text, uuid, text) to service_role;
grant execute on function public.employee_access_finish_apply_run(uuid, text, text[], jsonb) to service_role;
grant execute on function public.employee_access_record_apply_actions(uuid, jsonb) to service_role;
grant execute on function public.employee_access_auth_user_by_email(text) to service_role;
grant execute on function public.employee_access_provision_account(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.employee_access_link_existing(uuid, text, text) to service_role;
grant execute on function public.employee_access_record_invite(uuid, text, text, text) to service_role;
grant execute on function public.employee_access_disable_terminated(uuid, text, text) to service_role;
grant execute on function public.employee_access_record_revocation(uuid, boolean, text, text) to service_role;
