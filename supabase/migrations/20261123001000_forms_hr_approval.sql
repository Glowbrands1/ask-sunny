-- FORMS — HR APPROVAL BEFORE A FORM IS FINAL
--
-- Every form except the Coaching Form and the Follow-Up Coaching Form waits for
-- HR's approval after the manager presses "Finalize and send for approval"
-- (owner request, 23 Nov 2026). While it waits it is still a DRAFT
-- (`status = 'draft'`): it is not on file, it is not a prior warning, and no
-- final PDF exists. HR approves (the form is then finalized as before), rejects
-- or sends it back for changes, each with a note, and may edit it meanwhile.
--
-- WHO KNOWS IT EXISTS. While a form is not yet approved, only the manager who
-- created it and HR may see it at all — not their District or Regional Manager,
-- not an administrator. The code enforces that (`hr-approval.ts`); the overview
-- view gains the state so lists can be narrowed before their limit.
--
-- Additive only: two columns' worth of state on `form_instances`, three new
-- server-only tables, one RPC, the value guard extended, the overview view
-- extended at its end. Until this is applied, the code reads the feature as
-- off (FORMS_HR_APPROVAL_ENABLED is off in production too).
--
-- Not applied by the pull request: QA applies it after merge.

-- ------------------------------------------------------------ the approver ---

-- Keyed to the authenticated account (`app_users.id`), never to a name or email,
-- like `forms_all_store_access`. Managed by inserting or revoking a row. To
-- revoke: update public.form_hr_approvers set revoked_at = now() where app_user_id = '<id>';
create table if not exists public.form_hr_approvers (
  app_user_id uuid primary key references public.app_users (id) on delete cascade,
  reason text not null check (length(reason) between 1 and 500),
  granted_by text not null check (length(granted_by) between 1 and 200),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.form_hr_approvers is
  'Accounts that approve forms as HR. Server-only. A row with revoked_at set grants nothing.';

alter table public.form_hr_approvers enable row level security;
alter table public.form_hr_approvers force row level security;
revoke all on public.form_hr_approvers from anon, authenticated;

-- NO SEED ROW. The approver is added as data after this is applied, by account id, never by name or email:
--   insert into public.form_hr_approvers (app_user_id, reason, granted_by)
--   values ('<account id>', 'Approved HR approver for forms (owner request, 23 Nov 2026)', '<who added it>');
-- Until a row exists nobody is HR: with the flag on, forms still go to HR and wait, unseen by anybody but their
-- creator, so add the row before turning FORMS_HR_APPROVAL_ENABLED on.

-- ------------------------------------------------------- the form's state ---

alter table public.form_instances
  add column if not exists hr_approval_state text,
  add column if not exists hr_approval_requested_at timestamptz,
  add column if not exists hr_approval_follow_up_date date,
  add column if not exists hr_approval_decided_at timestamptz,
  add column if not exists hr_approval_decided_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'form_instances_hr_approval_state_known') then
    alter table public.form_instances add constraint form_instances_hr_approval_state_known check (
      hr_approval_state is null
      or hr_approval_state in ('pending', 'changes_requested', 'rejected', 'approved')
    );
  end if;
end $$;

-- HR's tab reads the waiting forms oldest first.
create index if not exists form_instances_hr_pending
  on public.form_instances (hr_approval_requested_at)
  where hr_approval_state = 'pending';

-- ------------------------------------------- what happened, and HR's notes ---

