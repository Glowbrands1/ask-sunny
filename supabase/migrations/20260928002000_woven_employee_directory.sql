-- ---------------------------------------------------------------------------
-- WOVEN EMPLOYEE DIRECTORY — a read-only copy of who works where, and what moved
--
-- NOT APPLIED. This file is prepared ahead of Woven approving the Operations
-- API subscription. It is applied only with explicit approval, verbatim, in one
-- transaction, to Ask Sunny Dev (`rbkylaavthsjepsczccv`) — which is also what
-- Production reads, so applying it IS a production change.
--
-- WHAT THIS CREATES, and nothing else:
--
--   employee_sync_runs          one row per sync attempt; the run lock
--   employee_access_directory   one row per Woven employee, keyed on
--                               (source_system, external_employee_id)
--   employee_directory_changes  append-only history of what changed, per run
--   woven_location_map          Woven location id → Ask Sunny salon, reviewed
--                               by a person, never inferred
--   four enums, four functions the sync calls, one reviewer function, one
--   guard trigger, one status view and one login-match view
--
-- WHAT THIS DOES NOT CHANGE — the phase-one boundary:
--
--   `app_users`, `app_user_audit`, `auth.users`, every existing role, scope,
--   policy, grant and function are untouched. Nothing here has a foreign key
--   to `app_users` or `auth.users`, no trigger fires on them, and no function
--   reads or writes them except the read-only `employee_directory_login_matches`
--   view, which SHOWS a possible email match and grants nothing. A terminated
--   employee is RECORDED as terminated; their Ask Sunny login is not disabled.
--
--   `docs/HANDOFF.md` says "There is no employee directory, and none should be
--   invented." This file is the deliberate, approved exception to that rule:
--   the directory is sourced from Woven, not invented, and it is observation
--   only in this phase.
--
-- ACCESS: every table has RLS enabled AND forced with no policies, and every
-- privilege revoked from `anon` and `authenticated`. Only the server, under the
-- secret key, reads or writes any of it. Every function is revoked from
-- `public`, `anon` and `authenticated` — all three, per HANDOFF §3.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ enums ---

do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_employment_status') then
    create type public.employee_employment_status as enum (
      'active',
      'terminated',
      /* A status Woven stated that is neither. NEVER read as terminated. */
      'unknown'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'employee_sync_run_status') then
    create type public.employee_sync_run_status as enum (
      'running',
      'succeeded',
      /* Stopped on an error: Woven unreachable, refused, or the save failed. */
      'failed',
      /* The read arrived but could not be trusted as the whole estate. */
      'rejected'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'employee_directory_change_kind') then
    create type public.employee_directory_change_kind as enum (
      'new_employee',
      'terminated',
      'reactivated',
      /* NOT a promotion. Direction is 'unclassified' until a hierarchy is approved. */
      'position_changed',
      /* A transfer of home salon. */
      'primary_location_changed',
      'location_affiliation_added',
      'location_affiliation_removed',
      'work_email_changed',
      /* Absent from consecutive syncs. Recorded, never acted on. */
      'missing_from_source'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'woven_location_map_status') then
    create type public.woven_location_map_status as enum (
      /* Seen in Woven, not yet reviewed. The default for every new location. */
      'unmapped',
      /* A person confirmed which Ask Sunny salon it is. */
      'mapped',
      /* A person confirmed it is not a salon (an office, a test location). */
      'ignored'
    );
  end if;
end
$$;

-- ------------------------------------------------------------- sync runs ---

