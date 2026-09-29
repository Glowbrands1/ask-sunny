-- ---------------------------------------------------------------------------
-- WOVEN EMPLOYEE DIRECTORY — a read-only copy of who works where, and what moved
--
-- NOT APPLIED. Revised in place on 29 September 2026 against the official Woven
-- OpenAPI 3 export, before its first application anywhere: Ask Sunny Dev
-- (`rbkylaavthsjepsczccv`) is the only Supabase project, it has no branches,
-- and this version is absent from its migration history. It is applied only
-- with explicit approval, verbatim, in one transaction — and because Production
-- reads that project, applying it IS a production change.
--
-- WHAT THIS CREATES, and nothing else:
--
--   employee_sync_runs              one row per sync attempt; the run lock
--   employee_access_directory       one row per Woven employee, keyed on
--                                   (source_system, external_employee_id)
--   employee_location_affiliations  one row per employee × Woven location
--   employee_directory_changes      append-only history of what changed, per run
--   woven_location_map              Woven location → Ask Sunny salon, reviewed
--                                   by a person, never inferred
--   woven_position_map              Woven PositionID → Ask Sunny role and scope,
--                                   reviewed by a person, applied to nobody
--   seven enums, one payload type, three functions the sync calls (claim,
--   commit, abandon), two reviewer functions, one append-only guard trigger,
--   and five read-only views
--
-- WHAT THIS DOES NOT CHANGE — the phase-one boundary:
--
--   `app_users`, `app_user_audit`, `auth.users`, every existing role, scope,
--   policy, grant and function are untouched. Nothing here has a foreign key
--   to `app_users` or `auth.users`, no trigger fires on them, and no function
--   reads or writes them. Two read-only views JOIN `app_users` to SHOW what a
--   later phase would do; they grant, link and change nothing. A terminated
--   employee is RECORDED as terminated; their Ask Sunny login is not disabled.
--   A position mapping is a LABEL; it sets nobody's role or scope.
--
--   `docs/HANDOFF.md` says "There is no employee directory, and none should be
--   invented." This file is the deliberate, approved exception to that rule:
--   the directory is sourced from Woven, not invented, and it is observation
--   only in this phase.
--
-- ACCESS: every table has RLS enabled AND forced with no policies, and every
-- privilege revoked from `anon` and `authenticated`. Only the server, under the
-- secret key, reads or writes any of it. Every function and view is revoked
-- from `public`, `anon` and `authenticated` — all three, per HANDOFF §3.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ enums ---

