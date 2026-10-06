-- =============================================================================
-- Woven DISABLE_TERMINATED — the first apply action (switch OFF by default)
-- =============================================================================
--
-- Infrastructure for ONE lifecycle action: when Woven explicitly reports a
-- linked, status-managed, unprotected employee as Terminated, disable their
-- Ask Sunny access through the existing hardened path (profile disabled,
-- Supabase Auth ban, sessions and refresh tokens revoked). Nothing is deleted.
--
--   1. employee_access_controls: one switch per apply action. DISABLE_TERMINATED
--      is seeded OFF. It is changed only by the owner in the SQL editor —
--      service_role may READ it, never write it — and every change is logged
--      append-only in employee_access_control_changes.
--
--   2. employee_access_operations: the idempotency ledger. One row per attempt
--      to apply an action to an account; at most ONE open (pending) row per
--      action and account, so two runs cannot act on the same person at once.
--      Rows are written only through two functions (claim, finish); a pending
--      row left by a crashed run is abandoned after 15 minutes so the next run
--      can complete the work.
--
--   3. The access record gains apply runs: employee_access_runs.mode accepts
--      'apply', and employee_access_actions.result accepts applied / skipped /
--      failed / blocked. A trigger keeps the two consistent: a shadow run holds
--      only shadow results, an apply run never does.
--
--   4. employee_account_links: service_role may also write terminated_at,
--      access_revoked_at and revoked_woven_status — WRITE-ONCE in this
--      version (null → value only). Everything else about a link stays
--      immutable.
--
--   5. employee_access_record_apply_run(): records one apply run and its
--      per-account results in one transaction.
--
-- No account, auth row or session is changed by this migration. Applied only
-- with approval, verbatim, in one transaction. Idempotent.

-- --------------------------------------------------- 1. per-action switch ---

create table if not exists public.employee_access_controls (
  action        text primary key check (action in ('DISABLE_TERMINATED')),
  enabled       boolean not null default false,
  max_per_run   smallint not null default 3 check (max_per_run between 1 and 25),
  changed_by    text not null check (length(btrim(changed_by)) between 1 and 120),
  reason        text check (reason is null or length(btrim(reason)) between 1 and 300),
  updated_at    timestamptz not null default now()
);

comment on table public.employee_access_controls is
  'One switch per Woven apply action. OFF by default. Changed only by the owner in the SQL editor (service_role may read, never write); every change is logged in employee_access_control_changes.';

insert into public.employee_access_controls (action, enabled, max_per_run, changed_by, reason)
values ('DISABLE_TERMINATED', false, 3, 'migration:20261007001000', 'Off until the owner approves automatic revocation')
on conflict (action) do nothing;

create table if not exists public.employee_access_control_changes (
  id               uuid primary key default extensions.gen_random_uuid(),
  action           text not null,
  enabled_from     boolean,
  enabled_to       boolean not null,
  max_per_run_from smallint,
  max_per_run_to   smallint not null,
  changed_by       text not null,
  reason           text,
  changed_at       timestamptz not null default now()
);

comment on table public.employee_access_control_changes is
  'Append-only log of every change to employee_access_controls.';

create or replace function public.employee_access_controls_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  insert into public.employee_access_control_changes (action, enabled_from, enabled_to, max_per_run_from, max_per_run_to, changed_by, reason)
  values (new.action, case when tg_op = 'UPDATE' then old.enabled end, new.enabled,
          case when tg_op = 'UPDATE' then old.max_per_run end, new.max_per_run, new.changed_by, new.reason);
  return new;
end;
$$;

drop trigger if exists employee_access_controls_log on public.employee_access_controls;
create trigger employee_access_controls_log
  before insert or update on public.employee_access_controls
  for each row execute function public.employee_access_controls_log_change();

drop trigger if exists employee_access_control_changes_append_only on public.employee_access_control_changes;
create trigger employee_access_control_changes_append_only
  before update or delete on public.employee_access_control_changes
  for each row execute function public.employee_access_actions_guard();