create table if not exists public.employee_sync_runs (
  id uuid primary key default extensions.gen_random_uuid(),

  source_system text not null default 'woven' check (source_system in ('woven')),

  /* `cron`, or `admin:<email>` from a verified session. Never a secret. */
  requested_by text not null
    check (length(btrim(requested_by)) > 0 and length(requested_by) <= 120),

  status public.employee_sync_run_status not null default 'running',

  requests_made            integer not null default 0 check (requests_made >= 0),
  pages_fetched            integer not null default 0 check (pages_fetched >= 0),
  employees_received       integer not null default 0 check (employees_received >= 0),
  employees_active         integer not null default 0 check (employees_active >= 0),
  employees_terminated     integer not null default 0 check (employees_terminated >= 0),
  employees_status_unknown integer not null default 0 check (employees_status_unknown >= 0),
  employees_created        integer not null default 0 check (employees_created >= 0),
  employees_updated        integer not null default 0 check (employees_updated >= 0),
  employees_unchanged      integer not null default 0 check (employees_unchanged >= 0),
  /* On file but absent from this read. They are kept; their miss count rises. */
  employees_missing        integer not null default 0 check (employees_missing >= 0),
  details_fetched          integer not null default 0 check (details_fetched >= 0),
  details_skipped          integer not null default 0 check (details_skipped >= 0),
  records_rejected         integer not null default 0 check (records_rejected >= 0),
  changes_recorded         integer not null default 0 check (changes_recorded >= 0),
  unmapped_locations       integer not null default 0 check (unmapped_locations >= 0),

  /* Issue CODES and counts. Never a name, an email or a Woven response body. */
  issue_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(issue_counts) = 'object'),

  error_code text
    check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  /* The sync's own sentence. Bounded, and written by code that never quotes a record. */
  error_detail text
    check (error_detail is null or length(error_detail) <= 500),

  started_at  timestamptz not null default now(),
  finished_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employee_sync_runs_finished_after_start
    check (finished_at is null or finished_at >= started_at),
  constraint employee_sync_runs_status_agrees
    check ((status = 'running') = (finished_at is null)),
  constraint employee_sync_runs_error_agrees
    check ((status in ('failed', 'rejected')) = (error_code is not null))
);

drop trigger if exists employee_sync_runs_touch_updated_at on public.employee_sync_runs;
create trigger employee_sync_runs_touch_updated_at
  before update on public.employee_sync_runs
  for each row execute function public.touch_updated_at();

/*
 * THE LOCK. At most one live run per source, as a constraint rather than a
 * convention: two concurrent claims race, one inserts, Postgres refuses the
 * other. Nothing to leak, and no way for a future route to forget.
 */
create unique index if not exists employee_sync_runs_one_live
  on public.employee_sync_runs (source_system)
  where status = 'running';

create index if not exists employee_sync_runs_recent
  on public.employee_sync_runs (source_system, started_at desc);

alter table public.employee_sync_runs enable row level security;
alter table public.employee_sync_runs force row level security;
revoke all on table public.employee_sync_runs from anon, authenticated;

comment on table public.employee_sync_runs is
  'One row per Woven employee sync attempt: the run lock (one running per source, by partial unique index), the counts, and the failure code. Holds no credential, token, employee name, email or Woven response body.';

-- ---------------------------------------------------- employee directory ---