do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_employment_status') then
    create type public.employee_employment_status as enum (
      'active',
      'terminated',
      /* A Woven Status integer not (yet) resolved to either. NEVER read as terminated. */
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

  if not exists (select 1 from pg_type where typname = 'employee_sync_source_mode') then
    create type public.employee_sync_source_mode as enum (
      /* The Vercel cron route. */
      'scheduled_poll',
      /* An administrator's run from the admin screen or route. */
      'manual_poll',
      /* RESERVED. Woven documents no employee webhook trigger; nothing writes this yet. */
      'webhook'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'employee_directory_change_kind') then
    create type public.employee_directory_change_kind as enum (
      'new_employee',
      'terminated',
      'reactivated',
      /* NOT a promotion. `classification` says more only when the position map proves it. */
      'position_changed',
      /* A move of home salon. */
      'primary_location_changed',
      'location_access_added',
      'location_access_removed',
      'email_changed',
      /* Absent from consecutive syncs. Recorded, never acted on. */
      'missing_from_source'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'employee_location_access_type') then
    create type public.employee_location_access_type as enum (
      /* Equals the employee's PrimaryLocationID. */
      'primary',
      /* Any other location in Woven's Locations[] with no ExpiresOn. */
      'additional',
      /*
       * A location in Locations[] that carries an ExpiresOn. DELIBERATELY NOT
       * called "borrowed": Woven's borrow feature sets an ExpiresOn, but the
       * spec does not say every ExpiresOn is a borrow. Needs live validation.
       */
      'temporary_or_expiring_access'
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

  if not exists (select 1 from pg_type where typname = 'woven_position_map_status') then
    create type public.woven_position_map_status as enum (
      'unmapped',
      /* A person chose the Ask Sunny role and default scope level. */
      'mapped',
      /* A person confirmed the position needs no Ask Sunny role. */
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

  source_mode public.employee_sync_source_mode not null default 'manual_poll',

  status public.employee_sync_run_status not null default 'running',

  requests_made            integer not null default 0 check (requests_made >= 0),
  pages_fetched            integer not null default 0 check (pages_fetched >= 0),
  employees_received       integer not null default 0 check (employees_received >= 0),
  employees_active         integer not null default 0 check (employees_active >= 0),
  employees_terminated     integer not null default 0 check (employees_terminated >= 0),
  employees_status_unknown integer not null default 0 check (employees_status_unknown >= 0),
  employees_created        integer not null default 0 check (employees_created >= 0),
  /* Existing employees whose allowlisted content CHANGED. Seen-but-identical is `employees_unchanged`. */
  employees_updated        integer not null default 0 check (employees_updated >= 0),
  employees_unchanged      integer not null default 0 check (employees_unchanged >= 0),
  /* On file but absent from this read. They are kept; their miss count rises. */
  employees_missing        integer not null default 0 check (employees_missing >= 0),
  details_fetched          integer not null default 0 check (details_fetched >= 0),
  details_skipped          integer not null default 0 check (details_skipped >= 0),
  records_rejected         integer not null default 0 check (records_rejected >= 0),
  changes_recorded         integer not null default 0 check (changes_recorded >= 0),
  unmapped_locations       integer not null default 0 check (unmapped_locations >= 0),
  unmapped_positions       integer not null default 0 check (unmapped_positions >= 0),

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
  /* Woven's EmployeeID. The stable identity — never the email, never the name. */
  external_employee_id text not null
    check (external_employee_id ~ '^[A-Za-z0-9._:-]{1,64}$'),

  /* ---- the allowlist. There is no column for anything outside it. ---- */
  /* Woven's EmployeeLoginID and ExternalHRISID: cross-references, never access inputs. */
  employee_login_id text check (employee_login_id is null or employee_login_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  external_hris_id  text check (external_hris_id is null or length(external_hris_id) <= 64),

  first_name           text check (first_name is null or length(first_name) <= 120),
  last_name            text check (last_name is null or length(last_name) <= 120),
  preferred_first_name text check (preferred_first_name is null or length(preferred_first_name) <= 120),

  /*
   * Woven's `EmailAddress`, AS WOVEN PROVIDES IT (trimmed). Woven has no
   * separate work-email field, so this may be a personal address. Whether an
   * address is eligible to sign in is a SEPARATE, configurable rule applied
   * where eligibility is decided — never here. Not unique: duplicates are
   * flagged, not resolved. Matched case-insensitively through the index below.
   */
  email_address text
    check (email_address is null or (length(email_address) <= 254 and email_address = btrim(email_address) and email_address ~ '^[^@[:space:]]+@[^@[:space:]]+$')),

  employment_status public.employee_employment_status not null default 'unknown',
  /* Woven's raw `Status` integer, kept so a later enum resolution can be audited. */
  employment_status_code integer,

  hire_date                   date,
  start_date                  date,
  termination_date            date,
  termination_last_day_worked date,
  /* Woven's `TerminationType` integer. TerminationReason and TerminatedAllowRehire are NOT kept. */
  termination_type_code       integer,

  position_id   text check (position_id is null or position_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  position_name text check (position_name is null or length(position_name) <= 160),
  primary_woven_location_id text
    check (primary_woven_location_id is null or primary_woven_location_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  primary_location_name text check (primary_location_name is null or length(primary_location_name) <= 160),

  /* Woven's own flags. Informational: none of them decides Ask Sunny access. */
  has_multiple_location_access boolean,
  has_all_location_access      boolean,
  woven_login_allowed          boolean,

  /*
   * The ACTIVE Woven location ids for this employee, primary included, derived
   * by `employee_sync_commit_run` from `employee_location_affiliations` — kept
   * here only so filtering by location is one indexed predicate.
   */
  woven_location_ids text[] not null default '{}',
  /* When the affiliation list was last read in full. Null: only the primary is known. */
  affiliations_verified_at timestamptz,

  /* Data-quality CODES (missing_email, duplicate_email, unmapped_location, …). */
  data_issues text[] not null default '{}',

  /* sha256 of the allowlisted fields, so an unchanged employee is cheap to recognise. */
  record_hash text not null check (record_hash ~ '^[0-9a-f]{64}$'),

  first_seen_run_id uuid references public.employee_sync_runs (id) on delete set null,
  last_seen_run_id  uuid references public.employee_sync_runs (id) on delete set null,
  first_seen_at      timestamptz not null default now(),
  /* The last successful read that CONTAINED this employee. */
  last_seen_at       timestamptz not null default now(),
  /* The last successful run that EVALUATED this employee, present or missing. */
  last_synced_at     timestamptz not null default now(),
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

create index if not exists employee_access_directory_email
  on public.employee_access_directory (lower(email_address))
  where email_address is not null;
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
  'One row per Woven employee, keyed on (source_system, external_employee_id). An allowlisted, read-only copy: no pay, DOB, phone, address, HR document, note, termination reason or rehire column exists. Never deleted; absence raises missing_sync_count. Phase one: read by nothing that grants access, and linked to no login.';
comment on column public.employee_access_directory.missing_sync_count is
  'Consecutive syncs this employee did not appear in. Never read as termination; only an explicit terminated status from Woven records one.';
comment on column public.employee_access_directory.email_address is
  'Woven EmailAddress as provided (trimmed). May be personal. Login eligibility is a separate configurable rule and is never inferred from this column alone.';

-- ------------------------------------------------- location affiliations ---

create table if not exists public.employee_location_affiliations (
  id uuid primary key default extensions.gen_random_uuid(),

  employee_id uuid not null references public.employee_access_directory (id) on delete restrict,
  woven_location_id text not null
    check (woven_location_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  location_name   text check (location_name is null or length(location_name) <= 160),
  location_number text check (location_number is null or length(location_number) <= 50),

  is_primary  boolean not null default false,
  access_type public.employee_location_access_type not null,
  /* Woven's ExpiresOn, when stated. */
  expires_on  date,

  /* False once a FULL read no longer lists it. The row is never deleted. */
  active   boolean not null default true,
  ended_at timestamptz,

  first_seen_run_id uuid references public.employee_sync_runs (id) on delete set null,
  last_seen_run_id  uuid references public.employee_sync_runs (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employee_location_affiliations_identity unique (employee_id, woven_location_id),
  constraint employee_location_affiliations_primary_agrees
    check (is_primary = (access_type = 'primary')),
  constraint employee_location_affiliations_active_agrees
    check (active = (ended_at is null))
);

drop trigger if exists employee_location_affiliations_touch_updated_at on public.employee_location_affiliations;
create trigger employee_location_affiliations_touch_updated_at
  before update on public.employee_location_affiliations
  for each row execute function public.touch_updated_at();

/* One active primary per employee, as a constraint. */
create unique index if not exists employee_location_affiliations_one_primary
  on public.employee_location_affiliations (employee_id)
  where is_primary and active;
create index if not exists employee_location_affiliations_location
  on public.employee_location_affiliations (woven_location_id)
  where active;

alter table public.employee_location_affiliations enable row level security;
alter table public.employee_location_affiliations force row level security;
revoke all on table public.employee_location_affiliations from anon, authenticated;

comment on table public.employee_location_affiliations is
  'One row per Woven employee × Woven location. primary / additional / temporary_or_expiring_access (an ExpiresOn is present; whether that always means "borrowed" awaits live validation). Deactivated, never deleted, and only on a full read. Grants no Ask Sunny salon access.';

-- --------------------------------------------------------- change history ---

create table if not exists public.employee_directory_changes (
  id uuid primary key default extensions.gen_random_uuid(),

  employee_id uuid not null references public.employee_access_directory (id) on delete restrict,
  sync_run_id uuid not null references public.employee_sync_runs (id) on delete restrict,

  change_kind public.employee_directory_change_kind not null,
  /* The directory column (or `location:<woven id>`) the change is about, when there is one. */
  field_name text check (field_name is null or field_name ~ '^[a-z][a-z0-9_]{0,63}(:[A-Za-z0-9._:-]{1,64})?$'),
  /* The before and after of the fields that changed, and only those. */
  from_value jsonb,
  to_value   jsonb,
  /*
   * A CODE: new_hire, newly_visible, initial_load, rehire, unclassified,
   * promotion_confirmed, demotion_confirmed, lateral, transfer, assigned,
   * additional, temporary_or_expiring_access, expired, removed. A position
   * change is `unclassified` unless the confirmed position map proves otherwise.
   */
  classification text check (classification is null or classification ~ '^[a-z][a-z0-9_]{0,63}$'),
  /* Only a date Woven itself states (hire, termination, ExpiresOn). Never invented. */
  effective_date date,
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
 * NO CHANGE IS RECORDED TWICE. Re-running a sync is already idempotent — a
 * change is emitted only against the stored state, which moves in the same
 * transaction — and this index makes a duplicate inside one run a refused
 * commit rather than a second row.
 */
create unique index if not exists employee_directory_changes_once
  on public.employee_directory_changes (
    employee_id, sync_run_id, change_kind, coalesce(field_name, ''), md5(coalesce(to_value::text, ''))
  );

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

  if new.employee_id     is distinct from old.employee_id
     or new.sync_run_id    is distinct from old.sync_run_id
     or new.change_kind    is distinct from old.change_kind
     or new.field_name     is distinct from old.field_name
     or new.from_value     is distinct from old.from_value
     or new.to_value       is distinct from old.to_value
     or new.classification is distinct from old.classification
     or new.effective_date is distinct from old.effective_date
     or new.details        is distinct from old.details
     or new.detected_at    is distinct from old.detected_at then
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
  'Append-only history of what changed for a Woven employee between syncs. A position change is never labelled a promotion unless the confirmed position map proves it. Recording a change grants, removes or alters no Ask Sunny access.';

-- ----------------------------------------------------- Woven location map ---

create table if not exists public.woven_location_map (
  id uuid primary key default extensions.gen_random_uuid(),

  woven_location_id text not null unique
    check (woven_location_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  woven_location_name text check (woven_location_name is null or length(woven_location_name) <= 160),

  /* The catalog, from GET /locations. Refreshed every run; never decides a mapping. */
  woven_display_name    text check (woven_display_name is null or length(woven_display_name) <= 160),
  woven_location_number text check (woven_location_number is null or length(woven_location_number) <= 50),
  woven_district_id     text check (woven_district_id is null or woven_district_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  woven_district_name   text check (woven_district_name is null or length(woven_district_name) <= 160),
  woven_region_id       text check (woven_region_id is null or woven_region_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  woven_region_name     text check (woven_region_name is null or length(woven_region_name) <= 160),
  is_closed       boolean,
  is_non_location boolean,

  /*
   * A SUGGESTION ONLY: the salon whose `salon_number` equals the Woven Number
   * exactly (leading zeros included). Recomputed each run. A person still
   * decides — the Google store codes proved numbers across systems collide.
   */
  suggested_salon_id uuid references public.salons (id) on delete set null,

  status public.woven_location_map_status not null default 'unmapped',
  /*
   * The Ask Sunny salon, set by a PERSON through `woven_location_map_review`.
   * A Woven location id is not a salon number, and a name match is not proof.
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
  'Woven location id → Ask Sunny salon. Every location the sync sees is queued here as unmapped, with Woven''s catalog fields and an exact-number suggestion; only a person maps it. The sync never overwrites a mapping and never fails because a location is unmapped.';

-- ----------------------------------------------------- Woven position map ---

create table if not exists public.woven_position_map (
  id uuid primary key default extensions.gen_random_uuid(),

  woven_position_id text not null unique
    check (woven_position_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  woven_position_name text check (woven_position_name is null or length(woven_position_name) <= 160),

  status public.woven_position_map_status not null default 'unmapped',
  /* Chosen by a PERSON. Uses the application's own enums, so no invented role can be named. */
  ask_sunny_role        public.app_user_role,
  ask_sunny_scope_level public.app_scope_level,
  /* Higher is more senior. Two positions may share a rank. Null: no ordering claimed. */
  hierarchy_rank smallint check (hierarchy_rank is null or hierarchy_rank between 0 and 1000),

  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 120),
  reviewed_at timestamptz,
  /* Confirmed = mapped by a named person. Only a confirmed pair of ranks can classify a promotion. */
  is_confirmed boolean generated always as (status = 'mapped' and reviewed_by is not null) stored,

  first_seen_run_id uuid references public.employee_sync_runs (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint woven_position_map_mapping_agrees check (
    (status = 'mapped') = (ask_sunny_role is not null and ask_sunny_scope_level is not null)
  )
);

drop trigger if exists woven_position_map_touch_updated_at on public.woven_position_map;
create trigger woven_position_map_touch_updated_at
  before update on public.woven_position_map
  for each row execute function public.touch_updated_at();

create index if not exists woven_position_map_needs_review
  on public.woven_position_map (first_seen_at)
  where status = 'unmapped';

alter table public.woven_position_map enable row level security;
alter table public.woven_position_map force row level security;
revoke all on table public.woven_position_map from anon, authenticated;

comment on table public.woven_position_map is
  'Woven PositionID → Ask Sunny role, default scope level and hierarchy rank, set by a person. Queued by the sync as unmapped. In phase one it LABELS changes only: nothing reads it to set a role, scope or salon access.';

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
    insert into public.employee_sync_runs (source_system, requested_by, source_mode)
    values (
      'woven',
      p_requested_by,
      case when p_requested_by = 'cron' then 'scheduled_poll' else 'manual_poll' end::public.employee_sync_source_mode
    )
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
 * The shape of one employee in a commit payload, so every statement below reads
 * the same typed rows with `jsonb_populate_recordset` — no temporary table, no
 * TEMP privilege, and one column list to keep in step with `store.ts`.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_sync_incoming') then
    create type public.employee_sync_incoming as (
      external_employee_id         text,
      employee_login_id            text,
      external_hris_id             text,
      first_name                   text,
      last_name                    text,
      preferred_first_name         text,
      email_address                text,
      employment_status            public.employee_employment_status,
      employment_status_code       integer,
      hire_date                    date,
      start_date                   date,
      termination_date             date,
      termination_last_day_worked  date,
      termination_type_code        integer,
      position_id                  text,
      position_name                text,
      primary_woven_location_id    text,
      primary_location_name        text,
      has_multiple_location_access boolean,
      has_all_location_access      boolean,
      woven_login_allowed          boolean,
      affiliations                 jsonb,
      data_issues                  text[],
      record_hash                  text
    );
  end if;
end
$$;

/*
 * Saves one run, ALL OR NOTHING. A function body is one transaction: if any
 * statement fails — a constraint, a change naming an unknown employee, a
 * duplicate change — every write of the run is rolled back and the run stays
 * `running` for the caller to abandon. The directory is then exactly as the
 * last good run left it.
 *
 * It never deletes a row, never changes a status it was not given, never
 * touches a location's or a position's mapping, and never reads or writes
 * `app_users`.
 *
 * p_employees[i].affiliations is an ARRAY when this run read that employee's
 * full Locations[], and NULL when it did not. Only an array can deactivate an
 * affiliation; a null keeps what is on file and only asserts the primary.
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
  v_unchanged integer := 0;
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
  with written as (
    insert into public.employee_access_directory as d (
      source_system, external_employee_id,
      employee_login_id, external_hris_id,
      first_name, last_name, preferred_first_name, email_address,
      employment_status, employment_status_code,
      hire_date, start_date, termination_date, termination_last_day_worked, termination_type_code,
      position_id, position_name,
      primary_woven_location_id, primary_location_name,
      has_multiple_location_access, has_all_location_access, woven_login_allowed,
      affiliations_verified_at, data_issues, record_hash,
      first_seen_run_id, last_seen_run_id,
      first_seen_at, last_seen_at, last_synced_at, content_changed_at, missing_sync_count
    )
    select
      'woven', i.external_employee_id,
      i.employee_login_id, i.external_hris_id,
      i.first_name, i.last_name, i.preferred_first_name, i.email_address,
      coalesce(i.employment_status, 'unknown'), i.employment_status_code,
      i.hire_date, i.start_date, i.termination_date, i.termination_last_day_worked, i.termination_type_code,
      i.position_id, i.position_name,
      i.primary_woven_location_id, i.primary_location_name,
      i.has_multiple_location_access, i.has_all_location_access, i.woven_login_allowed,
      case when jsonb_typeof(i.affiliations) = 'array' then now() end,
      coalesce(i.data_issues, '{}'), i.record_hash,
      p_run_id, p_run_id,
      now(), now(), now(), now(), 0
    from jsonb_populate_recordset(null::public.employee_sync_incoming, p_employees) i
    on conflict (source_system, external_employee_id) do update set
      employee_login_id            = excluded.employee_login_id,
      external_hris_id             = excluded.external_hris_id,
      first_name                   = excluded.first_name,
      last_name                    = excluded.last_name,
      preferred_first_name         = excluded.preferred_first_name,
      email_address                = excluded.email_address,
      employment_status            = excluded.employment_status,
      employment_status_code       = excluded.employment_status_code,
      hire_date                    = excluded.hire_date,
      start_date                   = excluded.start_date,
      termination_date             = excluded.termination_date,
      termination_last_day_worked  = excluded.termination_last_day_worked,
      termination_type_code        = excluded.termination_type_code,
      position_id                  = excluded.position_id,
      position_name                = excluded.position_name,
      primary_woven_location_id    = excluded.primary_woven_location_id,
      primary_location_name        = excluded.primary_location_name,
      has_multiple_location_access = excluded.has_multiple_location_access,
      has_all_location_access      = excluded.has_all_location_access,
      woven_login_allowed          = excluded.woven_login_allowed,
      affiliations_verified_at     = coalesce(excluded.affiliations_verified_at, d.affiliations_verified_at),
      data_issues                  = excluded.data_issues,
      content_changed_at           = case when d.record_hash is distinct from excluded.record_hash
                                          then now() else d.content_changed_at end,
      record_hash                  = excluded.record_hash,
      last_seen_run_id             = p_run_id,
      last_seen_at                 = now(),
      last_synced_at               = now(),
      missing_sync_count           = 0
    /* now() is the transaction's instant, so "changed in THIS run" is exact. */
    returning (xmax = 0) as inserted, (content_changed_at = now()) as changed
  )
  select count(*) filter (where inserted),
         count(*) filter (where not inserted and changed),
         count(*) filter (where not inserted and not changed)
    into v_created, v_updated, v_unchanged
    from written;

  /* ---- 2. everyone on file who was NOT in the read: kept, and counted ---- */
  update public.employee_access_directory d
     set missing_sync_count = d.missing_sync_count + 1,
         last_synced_at     = now()
   where d.source_system = 'woven'
     and d.last_seen_run_id is distinct from p_run_id;
  get diagnostics v_missing = row_count;

  /* ---- 3. location affiliations ---- */

  /* 3a. A primary that is no longer the primary steps down (still active until a full read says otherwise). */
  update public.employee_location_affiliations a
     set is_primary  = false,
         access_type = 'additional'
    from jsonb_populate_recordset(null::public.employee_sync_incoming, p_employees) i
    join public.employee_access_directory d
      on d.source_system = 'woven' and d.external_employee_id = i.external_employee_id
   where a.employee_id = d.id
     and a.is_primary
     and a.woven_location_id is distinct from i.primary_woven_location_id;

  /* 3b. Full reads: upsert every listed location. */
  insert into public.employee_location_affiliations as a (
    employee_id, woven_location_id, location_name, location_number,
    is_primary, access_type, expires_on, active, ended_at,
    first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
  )
  select d.id, l.woven_location_id, l.location_name, l.location_number,
         l.access_type = 'primary', l.access_type, l.expires_on, true, null,
         p_run_id, p_run_id, now(), now()
    from jsonb_populate_recordset(null::public.employee_sync_incoming, p_employees) i
    join public.employee_access_directory d
      on d.source_system = 'woven' and d.external_employee_id = i.external_employee_id
    cross join lateral jsonb_to_recordset(i.affiliations) as l(
      woven_location_id text,
      location_name     text,
      location_number   text,
      access_type       public.employee_location_access_type,
      expires_on        date
    )
   where jsonb_typeof(i.affiliations) = 'array'
  on conflict (employee_id, woven_location_id) do update set
    location_name    = excluded.location_name,
    location_number  = excluded.location_number,
    is_primary       = excluded.is_primary,
    access_type      = excluded.access_type,
    expires_on       = excluded.expires_on,
    active           = true,
    ended_at         = null,
    last_seen_run_id = p_run_id,
    last_seen_at     = now();

  /* 3c. Full reads: anything active but not listed has ended. Never on a partial read. */
  update public.employee_location_affiliations a
     set active = false,
         ended_at = now(),
         is_primary = false,
         access_type = case when a.access_type = 'primary' then 'additional' else a.access_type end
    from jsonb_populate_recordset(null::public.employee_sync_incoming, p_employees) i
    join public.employee_access_directory d
      on d.source_system = 'woven' and d.external_employee_id = i.external_employee_id
   where a.employee_id = d.id
     and a.active
     and jsonb_typeof(i.affiliations) = 'array'
     and not exists (
       select 1 from jsonb_to_recordset(i.affiliations) as l(woven_location_id text)
        where l.woven_location_id = a.woven_location_id
     );

  /* 3d. Partial reads: the list endpoint still states the primary, so assert it. */
  insert into public.employee_location_affiliations as a (
    employee_id, woven_location_id, location_name,
    is_primary, access_type, active, ended_at,
    first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
  )
  select d.id, i.primary_woven_location_id, i.primary_location_name,
         true, 'primary', true, null,
         p_run_id, p_run_id, now(), now()
    from jsonb_populate_recordset(null::public.employee_sync_incoming, p_employees) i
    join public.employee_access_directory d
      on d.source_system = 'woven' and d.external_employee_id = i.external_employee_id
   where jsonb_typeof(i.affiliations) is distinct from 'array'
     and i.primary_woven_location_id is not null
  on conflict (employee_id, woven_location_id) do update set
    location_name    = coalesce(excluded.location_name, a.location_name),
    is_primary       = true,
    access_type      = 'primary',
    expires_on       = null,
    active           = true,
    ended_at         = null,
    last_seen_run_id = p_run_id,
    last_seen_at     = now();

  /* 3e. The directory's filter array follows the table. */
  update public.employee_access_directory d
     set woven_location_ids = coalesce((
           select array_agg(a.woven_location_id order by a.is_primary desc, a.woven_location_id)
             from public.employee_location_affiliations a
            where a.employee_id = d.id and a.active
         ), '{}')
   where d.last_seen_run_id = p_run_id;

  /* ---- 4. the changes, each tied to its employee row ---- */
  v_expected_changes := jsonb_array_length(p_changes);

  insert into public.employee_directory_changes (
    employee_id, sync_run_id, change_kind, field_name,
    from_value, to_value, classification, effective_date, details
  )
  select d.id, p_run_id, c.change_kind, c.field_name,
         c.from_value, c.to_value, c.classification, c.effective_date, coalesce(c.details, '{}'::jsonb)
    from jsonb_to_recordset(p_changes) as c(
      external_employee_id text,
      change_kind          public.employee_directory_change_kind,
      field_name           text,
      from_value           jsonb,
      to_value             jsonb,
      classification       text,
      effective_date       date,
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

  /* ---- 5. the location catalog: queue new ones, refresh facts, never touch a mapping ---- */
  insert into public.woven_location_map as m (
    woven_location_id, woven_location_name, woven_display_name, woven_location_number,
    woven_district_id, woven_district_name, woven_region_id, woven_region_name,
    is_closed, is_non_location, suggested_salon_id, first_seen_run_id
  )
  select l.woven_location_id, l.woven_location_name, l.woven_display_name, l.woven_location_number,
         l.woven_district_id, l.woven_district_name, l.woven_region_id, l.woven_region_name,
         l.is_closed, l.is_non_location,
         (select s.id from public.salons s where s.salon_number = l.woven_location_number),
         p_run_id
    from jsonb_to_recordset(p_locations) as l(
      woven_location_id     text,
      woven_location_name   text,
      woven_display_name    text,
      woven_location_number text,
      woven_district_id     text,
      woven_district_name   text,
      woven_region_id       text,
      woven_region_name     text,
      is_closed             boolean,
      is_non_location       boolean
    )
   where l.woven_location_id is not null
  on conflict (woven_location_id) do update set
    last_seen_at          = now(),
    woven_location_name   = coalesce(excluded.woven_location_name, m.woven_location_name),
    woven_display_name    = coalesce(excluded.woven_display_name, m.woven_display_name),
    woven_location_number = coalesce(excluded.woven_location_number, m.woven_location_number),
    woven_district_id     = coalesce(excluded.woven_district_id, m.woven_district_id),
    woven_district_name   = coalesce(excluded.woven_district_name, m.woven_district_name),
    woven_region_id       = coalesce(excluded.woven_region_id, m.woven_region_id),
    woven_region_name     = coalesce(excluded.woven_region_name, m.woven_region_name),
    is_closed             = coalesce(excluded.is_closed, m.is_closed),
    is_non_location       = coalesce(excluded.is_non_location, m.is_non_location),
    suggested_salon_id    = coalesce(excluded.suggested_salon_id, m.suggested_salon_id);

  /* ---- 6. queue every position seen; never touch a mapping ---- */
  insert into public.woven_position_map as p (woven_position_id, woven_position_name, first_seen_run_id)
  select distinct on (i.position_id) i.position_id, i.position_name, p_run_id
    from jsonb_populate_recordset(null::public.employee_sync_incoming, p_employees) i
   where i.position_id is not null
   order by i.position_id, i.position_name nulls last
  on conflict (woven_position_id) do update set
    last_seen_at        = now(),
    woven_position_name = coalesce(excluded.woven_position_name, p.woven_position_name);

  /* ---- 7. close the run ---- */
  update public.employee_sync_runs r
     set status                   = 'succeeded',
         finished_at              = now(),
         requests_made            = coalesce((p_stats ->> 'requests_made')::integer, 0),
         pages_fetched            = coalesce((p_stats ->> 'pages_fetched')::integer, 0),
         employees_received       = coalesce((p_stats ->> 'employees_received')::integer, 0),
         employees_active         = coalesce((p_stats ->> 'employees_active')::integer, 0),
         employees_terminated     = coalesce((p_stats ->> 'employees_terminated')::integer, 0),
         employees_status_unknown = coalesce((p_stats ->> 'employees_status_unknown')::integer, 0),
         details_fetched          = coalesce((p_stats ->> 'details_fetched')::integer, 0),
         details_skipped          = coalesce((p_stats ->> 'details_skipped')::integer, 0),
         records_rejected         = coalesce((p_stats ->> 'records_rejected')::integer, 0),
         issue_counts             = coalesce(p_stats -> 'issue_counts', '{}'::jsonb),
         employees_created        = v_created,
         employees_updated        = v_updated,
         employees_unchanged      = v_unchanged,
         employees_missing        = v_missing,
         changes_recorded         = v_changes,
         unmapped_locations       = (select count(*) from public.woven_location_map m where m.status = 'unmapped'),
         unmapped_positions       = (select count(*) from public.woven_position_map p where p.status = 'unmapped')
   where r.id = p_run_id;

  return jsonb_build_object(
    'status',    'committed',
    'created',   v_created,
    'updated',   v_updated,
    'unchanged', v_unchanged,
    'missing',   v_missing,
    'changes',   v_changes
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

/*
 * A PERSON's decision about one Woven position: its Ask Sunny role, default
 * scope level and rank; or ignored; or back to unmapped. Not called by the
 * sync. Changes nothing but the map row — in particular, no `app_users` row.
 */
create or replace function public.woven_position_map_review(
  p_woven_position_id text,
  p_status            public.woven_position_map_status,
  p_role              public.app_user_role,
  p_scope_level       public.app_scope_level,
  p_hierarchy_rank    smallint,
  p_reviewed_by       text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if length(btrim(coalesce(p_reviewed_by, ''))) = 0 then
    return jsonb_build_object('status', 'reviewer_required');
  end if;
  if p_status = 'mapped' and (p_role is null or p_scope_level is null) then
    return jsonb_build_object('status', 'role_and_scope_required');
  end if;

  update public.woven_position_map p
     set status                = p_status,
         ask_sunny_role        = case when p_status = 'mapped' then p_role end,
         ask_sunny_scope_level = case when p_status = 'mapped' then p_scope_level end,
         hierarchy_rank        = case when p_status = 'mapped' then p_hierarchy_rank end,
         reviewed_by           = left(p_reviewed_by, 120),
         reviewed_at           = now()
   where p.woven_position_id = p_woven_position_id;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('status', case when v_rows = 1 then 'reviewed' else 'unknown_position' end);
end;
$$;

revoke all on function public.employee_directory_changes_guard() from public, anon, authenticated;
revoke all on function public.employee_sync_claim_run(text) from public, anon, authenticated;
revoke all on function public.employee_sync_commit_run(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.employee_sync_abandon_run(uuid, public.employee_sync_run_status, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.woven_location_map_review(text, public.woven_location_map_status, text, text) from public, anon, authenticated;
revoke all on function public.woven_position_map_review(text, public.woven_position_map_status, public.app_user_role, public.app_scope_level, smallint, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- views ----

/* The Overview's counts. Aggregates only: no name, email or employee id. */
create or replace view public.employee_sync_status
with (security_invoker = true) as
with last_run as (
  select r.* from public.employee_sync_runs r
   where r.source_system = 'woven' order by r.started_at desc limit 1
), last_success as (
  select r.* from public.employee_sync_runs r
   where r.source_system = 'woven' and r.status = 'succeeded' order by r.started_at desc limit 1
)
select
  'woven'::text as source_system,
  (select id          from last_run) as last_run_id,
  (select status      from last_run) as last_run_status,
  (select source_mode from last_run) as last_run_source_mode,
  (select started_at  from last_run) as last_run_started_at,
  (select finished_at from last_run) as last_run_finished_at,
  (select error_code  from last_run) as last_run_error_code,
  (select id          from last_success) as last_success_run_id,
  (select finished_at from last_success) as last_success_at,
  (select count(*) from public.employee_access_directory d where d.employment_status = 'active')     as total_active,
  (select count(*) from public.employee_access_directory d where d.employment_status = 'terminated') as total_terminated,
  (select count(*) from public.employee_access_directory d where d.employment_status = 'unknown')    as total_status_unknown,
  (select count(*) from public.woven_location_map m where m.status = 'unmapped') as unmapped_locations,
  (select count(*) from public.woven_position_map p where p.status = 'unmapped') as unmapped_positions,
  (select count(*) from public.employee_directory_changes c where c.review_status = 'unreviewed') as unreviewed_changes;

/* Sync History: one row per run with its changes counted by type. Aggregates only. */
create or replace view public.employee_sync_run_summary
with (security_invoker = true) as
select
  r.id, r.source_system, r.requested_by, r.source_mode, r.status,
  r.started_at, r.finished_at,
  r.employees_received as employees_fetched,
  r.employees_created  as employees_added,
  r.employees_updated, r.employees_unchanged, r.employees_missing,
  r.details_fetched, r.details_skipped, r.records_rejected,
  r.unmapped_locations, r.unmapped_positions,
  count(c.id) filter (where c.change_kind = 'new_employee' and c.classification = 'new_hire')          as new_hires,
  count(c.id) filter (where c.change_kind = 'new_employee')                                            as new_employees,
  count(c.id) filter (where c.change_kind = 'terminated')                                              as terminations,
  count(c.id) filter (where c.change_kind = 'reactivated')                                             as reactivations,
  count(c.id) filter (where c.change_kind = 'position_changed')                                        as position_changes,
  count(c.id) filter (where c.change_kind = 'position_changed'
                        and c.classification in ('promotion_confirmed', 'demotion_confirmed'))         as confirmed_promotions_demotions,
  count(c.id) filter (where c.change_kind = 'primary_location_changed')                                as transfers,
  count(c.id) filter (where c.change_kind in ('location_access_added', 'location_access_removed'))     as location_access_changes,
  count(c.id) filter (where c.change_kind = 'email_changed')                                           as email_changes,
  r.records_rejected + case when r.status in ('failed', 'rejected') then 1 else 0 end                  as error_count,
  r.error_code, r.error_detail, r.issue_counts
from public.employee_sync_runs r
left join public.employee_directory_changes c on c.sync_run_id = r.id
group by r.id;

/* The Employee Directory tab. Contains PII: server-only, behind manage_users. */
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
  coalesce(rc.kinds, '{}') as changes_last_30_days
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
  select c.change_kind, c.detected_at from public.employee_directory_changes c
   where c.employee_id = d.id order by c.detected_at desc limit 1
) lc on true
left join lateral (
  select array_agg(distinct
           case when c.change_kind = 'new_employee' and c.classification = 'new_hire' then 'new_hire'
                else c.change_kind::text end) as kinds
    from public.employee_directory_changes c
   where c.employee_id = d.id and c.detected_at > now() - interval '30 days'
) rc on true;

/*
 * WHICH DIRECTORY ROWS SHARE AN EMAIL WITH AN ASK SUNNY LOGIN — for review.
 * Read-only. It GRANTS NOTHING and LINKS NOTHING. A duplicate email is shown
 * as such and never resolved by picking one.
 */
create or replace view public.employee_directory_login_matches
with (security_invoker = true) as
select
  d.id                    as employee_id,
  d.external_employee_id,
  d.employment_status,
  d.email_address,
  u.id                    as app_user_id,
  u.role                  as app_user_role,
  u.status                as app_user_status,
  ('duplicate_email' = any (d.data_issues)) as email_is_duplicated
from public.employee_access_directory d
join public.app_users u
  on lower(u.email) = lower(d.email_address)
where d.email_address is not null;

/*
 * WHAT A LATER PHASE WOULD DO — AND DOES NOT. One row per directory employee,
 * beside the Ask Sunny login that shares their email, if any. Every `would_*`
 * column is a QUESTION for a person; nothing reads this view to act, and the
 * phase-one code has no path that writes `app_users`.
 *
 * Email-domain eligibility is deliberately NOT here: it is a configurable rule
 * applied by the server when it reads this view.
 */
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
  /* Phase 4 question: a confirmed position maps to a different role. */
  (u.id is not null and coalesce(pm.is_confirmed, false) and u.role is distinct from pm.ask_sunny_role) as role_differs,
  /* Phase 5 question: a salon-scoped login whose salon differs from Woven's mapped primary. */
  (u.id is not null and u.scope_level = 'salon' and s.salon_number is not null
     and u.scope_primary_area_id is distinct from ('loc-' || s.salon_number)) as primary_salon_differs
from public.employee_access_directory d
left join public.woven_position_map pm on pm.woven_position_id = d.position_id
left join public.woven_location_map lm on lm.woven_location_id = d.primary_woven_location_id and lm.status = 'mapped'
left join public.salons s on s.id = lm.salon_id
left join public.app_users u on d.email_address is not null and lower(u.email) = lower(d.email_address);

revoke all on public.employee_sync_status from public, anon, authenticated;
revoke all on public.employee_sync_run_summary from public, anon, authenticated;
revoke all on public.employee_directory_view from public, anon, authenticated;
revoke all on public.employee_directory_login_matches from public, anon, authenticated;
revoke all on public.employee_access_preview from public, anon, authenticated;

comment on view public.employee_sync_status is
  'Last Woven run, last successful run, directory totals, unmapped locations and positions, unreviewed changes. Aggregates only. Server-only.';
comment on view public.employee_sync_run_summary is
  'One row per Woven sync run with changes counted by type. Aggregates only. Server-only.';
comment on view public.employee_directory_view is
  'The employee directory with affiliations, mapping state and recent changes. Contains names and emails: server-only, shown behind manage_users.';
comment on view public.employee_directory_login_matches is
  'Woven employees whose email matches an Ask Sunny login. Read-only, for review; grants and links nothing.';
comment on view public.employee_access_preview is
  'What provisioning, deactivation, role and salon-scope phases WOULD do, as questions. Read-only; nothing acts on it in phase one.';