/* Log the seeded state (the insert above ran before the trigger existed). */
insert into public.employee_access_control_changes (action, enabled_from, enabled_to, max_per_run_from, max_per_run_to, changed_by, reason)
select c.action, null, c.enabled, null, c.max_per_run, c.changed_by, c.reason
from public.employee_access_controls c
where not exists (select 1 from public.employee_access_control_changes x where x.action = c.action);

alter table public.employee_access_controls enable row level security;
alter table public.employee_access_controls force row level security;
alter table public.employee_access_control_changes enable row level security;
alter table public.employee_access_control_changes force row level security;
revoke all on public.employee_access_controls from public, anon, authenticated, service_role;
revoke all on public.employee_access_control_changes from public, anon, authenticated, service_role;
grant select on public.employee_access_controls to service_role;
grant select on public.employee_access_control_changes to service_role;
revoke all on function public.employee_access_controls_log_change() from public, anon, authenticated, service_role;

-- ------------------------------------------- 2. the idempotency ledger ---

create table if not exists public.employee_access_operations (
  id                    uuid primary key default extensions.gen_random_uuid(),
  action                text not null check (action in ('DISABLE_TERMINATED')),
  app_user_id           uuid not null references public.app_users (id) on delete restrict,
  external_employee_id  text not null check (external_employee_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  trigger_source        text not null check (trigger_source in ('cron', 'test')),
  status                text not null default 'pending' check (status in ('pending', 'applied', 'skipped', 'failed', 'abandoned')),
  steps                 jsonb not null default '{}'::jsonb check (jsonb_typeof(steps) = 'object'),
  error_code            text check (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'),
  error_detail          text check (error_detail is null or length(error_detail) <= 500),
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  constraint employee_access_operations_open_until_finished check ((status = 'pending') = (finished_at is null))
);

/* At most one open attempt per action and account: two runs can never act on the same person at once. */
create unique index if not exists employee_access_operations_one_open
  on public.employee_access_operations (action, app_user_id) where status = 'pending';
create index if not exists employee_access_operations_recent on public.employee_access_operations (started_at desc);

comment on table public.employee_access_operations is
  'Idempotency ledger for Woven apply actions: one row per attempt, written only through employee_access_claim_operation / employee_access_finish_operation.';

create or replace function public.employee_access_claim_operation(
  p_action                text,
  p_app_user_id           uuid,
  p_external_employee_id  text,
  p_trigger_source        text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  /* A pending attempt older than 15 minutes belongs to a run that died: abandon it so this run can finish the work. */
  update public.employee_access_operations
     set status = 'abandoned', finished_at = now(), error_code = 'abandoned_after_timeout'
   where action = p_action and app_user_id = p_app_user_id and status = 'pending'
     and started_at < now() - interval '15 minutes';

  begin
    insert into public.employee_access_operations (action, app_user_id, external_employee_id, trigger_source)
    values (p_action, p_app_user_id, p_external_employee_id, p_trigger_source)
    returning id into v_id;
  exception when unique_violation then
    return null;  -- another run holds this account right now
  end;
  return v_id;
end;
$$;

create or replace function public.employee_access_finish_operation(
  p_id            uuid,
  p_status        text,
  p_steps         jsonb,
  p_error_code    text,
  p_error_detail  text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done integer := 0;
begin
  if p_status not in ('applied', 'skipped', 'failed') then
    raise exception 'employee_access_finish_operation: status must be applied, skipped or failed'
      using errcode = 'invalid_parameter_value';
  end if;
  update public.employee_access_operations
     set status = p_status, steps = coalesce(p_steps, '{}'::jsonb), error_code = p_error_code,
         error_detail = left(p_error_detail, 500), finished_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_done = row_count;
  return v_done = 1;
end;
$$;

alter table public.employee_access_operations enable row level security;
alter table public.employee_access_operations force row level security;
revoke all on public.employee_access_operations from public, anon, authenticated, service_role;
grant select on public.employee_access_operations to service_role;
revoke all on function public.employee_access_claim_operation(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.employee_access_finish_operation(uuid, text, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function public.employee_access_claim_operation(text, uuid, text, text) to service_role;
grant execute on function public.employee_access_finish_operation(uuid, text, jsonb, text, text) to service_role;

-- ------------------------------------- 3. apply runs in the access record ---

alter table public.employee_access_runs drop constraint if exists employee_access_runs_mode_check;
alter table public.employee_access_runs add constraint employee_access_runs_mode_check check (mode in ('shadow', 'apply'));

alter table public.employee_access_actions drop constraint if exists employee_access_actions_result_check;
alter table public.employee_access_actions add constraint employee_access_actions_result_check
  check (result in ('shadow', 'applied', 'skipped', 'failed', 'blocked'));

create or replace function public.employee_access_actions_match_run()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode text;
begin
  select mode into v_mode from public.employee_access_runs where id = new.access_run_id;
  if (v_mode = 'shadow') <> (new.result = 'shadow') then
    raise exception 'employee_access_actions: a % run cannot hold a % result', v_mode, new.result
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_access_actions_match_run on public.employee_access_actions;
create trigger employee_access_actions_match_run
  before insert on public.employee_access_actions
  for each row execute function public.employee_access_actions_match_run();

revoke all on function public.employee_access_actions_match_run() from public, anon, authenticated, service_role;

-- ------------------------------ 4. revocation fields on the link, write-once ---

create or replace function public.employee_account_links_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  /* Everything except the three flags, the three revocation fields (and the touched timestamp) is the link's identity. */
  if (to_jsonb(new) - array['managed_status', 'managed_location', 'managed_role',
                            'terminated_at', 'access_revoked_at', 'revoked_woven_status', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['managed_status', 'managed_location', 'managed_role',
                            'terminated_at', 'access_revoked_at', 'revoked_woven_status', 'updated_at']) then
    raise exception 'employee_account_links: only managed_status, managed_location, managed_role and the revocation fields can change'
      using errcode = 'check_violation';
  end if;
  /* Revocation fields are write-once in this version: recorded, never rewritten or cleared. */
  if (old.terminated_at is not null and new.terminated_at is distinct from old.terminated_at)
     or (old.access_revoked_at is not null and new.access_revoked_at is distinct from old.access_revoked_at)
     or (old.revoked_woven_status is not null and new.revoked_woven_status is distinct from old.revoked_woven_status) then
    raise exception 'employee_account_links: revocation fields are write-once'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.employee_account_links_guard_update() from public, anon, authenticated, service_role;

grant update (terminated_at, access_revoked_at, revoked_woven_status) on public.employee_account_links to service_role;

-- --------------------------------------------- 5. recording an apply run ---

create or replace function public.employee_access_record_apply_run(
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
    raise exception 'employee_access_record_apply_run: actions must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.employee_access_runs (mode, requested_by, directory_run_id, policy_version, status, guard_codes, counts)
  values (
    'apply', p_requested_by, p_directory_run_id, p_policy_version,
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
    true,
    coalesce(array(select jsonb_array_elements_text(a -> 'reason_codes')), '{}'),
    a -> 'before_values',
    a -> 'after_values',
    nullif(a ->> 'woven_source_at', '')::timestamptz,
    a ->> 'result'
  from jsonb_array_elements(p_actions) as a;

  return v_run;
end;
$$;

comment on function public.employee_access_record_apply_run(text, uuid, text, text[], jsonb, jsonb) is
  'Records one APPLY run of a Woven access action and each account''s result (applied / skipped / failed / blocked), in one transaction. Writes only employee_access_runs and employee_access_actions.';

revoke all on function public.employee_access_record_apply_run(text, uuid, text, text[], jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.employee_access_record_apply_run(text, uuid, text, text[], jsonb, jsonb) to service_role;