create table if not exists public.employee_access_directory (
  id uuid primary key default extensions.gen_random_uuid(),

  source_system text not null check (source_system in ('woven')),
  /* Woven's employee id. The stable identity — never the email, never the name. */
  external_employee_id text not null
    check (external_employee_id ~ '^[A-Za-z0-9._:-]{1,64}$'),

  /* ---- the allowlist. There is no column for anything outside it. ---- */
  first_name     text check (first_name is null or length(first_name) <= 120),
  last_name      text check (last_name is null or length(last_name) <= 120),
  preferred_name text check (preferred_name is null or length(preferred_name) <= 120),
  /* WORK email only, lower-cased. Not unique: Woven can hold duplicates, which are flagged. */
  work_email text
    check (work_email is null or (length(work_email) <= 254 and work_email = lower(work_email) and work_email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  employment_status public.employee_employment_status not null default 'unknown',
  hire_date        date,
  termination_date date,
  position_id   text check (position_id is null or position_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  position_name text check (position_name is null or length(position_name) <= 160),
  primary_woven_location_id text
    check (primary_woven_location_id is null or primary_woven_location_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  primary_location_name text check (primary_location_name is null or length(primary_location_name) <= 160),

  /*
   * Every Woven location this employee is affiliated with, primary included —
   * the array for filtering, the jsonb for the detail (kind, start, expiry).
   * WOVEN location ids: which Ask Sunny salon each is lives in
   * `woven_location_map`, and is never assumed.
   */
  woven_location_ids text[] not null default '{}',
  location_affiliations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(location_affiliations) = 'array'),
  /* When the affiliation list was last read in full. Null: only the primary is known. */
  affiliations_verified_at timestamptz,

  source_updated_at timestamptz,

  /* Data-quality CODES (missing_work_email, duplicate_work_email, unmapped_location, …). */
  data_issues text[] not null default '{}',

  /* sha256 of the allowlisted fields, so an unchanged employee is cheap to recognise. */
  record_hash text not null check (record_hash ~ '^[0-9a-f]{64}$'),

  first_seen_run_id uuid references public.employee_sync_runs (id) on delete set null,
  last_seen_run_id  uuid references public.employee_sync_runs (id) on delete set null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  content_changed_at timestamptz not null default now(),
  /*
   * Consecutive syncs this employee was absent from. Reset by the next sync
   * that sees them. ABSENCE IS NOT TERMINATION: nothing reads this to change a
   * status, and no row is ever deleted.
   */
  missing_sync_count integer not null default 0 check (missing_sync_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employee_access_directory_source_identity
    unique (source_system, external_employee_id)
);

drop trigger if exists employee_access_directory_touch_updated_at on public.employee_access_directory;
create trigger employee_access_directory_touch_updated_at
  before update on public.employee_access_directory
  for each row execute function public.touch_updated_at();

create index if not exists employee_access_directory_work_email
  on public.employee_access_directory (lower(work_email))
  where work_email is not null;
create index if not exists employee_access_directory_status
  on public.employee_access_directory (source_system, employment_status);
create index if not exists employee_access_directory_position
  on public.employee_access_directory (position_id);
create index if not exists employee_access_directory_primary_location
  on public.employee_access_directory (primary_woven_location_id);
create index if not exists employee_access_directory_locations
  on public.employee_access_directory using gin (woven_location_ids);

alter table public.employee_access_directory enable row level security;
alter table public.employee_access_directory force row level security;
revoke all on table public.employee_access_directory from anon, authenticated;

comment on table public.employee_access_directory is
  'One row per Woven employee, keyed on (source_system, external_employee_id). An allowlisted, read-only copy: no pay, DOB, personal contact, address, HR document or note column exists. Never deleted; absence raises missing_sync_count. Phase one: read by nothing that grants access, and linked to no login.';
comment on column public.employee_access_directory.missing_sync_count is
  'Consecutive syncs this employee did not appear in. Never read as termination; only an explicit terminated status from Woven records one.';

-- --------------------------------------------------------- change history ---

create table if not exists public.employee_directory_changes (
  id uuid primary key default extensions.gen_random_uuid(),

  employee_id uuid not null references public.employee_access_directory (id) on delete restrict,
  sync_run_id uuid not null references public.employee_sync_runs (id) on delete restrict,

  change_kind public.employee_directory_change_kind not null,
  /* The before and after of the fields that changed, and only those. */
  from_value jsonb,
  to_value   jsonb,
  /* e.g. {"direction": "unclassified"} for a position change. */
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),

  detected_at timestamptz not null default now(),

  /* The ONLY mutable part: a person marking a change as looked at. */
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'acknowledged', 'dismissed')),
  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 120),
  reviewed_at timestamptz
);

create index if not exists employee_directory_changes_employee
  on public.employee_directory_changes (employee_id, detected_at desc);
create index if not exists employee_directory_changes_run
  on public.employee_directory_changes (sync_run_id);
create index if not exists employee_directory_changes_kind
  on public.employee_directory_changes (change_kind, detected_at desc);
create index if not exists employee_directory_changes_unreviewed
  on public.employee_directory_changes (detected_at desc)
  where review_status = 'unreviewed';

/*
 * APPEND-ONLY. History that can be edited is not history. A change row can be
 * marked reviewed; it cannot be rewritten or deleted — not by a route, and not
 * by the secret key either, which bypasses RLS but not a trigger.
 */
create or replace function public.employee_directory_changes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'employee_directory_changes is append-only; rows cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  if new.employee_id  is distinct from old.employee_id
     or new.sync_run_id is distinct from old.sync_run_id
     or new.change_kind is distinct from old.change_kind
     or new.from_value  is distinct from old.from_value
     or new.to_value    is distinct from old.to_value
     or new.details     is distinct from old.details
     or new.detected_at is distinct from old.detected_at then
    raise exception 'employee_directory_changes is append-only; only the review fields may change'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists employee_directory_changes_append_only on public.employee_directory_changes;
