-- ============================================================================
-- EVERY DELETED FORM LEAVES A PERMANENT RECORD (board f066, Pau approved 20 Nov 2026)
-- ============================================================================
--
-- Four drafts were deleted between 17 and 20 Nov 2026 and nothing said who or
-- when: `form_instance_events` goes with the form (ON DELETE CASCADE), and
-- `activity_events` has no delete entry. For HR records that is a gap.
--
-- WHAT THIS ADDS
--
--   form_instance_deletions   append-only. One row per deleted form: who, their
--                             role, how (app route / chat / agent loop / demo
--                             sweep / other), when, the form's headline facts,
--                             and a JSON snapshot of the row and its values.
--
--   a BEFORE DELETE trigger   on form_instances, so EVERY path writes the row —
--                             the app's routes, the chat, and a delete typed
--                             into the SQL editor. BEFORE, so the values are
--                             still there to snapshot (the cascade runs after).
--
-- WHO DELETED IT. The app talks to Postgres over HTTP, one statement per
-- request, so a `set_config` cannot share a transaction with the delete. The
-- app therefore stamps the row it is about to delete (`deletion_requested_*`,
-- in the request just before), and the trigger copies the stamp. A stamp older
-- than ten minutes is a delete that failed earlier and is not trusted. A delete
-- with no stamp (direct SQL) is recorded with `deleted_via = 'other'`, no app
-- user, and the database role that ran it (`db_user`).
--
-- NOBODY CHANGES THE RECORD. Like the rest of the forms schema, RLS is enabled
-- with no policy, and anon / authenticated are revoked: only the
-- server (service role) reads it, and the app shows it to admins only. The
-- service role bypasses RLS, so a trigger refuses UPDATE and DELETE outright,
-- and TRUNCATE is revoked. Inserts come from the trigger.
--
-- NOT APPLIED BY THE PULL REQUEST. QA applies it after merge.
-- ============================================================================

alter table public.form_instances
  add column deletion_requested_by text,
  add column deletion_requested_role text,
  add column deletion_requested_via text,
  add column deletion_requested_at timestamptz;

create table public.form_instance_deletions (
  id uuid primary key default extensions.gen_random_uuid(),
  -- Not a foreign key: the form it names is gone.
  instance_id uuid not null,
  template_key text,
  template_name text,
  employee_name text,
  form_date date,
  status text,
  location_id text,
  location_name text,
  created_by text,
  -- The app user who deleted it, as the app knows them; null for a delete the app did not make.
  deleted_by text,
  deleted_by_role text,
  -- 'route' (Form Monitoring), 'chat', 'agent_loop', 'demo_sweep', or 'other' (no app stamp).
  deleted_via text not null default 'other',
  deleted_at timestamptz not null default now(),
  -- The database role that ran the delete (service_role for the app).
  db_user text not null default current_user,
  -- The form row and its values as they stood: { "instance": {...}, "values": [...] }.
  snapshot jsonb not null
);

create index form_instance_deletions_by_instance on public.form_instance_deletions (instance_id);
create index form_instance_deletions_by_employee on public.form_instance_deletions (lower(employee_name), deleted_at desc);
create index form_instance_deletions_by_time on public.form_instance_deletions (deleted_at desc);

-- ------------------------------------------------------------- the record ---

create or replace function public.forms_record_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stamped boolean := old.deletion_requested_at is not null
    and old.deletion_requested_at > now() - interval '10 minutes';
  template record;
begin
  select t.key, t.name into template
  from public.form_templates t
  where t.id = old.template_id;

  insert into public.form_instance_deletions (
    instance_id, template_key, template_name, employee_name, form_date, status,
    location_id, location_name, created_by, deleted_by, deleted_by_role, deleted_via, snapshot
  ) values (
    old.id, template.key, template.name, old.employee_name, old.form_date, old.status::text,
    old.location_id, old.location_name, old.created_by,
    case when stamped then old.deletion_requested_by end,
    case when stamped then old.deletion_requested_role end,
    coalesce(case when stamped then old.deletion_requested_via end, 'other'),
    jsonb_build_object(
      'instance', to_jsonb(old),
      'values', coalesce((
        select jsonb_agg(jsonb_build_object('field_key', v.field_key, 'value', v.value, 'checked', v.checked) order by v.field_key)
        from public.form_instance_values v
        where v.instance_id = old.id
      ), '[]'::jsonb)
    )
  );
  return old;
end;
$$;

create trigger form_instances_record_deletion
  before delete on public.form_instances
  for each row execute function public.forms_record_deletion();

-- ------------------------------------------------------- append-only guard ---

create or replace function public.forms_deletions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'form_instance_deletions is append-only: a deletion record is never changed or removed.'
    using errcode = '42501';
end;
$$;

create trigger form_instance_deletions_append_only
  before update or delete on public.form_instance_deletions
  for each row execute function public.forms_deletions_append_only();

-- Enabled, not FORCED: the recording trigger runs as the table's owner (security definer) and must be able to insert.
-- With no policy, anon and authenticated read and write nothing; the revokes below say so outright as well.
alter table public.form_instance_deletions enable row level security;
revoke all on public.form_instance_deletions from anon, authenticated;
revoke truncate, update, delete on public.form_instance_deletions from service_role;

revoke all on function public.forms_record_deletion() from public, anon, authenticated;
revoke all on function public.forms_deletions_append_only() from public, anon, authenticated;