-- HR's notes are readable only by the form's creator and HR: the code serves
-- them to nobody else. Kept apart from `form_instance_events`, whose history
-- route serves every reader of the form.
create table if not exists public.form_hr_approval_events (
  id uuid primary key default extensions.gen_random_uuid(),
  instance_id uuid not null references public.form_instances (id) on delete cascade,
  action text not null check (action in (
    'submitted', 'approved', 'rejected', 'changes_requested', 'edited', 'commented', 'withdrawn'
  )),
  actor text not null check (length(actor) between 1 and 200),
  note text check (note is null or length(note) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists form_hr_approval_events_by_instance
  on public.form_hr_approval_events (instance_id, created_at);

alter table public.form_hr_approval_events enable row level security;
alter table public.form_hr_approval_events force row level security;
revoke all on public.form_hr_approval_events from anon, authenticated;

-- ----------------------------------------- the 6 AM reminder, sent once ---

-- One row per approver per Central-time day: the cron runs at two UTC hours (to
-- follow daylight saving) and may be retried, and the key makes a second send
-- of the same day a no-op.
create table if not exists public.form_hr_reminder_sends (
  approver_id uuid not null references public.app_users (id) on delete cascade,
  local_date date not null,
  pending_count integer not null check (pending_count >= 0),
  sent_at timestamptz not null default now(),
  primary key (approver_id, local_date)
);

alter table public.form_hr_reminder_sends enable row level security;
alter table public.form_hr_reminder_sends force row level security;
revoke all on public.form_hr_reminder_sends from anon, authenticated;

-- --------------------------------- a waiting form's values are held for HR ---

-- The value guard, extended: while a form waits for HR (`pending`) nobody writes
-- its values — not the manager's card, not a chat correction, not a draft route
-- — except through `form_hr_approval_write_values`, which sets a
-- transaction-local marker this checks. A code path that forgets the rule is
-- refused here.
create or replace function public.forms_guard_finalized_values()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  instance_status public.form_instance_status;
  approval_state text;
begin
  select status, hr_approval_state into instance_status, approval_state
  from public.form_instances
  where id = coalesce(new.instance_id, old.instance_id);

  if instance_status in ('finalized', 'revised') then
    raise exception 'This form is finalized. Create a revision instead of editing its values.'
      using errcode = '23514';
  end if;

  if approval_state = 'pending'
     and coalesce(current_setting('forms.hr_approval_edit', true), '') <> 'on' then
    raise exception 'This form is waiting for HR approval. Only HR may change it until it is sent back.'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.forms_guard_finalized_values() from public, anon, authenticated;

-- HR's edit of a waiting form. Writes the given rows exactly as the app's
-- `writeValues` upsert does, in one transaction with the marker set.
create or replace function public.form_hr_approval_write_values(p_instance_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.form_instances
    where id = p_instance_id and status = 'draft' and hr_approval_state = 'pending'
  ) then
    raise exception 'That form is not waiting for HR approval.' using errcode = '23514';
  end if;

  perform set_config('forms.hr_approval_edit', 'on', true);

  insert into public.form_instance_values (instance_id, field_key, value, checked, filled_by, provenance, updated_at)
  select p_instance_id,
         r.field_key,
         r.value,
         coalesce(r.checked, '[]'::jsonb),
         r.filled_by::public.form_field_responsibility,
         coalesce(r.provenance, '{}'::jsonb),
         now()
  from jsonb_to_recordset(p_rows) as r(field_key text, value text, checked jsonb, filled_by text, provenance jsonb)
  on conflict (instance_id, field_key) do update
    set value = excluded.value,
        checked = excluded.checked,
        filled_by = excluded.filled_by,
        provenance = excluded.provenance,
        updated_at = excluded.updated_at;

  perform set_config('forms.hr_approval_edit', '', true);
end;
$$;

revoke all on function public.form_hr_approval_write_values(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.form_hr_approval_write_values(uuid, jsonb) to service_role;

-- ------------------------------------------------------- the overview view ---

-- `create or replace` may add columns only at the end; every existing column
-- keeps its name, type and order, as 20261120002000_forms_overview_unaccent.sql
-- defined them.
create or replace view public.form_instance_overview
with (security_invoker = true) as
select
  i.id,
  i.template_id,
  t.key as template_key,
  t.name as template_name,
  t.short_name as template_short_name,
  t.layout_family,
  i.template_version_id,
  v.version as template_version,
  i.variant_key,
  i.employee_name,
  i.employee_role,
  i.location_id,
  i.location_name,
  i.created_by,
  i.created_by_role,
  i.source,
  i.status,
  i.form_date,
  i.follow_up_date,
  i.followed_up_at,
  i.followed_up_by,
  i.finalized_at,
  i.exported_at,
  i.archived_at,
  i.revises_instance_id,
  i.created_at,
  i.updated_at,
  lower(extensions.unaccent(i.employee_name)) as employee_name_folded,
  i.hr_approval_state,
  i.hr_approval_requested_at,
  t.required_permission
from public.form_instances i
join public.form_templates t on t.id = i.template_id
join public.form_template_versions v on v.id = i.template_version_id;

-- Restated, as every redefinition of this view does: deny by default on top of a security_invoker view.
revoke all on public.form_instance_overview from anon, authenticated;