create trigger employee_directory_changes_append_only
  before update or delete on public.employee_directory_changes
  for each row execute function public.employee_directory_changes_guard();

alter table public.employee_directory_changes enable row level security;
alter table public.employee_directory_changes force row level security;
revoke all on table public.employee_directory_changes from anon, authenticated;

comment on table public.employee_directory_changes is
  'Append-only history of what changed for a Woven employee between syncs. A position change is never labelled a promotion. Recording a change grants, removes or alters no Ask Sunny access.';

-- ----------------------------------------------------- Woven location map ---

create table if not exists public.woven_location_map (
  id uuid primary key default extensions.gen_random_uuid(),

  woven_location_id text not null unique
    check (woven_location_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  woven_location_name text check (woven_location_name is null or length(woven_location_name) <= 160),

  status public.woven_location_map_status not null default 'unmapped',
  /*
   * The Ask Sunny salon, set by a PERSON through `woven_location_map_review`.
   * A Woven location id is not a salon number, and a name match is not proof:
   * the Google store-code mapping learned that the hard way.
   */
  salon_id uuid references public.salons (id) on delete restrict,

  first_seen_run_id uuid references public.employee_sync_runs (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 120),
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint woven_location_map_salon_agrees
    check ((status = 'mapped') = (salon_id is not null))
);

drop trigger if exists woven_location_map_touch_updated_at on public.woven_location_map;
create trigger woven_location_map_touch_updated_at
  before update on public.woven_location_map
  for each row execute function public.touch_updated_at();

create index if not exists woven_location_map_salon
  on public.woven_location_map (salon_id)
  where salon_id is not null;
create index if not exists woven_location_map_needs_review
  on public.woven_location_map (first_seen_at)
  where status = 'unmapped';

alter table public.woven_location_map enable row level security;
alter table public.woven_location_map force row level security;
revoke all on table public.woven_location_map from anon, authenticated;

comment on table public.woven_location_map is
  'Woven location id → Ask Sunny salon. Every location the sync sees is queued here as unmapped; only a person maps it. The sync never overwrites a mapping and never fails because a location is unmapped.';

-- ------------------------------------------------------------ functions ----

/*
 * Claims the run lock. Reaps a run left `running` for over 15 minutes first —
 * far longer than the route's wall clock — marking it failed, never deleting
 * it, so a crashed run stays visible.
 */
create or replace function public.employee_sync_claim_run(
  p_requested_by text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_running_since timestamptz;
begin
  update public.employee_sync_runs r
     set status = 'failed',
         finished_at = now(),
         error_code = 'stale_run',
         error_detail = 'The run never reported an outcome and was closed by the next claim.'
   where r.source_system = 'woven'
     and r.status = 'running'
     and r.started_at < now() - interval '15 minutes';

  begin
    insert into public.employee_sync_runs (source_system, requested_by)
    values ('woven', p_requested_by)
    returning id into v_id;
  exception when unique_violation then
    select r.started_at into v_running_since
      from public.employee_sync_runs r
     where r.source_system = 'woven' and r.status = 'running'
     limit 1;
    return jsonb_build_object('status', 'busy', 'runningSince', v_running_since);
  end;

  return jsonb_build_object('status', 'claimed', 'runId', v_id);
end;
$$;

/*
 * Saves one run, ALL OR NOTHING. A function body is one transaction: if any
 * statement fails — a constraint, a change naming an unknown employee — every
 * write of the run is rolled back and the run stays `running` for the caller
 * to abandon. The directory is then exactly as the last good run left it.
 *
 * It never deletes a directory row, never changes a status it was not given,
 * and never touches a location's mapping.
 */
create or replace function public.employee_sync_commit_run(
  p_run_id    uuid,
  p_employees jsonb,
  p_changes   jsonb,
  p_locations jsonb,
  p_stats     jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_status public.employee_sync_run_status;
  v_created integer := 0;
  v_updated integer := 0;
  v_missing integer := 0;
  v_changes integer := 0;
  v_expected_changes integer;
begin
  select r.status into v_status
    from public.employee_sync_runs r
   where r.id = p_run_id
   for update;

  if not found then
    return jsonb_build_object('status', 'unknown_run');
  end if;
  if v_status <> 'running' then
    return jsonb_build_object('status', 'not_running', 'runStatus', v_status);
  end if;

  if jsonb_typeof(p_employees) <> 'array'
     or jsonb_typeof(p_changes) <> 'array'
     or jsonb_typeof(p_locations) <> 'array'
     or jsonb_typeof(p_stats) <> 'object' then
    raise exception 'employee_sync_commit_run: malformed payload'
      using errcode = 'invalid_parameter_value';
  end if;

  /* ---- 1. upsert every employee in the read ---- */
  with incoming as (
    select *
      from jsonb_to_recordset(p_employees) as e(
        external_employee_id      text,
        first_name                text,
        last_name                 text,
        preferred_name            text,
        work_email                text,
        employment_status         public.employee_employment_status,
        hire_date                 date,
        termination_date          date,
        position_id               text,
        position_name             text,
        primary_woven_location_id text,
        primary_location_name     text,
        woven_location_ids        text[],
        location_affiliations     jsonb,
        affiliations_verified     boolean,
        source_updated_at         timestamptz,
        data_issues               text[],
        record_hash               text
      )
  ),
  written as (
    insert into public.employee_access_directory as d (
      source_system, external_employee_id,
      first_name, last_name, preferred_name, work_email,
      employment_status, hire_date, termination_date,
      position_id, position_name,
      primary_woven_location_id, primary_location_name,
      woven_location_ids, location_affiliations, affiliations_verified_at,
      source_updated_at, data_issues, record_hash,
      first_seen_run_id, last_seen_run_id,
      first_seen_at, last_seen_at, content_changed_at, missing_sync_count
    )
    select
      'woven', i.external_employee_id,
      i.first_name, i.last_name, i.preferred_name, i.work_email,
      coalesce(i.employment_status, 'unknown'), i.hire_date, i.termination_date,
      i.position_id, i.position_name,
      i.primary_woven_location_id, i.primary_location_name,
      coalesce(i.woven_location_ids, '{}'), coalesce(i.location_affiliations, '[]'::jsonb),
      case when i.affiliations_verified then now() end,
      i.source_updated_at, coalesce(i.data_issues, '{}'), i.record_hash,
      p_run_id, p_run_id,
      now(), now(), now(), 0
    from incoming i
    on conflict (source_system, external_employee_id) do update set
      first_name                = excluded.first_name,
      last_name                 = excluded.last_name,
      preferred_name            = excluded.preferred_name,
      work_email                = excluded.work_email,
      employment_status         = excluded.employment_status,
      hire_date                 = excluded.hire_date,
      termination_date          = excluded.termination_date,
      position_id               = excluded.position_id,
      position_name             = excluded.position_name,
      primary_woven_location_id = excluded.primary_woven_location_id,
      primary_location_name     = excluded.primary_location_name,
      woven_location_ids        = excluded.woven_location_ids,
      location_affiliations     = excluded.location_affiliations,
      affiliations_verified_at  = coalesce(excluded.affiliations_verified_at, d.affiliations_verified_at),
      source_updated_at         = excluded.source_updated_at,
      data_issues               = excluded.data_issues,
      content_changed_at        = case when d.record_hash is distinct from excluded.record_hash
                                       then now() else d.content_changed_at end,
      record_hash               = excluded.record_hash,
      last_seen_run_id          = p_run_id,
      last_seen_at              = now(),
      missing_sync_count        = 0
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_created, v_updated
    from written;

  /* ---- 2. everyone on file who was NOT in the read: kept, and counted ---- */
  update public.employee_access_directory d
     set missing_sync_count = d.missing_sync_count + 1
   where d.source_system = 'woven'
     and d.last_seen_run_id is distinct from p_run_id;
  get diagnostics v_missing = row_count;

  /* ---- 3. the changes, each tied to its employee row ---- */
  v_expected_changes := jsonb_array_length(p_changes);

  insert into public.employee_directory_changes (
    employee_id, sync_run_id, change_kind, from_value, to_value, details
  )
  select d.id, p_run_id, c.change_kind, c.from_value, c.to_value, coalesce(c.details, '{}'::jsonb)
    from jsonb_to_recordset(p_changes) as c(
      external_employee_id text,
      change_kind          public.employee_directory_change_kind,
      from_value           jsonb,
      to_value             jsonb,
      details              jsonb
    )
    join public.employee_access_directory d
      on d.source_system = 'woven'
     and d.external_employee_id = c.external_employee_id;
  get diagnostics v_changes = row_count;

  if v_changes <> v_expected_changes then
    raise exception 'employee_sync_commit_run: % change(s) name no employee in the directory',
      v_expected_changes - v_changes
      using errcode = 'foreign_key_violation';
  end if;

  /* ---- 4. queue any new location for review; never touch a mapping ---- */
  insert into public.woven_location_map as m (woven_location_id, woven_location_name, first_seen_run_id)
  select l.woven_location_id, l.woven_location_name, p_run_id
    from jsonb_to_recordset(p_locations) as l(woven_location_id text, woven_location_name text)
   where l.woven_location_id is not null
  on conflict (woven_location_id) do update set
    last_seen_at        = now(),
    woven_location_name = coalesce(excluded.woven_location_name, m.woven_location_name);

  /* ---- 5. close the run ---- */
  update public.employee_sync_runs r
     set status                   = 'succeeded',
         finished_at              = now(),
         requests_made            = coalesce((p_stats ->> 'requests_made')::integer, 0),
         pages_fetched            = coalesce((p_stats ->> 'pages_fetched')::integer, 0),
         employees_received       = coalesce((p_stats ->> 'employees_received')::integer, 0),
         employees_active         = coalesce((p_stats ->> 'employees_active')::integer, 0),
         employees_terminated     = coalesce((p_stats ->> 'employees_terminated')::integer, 0),
         employees_status_unknown = coalesce((p_stats ->> 'employees_status_unknown')::integer, 0),
         employees_unchanged      = coalesce((p_stats ->> 'employees_unchanged')::integer, 0),
         details_fetched          = coalesce((p_stats ->> 'details_fetched')::integer, 0),
         details_skipped          = coalesce((p_stats ->> 'details_skipped')::integer, 0),
         records_rejected         = coalesce((p_stats ->> 'records_rejected')::integer, 0),
         unmapped_locations       = coalesce((p_stats ->> 'unmapped_locations')::integer, 0),
         issue_counts             = coalesce(p_stats -> 'issue_counts', '{}'::jsonb),
         employees_created        = v_created,
         employees_updated        = v_updated,
         employees_missing        = v_missing,
         changes_recorded         = v_changes
   where r.id = p_run_id;

  return jsonb_build_object(
    'status',  'committed',
    'created', v_created,
    'updated', v_updated,
    'missing', v_missing,
    'changes', v_changes
  );
end;
$$;

/* Closes a run that failed or was refused. Touches nothing but the run row. */
create or replace function public.employee_sync_abandon_run(
  p_run_id       uuid,
  p_status       public.employee_sync_run_status,
  p_error_code   text,
  p_error_detail text,
  p_stats        jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_status not in ('failed', 'rejected') then
    raise exception 'employee_sync_abandon_run: status must be failed or rejected'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.employee_sync_runs r
     set status             = p_status,
         finished_at        = now(),
         error_code         = coalesce(nullif(p_error_code, ''), 'unspecified'),
         error_detail       = left(p_error_detail, 500),
         requests_made      = coalesce((p_stats ->> 'requests_made')::integer, r.requests_made),
         pages_fetched      = coalesce((p_stats ->> 'pages_fetched')::integer, r.pages_fetched),
         employees_received = coalesce((p_stats ->> 'employees_received')::integer, r.employees_received),
         employees_active   = coalesce((p_stats ->> 'employees_active')::integer, r.employees_active),
         records_rejected   = coalesce((p_stats ->> 'records_rejected')::integer, r.records_rejected),
         issue_counts       = coalesce(p_stats -> 'issue_counts', r.issue_counts)
   where r.id = p_run_id
     and r.status = 'running';
  get diagnostics v_rows = row_count;

  return jsonb_build_object('status', case when v_rows = 1 then 'closed' else 'not_running' end);
end;
$$;

/*
 * A PERSON's decision about one Woven location: map it to a salon (by the
 * salon number people already use), mark it ignored, or send it back to
 * unmapped. Not called by the sync. Changes nothing but the map row.
 */
create or replace function public.woven_location_map_review(
  p_woven_location_id text,
  p_status            public.woven_location_map_status,
  p_salon_number      text,
  p_reviewed_by       text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_salon uuid;
  v_rows integer;
begin
  if length(btrim(coalesce(p_reviewed_by, ''))) = 0 then
    return jsonb_build_object('status', 'reviewer_required');
  end if;

  if p_status = 'mapped' then
    select s.id into v_salon from public.salons s where s.salon_number = p_salon_number;
    if v_salon is null then
      return jsonb_build_object('status', 'unknown_salon');
    end if;
  end if;

  update public.woven_location_map m
     set status      = p_status,
         salon_id    = case when p_status = 'mapped' then v_salon end,
         reviewed_by = left(p_reviewed_by, 120),
         reviewed_at = now()
   where m.woven_location_id = p_woven_location_id;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('status', case when v_rows = 1 then 'reviewed' else 'unknown_location' end);
end;
$$;

revoke all on function public.employee_directory_changes_guard() from public, anon, authenticated;
revoke all on function public.employee_sync_claim_run(text) from public, anon, authenticated;
revoke all on function public.employee_sync_commit_run(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.employee_sync_abandon_run(uuid, public.employee_sync_run_status, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.woven_location_map_review(text, public.woven_location_map_status, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- views ----

/* The last run and the last SUCCESSFUL run, which are often not the same row. */
create or replace view public.employee_sync_status
with (security_invoker = true) as
select
  'woven'::text as source_system,
  (select r.id from public.employee_sync_runs r
    where r.source_system = 'woven' order by r.started_at desc limit 1) as last_run_id,
  (select r.status from public.employee_sync_runs r
    where r.source_system = 'woven' order by r.started_at desc limit 1) as last_run_status,
  (select r.started_at from public.employee_sync_runs r
    where r.source_system = 'woven' order by r.started_at desc limit 1) as last_run_started_at,
  (select r.error_code from public.employee_sync_runs r
    where r.source_system = 'woven' order by r.started_at desc limit 1) as last_run_error_code,
  (select r.id from public.employee_sync_runs r
    where r.source_system = 'woven' and r.status = 'succeeded' order by r.started_at desc limit 1) as last_success_run_id,
  (select r.finished_at from public.employee_sync_runs r
    where r.source_system = 'woven' and r.status = 'succeeded' order by r.started_at desc limit 1) as last_success_at,
  (select count(*) from public.woven_location_map m where m.status = 'unmapped') as unmapped_locations,
  (select count(*) from public.employee_directory_changes c where c.review_status = 'unreviewed') as unreviewed_changes;

/*
 * WHICH DIRECTORY ROWS SHARE AN EMAIL WITH AN ASK SUNNY LOGIN — for review.
 *
 * Read-only. It GRANTS NOTHING and LINKS NOTHING: it is a question a person
 * can ask before anybody decides whether logins should ever follow Woven.
 * A duplicate work email is shown as such and never resolved by picking one.
 */
create or replace view public.employee_directory_login_matches
with (security_invoker = true) as
select
  d.id                    as employee_id,
  d.external_employee_id,
  d.employment_status,
  d.work_email,
  u.id                    as app_user_id,
  u.role                  as app_user_role,
  u.status                as app_user_status,
  ('duplicate_work_email' = any (d.data_issues)) as email_is_duplicated
from public.employee_access_directory d
join public.app_users u
  on lower(u.email) = d.work_email
where d.work_email is not null;

revoke all on public.employee_sync_status from public, anon, authenticated;
revoke all on public.employee_directory_login_matches from public, anon, authenticated;

comment on view public.employee_sync_status is
  'Last Woven sync run, last successful run, unmapped locations and unreviewed changes. Server-only.';
comment on view public.employee_directory_login_matches is
  'Woven employees whose work email matches an Ask Sunny login. Read-only, for review; grants and links nothing.';
