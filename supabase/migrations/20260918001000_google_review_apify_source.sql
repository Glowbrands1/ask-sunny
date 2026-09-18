-- ============================================================================
-- GOOGLE REVIEWS — THE APIFY SERVER-SIDE SOURCE
-- ============================================================================
--
-- Phase 1 reads reviews out of a page rendered in Brave on somebody's laptop.
-- That works, and it stops working the moment the laptop is shut. This
-- migration adds everything a SERVER-SIDE source needs and changes nothing
-- about what a review IS:
--
--   * where each of the fifteen listings lives on Google Maps, verified and
--     persisted, so a scheduled run never has to search by business name;
--   * which transport discovered a review, recorded beside it rather than
--     inside its identity, so Brave and Apify converge on ONE row;
--   * a ledger of Apify runs, which is simultaneously the concurrency lock,
--     the cost guardrail and the status panel's read model.
--
-- ============================================================================
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ============================================================================
--
-- IT DOES NOT ADD A SECOND `google_review_source`. That enum is the review's
-- IDENTITY NAMESPACE — it is half of `unique (source, external_review_id)` —
-- and Google's review id is Google's review id however it reached us. Adding
-- 'apify' there would mean the same review discovered twice becomes two rows,
-- two entries in every total, and two items in the response queue. The
-- transport is a fact about the DISCOVERY, so it is recorded in its own
-- columns, and the identity is left alone.
--
-- IT DOES NOT CHANGE THE REPORTING RULE. 3-, 4- and 5-star reviews count;
-- 1- and 2-star reviews are stored, shown and never counted. That is still a
-- generated column over the rating and no ingestion path can reach it.
--
-- IT DOES NOT CHANGE THE ANCHOR MODEL. A review still counts only where it sat
-- above its listing's anchor in a feed whose order can be trusted. Apify hands
-- us a real publication timestamp, which makes the ORDER CHECK stronger — see
-- `feedOrderLooksReliable` — but the boundary is still a position relative to a
-- known review, because that is what the manual process measures and what a
-- backlog import must not be able to disturb.

-- ---------------------------------------------- which transport found it ---
--
-- NOT AN IDENTITY. A review has one identity, `(source, external_review_id)`,
-- and it may be discovered by either transport in either order.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_ingestion_source') then
    create type public.google_review_ingestion_source as enum ('brave_extension', 'apify');
  end if;
end
$$;

comment on type public.google_review_ingestion_source is
  'HOW a review reached ASK Sunny, never WHAT it is. Deliberately separate from google_review_source, which is half of the deduplication key: the same Google review found by Brave and by Apify is one row with two discovery facts, not two rows.';

-- -------------------------------------- where a listing lives on Google ----
--
-- A SCHEDULED RUN MUST NOT SEARCH BY BUSINESS NAME.
--
-- "Sun Tan City" matches franchise locations this business does not operate,
-- and a name search that drifts one listing sideways files a stranger's
-- reviews against a real salon's leaderboard row — the exact failure the store
-- code mapping exists to prevent, arriving through a different door. So the
-- stable Google identifier is resolved ONCE, verified against the name and
-- address we expect, and persisted here. Every run afterwards addresses the
-- listing by that identifier.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_apify_source_status') then
    create type public.google_review_apify_source_status as enum (
      /* No Google identifier has been supplied for this listing yet. */
      'unconfigured',
      /* An identifier is held but has not been confirmed against Google. */
      'pending_verification',
      /* Confirmed: Google's own name and address matched what we expect. */
      'verified',
      /* Confirmed WRONG, or ambiguous. Excluded from runs until resolved. */
      'rejected'
    );
  end if;
end
$$;

alter table public.google_review_locations
  /*
   * THE STABLE GOOGLE IDENTIFIER. `ChIJ…` — Google's own Place ID, which is
   * what the Apify actor addresses a listing by. Unique, because two salons
   * pointing at one Google listing would merge two salons' reviews.
   */
  add column if not exists google_place_id text,
  /* The CID, kept when the actor or the operator supplies one. Also stable. */
  add column if not exists google_cid text,
  /*
   * The Maps URL as a person pasted it. Kept verbatim for the operator who has
   * to check this by eye; never parsed into an identifier at run time.
   */
  add column if not exists google_maps_url text,
  /*
   * WHAT GOOGLE CALLS THIS LISTING AND WHERE GOOGLE SAYS IT IS, as returned by
   * the actor at verification time. These are the evidence behind
   * `verified` — not decoration. The verification screen shows them so a
   * person can confirm that Google's "Sun Tan City" on N 3rd St really is
   * store code 306 before a single review is filed against salon 0462.
   */
  add column if not exists canonical_google_name text,
  add column if not exists canonical_google_address text,
  /*
   * WHAT WE EXPECT TO SEE, stated explicitly rather than parsed out of the
   * label. "MO Kansas City Wornall" and "NE Omaha 132nd and Maple" do not
   * decompose into a city by any rule worth trusting, and a verification step
   * whose expectations are guessed is not a verification step.
   */
  add column if not exists expected_state text,
  add column if not exists expected_city text,
  add column if not exists apify_source_status
    public.google_review_apify_source_status not null default 'unconfigured',
  add column if not exists apify_last_verified_at timestamptz,
  /* Why a listing was rejected, or what was ambiguous. Operator-facing. */
  add column if not exists apify_verification_note text;

alter table public.google_review_locations
  drop constraint if exists google_review_locations_place_id_key;
alter table public.google_review_locations
  add constraint google_review_locations_place_id_key unique (google_place_id);

alter table public.google_review_locations
  drop constraint if exists google_review_locations_place_id_format;
alter table public.google_review_locations
  add constraint google_review_locations_place_id_format
  check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{10,255}$');

alter table public.google_review_locations
  drop constraint if exists google_review_locations_cid_format;
alter table public.google_review_locations
  add constraint google_review_locations_cid_format
  check (google_cid is null or google_cid ~ '^[0-9]{6,30}$');

alter table public.google_review_locations
  drop constraint if exists google_review_locations_maps_url_format;
alter table public.google_review_locations
  add constraint google_review_locations_maps_url_format
  check (google_maps_url is null or google_maps_url ~ '^https://[^\s]{5,500}$');

alter table public.google_review_locations
  drop constraint if exists google_review_locations_state_format;
alter table public.google_review_locations
  add constraint google_review_locations_state_format
  check (expected_state is null or expected_state ~ '^[A-Z]{2}$');

/*
 * VERIFIED MEANS EVIDENCE EXISTS. A row cannot claim `verified` without the
 * identifier it was verified for and the name and address it was verified
 * against — otherwise "verified" degrades into "somebody clicked a button",
 * which is worse than unverified because it is believed.
 */
alter table public.google_review_locations
  drop constraint if exists google_review_locations_verified_has_evidence;
alter table public.google_review_locations
  add constraint google_review_locations_verified_has_evidence
  check (
    apify_source_status <> 'verified'
    or (
      google_place_id is not null
      and canonical_google_name is not null
      and canonical_google_address is not null
      and apify_last_verified_at is not null
    )
  );

/* An identifier is required before a listing can be anything but unconfigured. */
alter table public.google_review_locations
  drop constraint if exists google_review_locations_status_needs_place;
alter table public.google_review_locations
  add constraint google_review_locations_status_needs_place
  check (apify_source_status = 'unconfigured' or google_place_id is not null);

comment on column public.google_review_locations.google_place_id is
  'Google''s stable Place ID for this listing — what the Apify actor addresses it by. Unique: two salons sharing one Google listing would merge their reviews. Resolved once and verified; never searched for on a scheduled run.';
comment on column public.google_review_locations.apify_source_status is
  'Whether this listing may take part in an Apify run. Only `verified` does. Fail closed: an unconfigured, pending or rejected listing is skipped and reported as skipped, which is not the same as "had no new reviews".';
comment on column public.google_review_locations.canonical_google_name is
  'What Google called this listing when its identifier was verified. Evidence, not decoration — it is what somebody reads to confirm store code 306 really is the Manhattan salon.';

-- ------------------------------------ what we expect each listing to be ----
--
-- Seeded from the store-code roster. `store-codes.ts` holds the same values and
-- `store-codes.test.ts` reads this file as text to keep the two honest, exactly
-- as it already does for the store code and salon number.

update public.google_review_locations l
   set expected_state = v.state,
       expected_city  = v.city
  from (values
    ('140', 'MO', 'Kansas City'),
    ('141', 'NE', 'Grand Island'),
    ('143', 'NE', 'Kearney'),
    ('144', 'NE', 'Lincoln'),
    ('145', 'NE', 'Lincoln'),
    ('146', 'NE', 'Lincoln'),
    ('147', 'NE', 'Omaha'),
    ('148', 'NE', 'Omaha'),
    ('231', 'MO', 'Liberty'),
    ('254', 'NE', 'Omaha'),
    ('306', 'KS', 'Manhattan'),
    ('307', 'KS', 'Shawnee'),
    ('314', 'KS', 'Lawrence'),
    ('373', 'KS', 'Overland Park'),
    ('409', 'MO', 'St Joseph')
  ) as v(store_code, state, city)
 where l.store_code = v.store_code
   and (l.expected_state is null or l.expected_city is null);

-- ------------------------------------------ the review's discovery facts ---

alter table public.google_reviews
  /*
   * WHICH TRANSPORT SAW IT FIRST, and which saw it last. Two columns rather
   * than an array because the two questions a person actually asks are "did
   * Apify find this, or did we only ever have it from Brave?" and "is the
   * server-side source still seeing this listing?" — and both are answered by
   * an indexable scalar rather than by unpacking a set.
   *
   * `first_ingestion_source` IS WRITE-ONCE in practice: the upsert never
   * rewrites it, so a review Brave found on Tuesday and Apify re-read on
   * Wednesday keeps Brave as its discovery and gains Apify as its latest.
   */
  add column if not exists first_ingestion_source
    public.google_review_ingestion_source not null default 'brave_extension',
  add column if not exists last_ingestion_source
    public.google_review_ingestion_source not null default 'brave_extension',
  /*
   * WHICH GOOGLE LISTING THE SOURCE SAID THIS CAME FROM.
   *
   * Recorded for audit, and NEVER used to decide the salon. The salon is
   * decided by `location_id`, resolved through the persisted mapping — so a
   * place id arriving in a payload can be compared against what we hold, and
   * cannot become a routing instruction.
   */
  add column if not exists reported_place_id text;

alter table public.google_reviews
  drop constraint if exists google_reviews_reported_place_format;
alter table public.google_reviews
  add constraint google_reviews_reported_place_format
  check (reported_place_id is null or reported_place_id ~ '^[A-Za-z0-9_-]{10,255}$');

create index if not exists google_reviews_last_source
  on public.google_reviews (last_ingestion_source, last_seen_at desc);

comment on column public.google_reviews.first_ingestion_source is
  'The transport that first filed this review. A review found by Brave and later re-read by Apify keeps this value: the row is the same review, discovered once.';
comment on column public.google_reviews.google_absolute_date is
  'THE CANONICAL GOOGLE PUBLICATION TIMESTAMP when the source supplies one. Apify returns a real ISO instant, so for Apify-sourced reviews this is Google''s own posting time, not an approximation. Null for reviews only ever read off the Business Profile page, which renders relative text. first_seen_at/last_seen_at remain ingestion audit fields and are never the review date.';

/* The run that discovered a review also records which transport it was. */
alter table public.google_review_sync_runs
  add column if not exists ingestion_source
    public.google_review_ingestion_source not null default 'brave_extension';

-- ------------------------------------------------------ the run ledger -----
--
-- ONE ROW PER APIFY RUN THIS SYSTEM STARTS. It is three things at once, and
-- they are the same three facts, which is why it is one table:
--
--   THE CONCURRENCY LOCK. A run may be started only when no run is live. That
--   is what stops a double-clicked button, an overlapping cron tick and a
--   retried webhook from each paying Apify for the same reviews.
--
--   THE COST GUARDRAIL. Every run is counted before it is started, so a bug
--   that calls the trigger in a loop hits a countable ceiling instead of a
--   monthly invoice.
--
--   THE STATUS PANEL. "Last successful sync", "locations returned 14 / 15",
--   "reviews fetched" and "actual Apify usage" are columns here, so the panel
--   reads what happened rather than recomputing an estimate.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_apify_run_status') then
    create type public.google_review_apify_run_status as enum (
      /* Started on Apify; we are waiting for the completion webhook. */
      'running',
      /* Apify finished and every configured listing came back. */
      'succeeded',
      /* Apify finished and at least one configured listing did not. */
      'partial',
      /* The run failed, timed out, was aborted, or its dataset was unreadable. */
      'failed'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_apify_run_kind') then
    create type public.google_review_apify_run_kind as enum (
      /* The controlled historical import, deep and manual. */
      'backfill',
      /* The recurring newest-first window. */
      'incremental',
      /* Resolving and verifying a listing's Google identifier. */
      'location_resolution'
    );
  end if;
end
$$;

create table if not exists public.google_review_apify_runs (
  id uuid primary key default extensions.gen_random_uuid(),

  /* Apify's own run id. Null only in the moment between claiming the lock and
     Apify answering — a claim that never gets an id is reaped as failed. */
  apify_run_id text unique
    check (apify_run_id is null or apify_run_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  apify_actor_id text
    check (apify_actor_id is null or length(apify_actor_id) <= 160),
  apify_dataset_id text
    check (apify_dataset_id is null or apify_dataset_id ~ '^[A-Za-z0-9_-]{6,64}$'),

  kind   public.google_review_apify_run_kind not null,
  status public.google_review_apify_run_status not null default 'running',

  /*
   * WHO ASKED FOR IT. `cron`, or `admin:<email>` from a verified session — the
   * same audit label shape the anchor process already uses. Never a secret.
   */
  requested_by text not null
    check (length(btrim(requested_by)) > 0 and length(requested_by) <= 120),

  /* What we asked Apify for, so a surprising result can be read against it. */
  locations_requested integer not null default 0 check (locations_requested >= 0),
  reviews_limit_per_location integer check (reviews_limit_per_location is null or reviews_limit_per_location >= 0),
  /* The date cutoff sent to the actor, when one was sent. */
  reviews_since timestamptz,

  /*
   * WHAT CAME BACK. `locations_returned` is counted over listings that appeared
   * in the dataset AT ALL — which is emphatically not the same as listings with
   * new reviews, and the two are never collapsed. A salon with a quiet week
   * returns zero reviews and still counts as returned.
   */
  locations_returned integer not null default 0 check (locations_returned >= 0),
  reviews_fetched integer not null default 0 check (reviews_fetched >= 0),
  reviews_created integer not null default 0 check (reviews_created >= 0),
  reviews_updated integer not null default 0 check (reviews_updated >= 0),
  reviews_duplicate integer not null default 0 check (reviews_duplicate >= 0),
  reviews_invalid integer not null default 0 check (reviews_invalid >= 0),
  reviews_unmapped integer not null default 0 check (reviews_unmapped >= 0),
  counted_into_period integer not null default 0 check (counted_into_period >= 0),
  stored_as_historical integer not null default 0 check (stored_as_historical >= 0),

  /*
   * ACTUAL COST, READ BACK FROM APIFY. Not our estimate. An estimate written by
   * the code that spends the money is the one number nobody should trust, and
   * Apify reports what the run really used.
   */
  usage_total_usd numeric(12, 4) check (usage_total_usd is null or usage_total_usd >= 0),

  /* Store codes that were asked for and did not come back. Never a name. */
  missing_store_codes text[] not null default '{}',
  /* Refusal CODES only, same discipline as the sync runs table. */
  problems jsonb not null default '[]'::jsonb,

  /* The ingestion run this Apify run produced, when it produced one. */
  sync_run_id uuid references public.google_review_sync_runs (id) on delete set null,

  started_at  timestamptz not null default now(),
  finished_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint google_review_apify_runs_finished_after_start
    check (finished_at is null or finished_at >= started_at),
  /* A live run has no finish time; a finished run has one. */
  constraint google_review_apify_runs_status_agrees
    check ((status = 'running') = (finished_at is null))
);

drop trigger if exists google_review_apify_runs_touch_updated_at on public.google_review_apify_runs;
create trigger google_review_apify_runs_touch_updated_at
  before update on public.google_review_apify_runs
  for each row execute function public.touch_updated_at();

/*
 * THE LOCK, EXPRESSED AS A CONSTRAINT RATHER THAN AS A CONVENTION.
 *
 * At most one run may be `running` at a time. A partial unique index over a
 * constant is the whole mechanism: two concurrent starts race, one inserts, the
 * other is refused by Postgres. No advisory lock to leak, no flag to leave set
 * by a crashed process, and — the point — no way for a future route to forget.
 */
create unique index if not exists google_review_apify_runs_one_live
  on public.google_review_apify_runs ((true))
  where status = 'running';

create index if not exists google_review_apify_runs_recent
  on public.google_review_apify_runs (started_at desc);

alter table public.google_review_apify_runs enable row level security;
alter table public.google_review_apify_runs force row level security;
revoke all on table public.google_review_apify_runs from anon, authenticated;

comment on table public.google_review_apify_runs is
  'One row per Apify run ASK Sunny starts: the concurrency lock (at most one running, enforced by a partial unique index), the cost guardrail (runs are counted before they are started) and the status panel''s read model. Holds no Apify token and no review text.';
comment on column public.google_review_apify_runs.locations_returned is
  'Listings that appeared in the dataset at all. NOT listings with new reviews — a quiet salon returns zero reviews and is still returned. Confusing the two is how a broken mapping gets read as a slow week.';
comment on column public.google_review_apify_runs.usage_total_usd is
  'What Apify says the run cost, read back from the run object. Never an estimate computed here.';

-- ---------------------------------------------------- claiming the lock ----

create or replace function public.google_review_apify_claim_run(
  p_kind         public.google_review_apify_run_kind,
  p_requested_by text,
  p_locations    integer default 0,
  p_limit        integer default null,
  p_since        timestamptz default null,
  /* Runs started in the trailing window, above which a start is refused. */
  p_max_runs_per_day integer default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_recent integer;
  v_live record;
begin
  /*
   * THE BUDGET GUARD RUNS BEFORE THE LOCK, so a caller that is over budget is
   * told that rather than being told something else is running. The window is
   * a rolling 24 hours rather than a calendar day: a bug at 23:50 should not
   * get a fresh allowance ten minutes later.
   */
  if p_max_runs_per_day is not null then
    select count(*) into v_recent
      from public.google_review_apify_runs r
     where r.started_at > now() - interval '24 hours';

    if v_recent >= p_max_runs_per_day then
      return jsonb_build_object(
        'status', 'over_budget',
        'runsInWindow', v_recent,
        'limit', p_max_runs_per_day
      );
    end if;
  end if;

  /*
   * REAP A STALE CLAIM FIRST. A run whose webhook never arrived would otherwise
   * hold the lock forever. Six hours is far longer than any run this system
   * starts and short enough that a stuck lock clears without a person.
   * The reaped run is marked failed rather than deleted: an Apify run that
   * really did charge us must stay visible and stay counted against the budget.
   */
  update public.google_review_apify_runs r
     set status = 'failed',
         finished_at = now(),
         problems = r.problems || jsonb_build_object('code', 'run_abandoned')
   where r.status = 'running'
     and r.started_at < now() - interval '6 hours';

  begin
    insert into public.google_review_apify_runs (
      kind, requested_by, locations_requested, reviews_limit_per_location, reviews_since
    ) values (
      p_kind, left(btrim(p_requested_by), 120), greatest(coalesce(p_locations, 0), 0), p_limit, p_since
    )
    returning id into v_id;
  exception when unique_violation then
    select r.id, r.kind, r.started_at, r.requested_by
      into v_live
      from public.google_review_apify_runs r
     where r.status = 'running'
     limit 1;

    return jsonb_build_object(
      'status', 'already_running',
      'runId', v_live.id,
      'kind', v_live.kind,
      'startedAt', v_live.started_at,
      'requestedBy', v_live.requested_by
    );
  end;

  return jsonb_build_object('status', 'claimed', 'runId', v_id);
end;
$$;

revoke all on function public.google_review_apify_claim_run(
  public.google_review_apify_run_kind, text, integer, integer, timestamptz, integer
) from public, anon, authenticated;

comment on function public.google_review_apify_claim_run(
  public.google_review_apify_run_kind, text, integer, integer, timestamptz, integer
) is
  'Claims the single run slot, or refuses with already_running / over_budget. The lock is a partial unique index, so two concurrent callers cannot both win it. Reaps a claim older than six hours as failed rather than deleting it: a run that charged us stays visible and stays counted.';

-- -------------------------------------------------- releasing the claim ----

create or replace function public.google_review_apify_release_run(
  p_run_id  uuid,
  p_status  public.google_review_apify_run_status,
  p_problems jsonb default '[]'::jsonb
) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.google_review_apify_runs r
     set status = p_status,
         finished_at = coalesce(r.finished_at, now()),
         problems = r.problems || coalesce(p_problems, '[]'::jsonb)
   where r.id = p_run_id
     and r.status = 'running';
end;
$$;

revoke all on function public.google_review_apify_release_run(
  uuid, public.google_review_apify_run_status, jsonb
) from public, anon, authenticated;

-- ------------------------------------------ the Apify run's own identity ---

create or replace function public.google_review_apify_attach_run(
  p_run_id     uuid,
  p_apify_run  text,
  p_actor_id   text,
  p_dataset_id text default null
) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.google_review_apify_runs r
     set apify_run_id   = left(btrim(p_apify_run), 64),
         apify_actor_id = left(btrim(p_actor_id), 160),
         apify_dataset_id = nullif(left(btrim(coalesce(p_dataset_id, '')), 64), '')
   where r.id = p_run_id;
end;
$$;

revoke all on function public.google_review_apify_attach_run(uuid, text, text, text)
  from public, anon, authenticated;

-- ------------------------------------------------- recording the outcome ---

create or replace function public.google_review_apify_record_outcome(
  p_run_id     uuid,
  p_status     public.google_review_apify_run_status,
  p_counts     jsonb,
  p_missing    text[] default '{}',
  p_problems   jsonb default '[]'::jsonb,
  p_usage_usd  numeric default null,
  p_sync_run   uuid default null
) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.google_review_apify_runs r
     set status               = p_status,
         finished_at          = coalesce(r.finished_at, now()),
         locations_returned   = greatest(coalesce((p_counts ->> 'locationsReturned')::int, 0), 0),
         reviews_fetched      = greatest(coalesce((p_counts ->> 'reviewsFetched')::int, 0), 0),
         reviews_created      = greatest(coalesce((p_counts ->> 'created')::int, 0), 0),
         reviews_updated      = greatest(coalesce((p_counts ->> 'updated')::int, 0), 0),
         reviews_duplicate    = greatest(coalesce((p_counts ->> 'duplicates')::int, 0), 0),
         reviews_invalid      = greatest(coalesce((p_counts ->> 'invalid')::int, 0), 0),
         reviews_unmapped     = greatest(coalesce((p_counts ->> 'unmapped')::int, 0), 0),
         counted_into_period  = greatest(coalesce((p_counts ->> 'countedIntoPeriod')::int, 0), 0),
         stored_as_historical = greatest(coalesce((p_counts ->> 'storedAsHistorical')::int, 0), 0),
         missing_store_codes  = coalesce(p_missing, '{}'),
         problems             = r.problems || coalesce(p_problems, '[]'::jsonb),
         usage_total_usd      = coalesce(p_usage_usd, r.usage_total_usd),
         sync_run_id          = coalesce(p_sync_run, r.sync_run_id)
   where r.id = p_run_id;
end;
$$;

revoke all on function public.google_review_apify_record_outcome(
  uuid, public.google_review_apify_run_status, jsonb, text[], jsonb, numeric, uuid
) from public, anon, authenticated;

comment on function public.google_review_apify_record_outcome(
  uuid, public.google_review_apify_run_status, jsonb, text[], jsonb, numeric, uuid
) is
  'Writes what a finished Apify run actually did. A FAILED run records counts of zero and touches no review: nothing in this function deletes, and the ingestion it reports on has already committed or not happened at all.';

-- ------------------------------------------- setting a listing''s place ----
--
-- FAIL CLOSED ON AMBIGUITY. This function does not decide whether a candidate
-- is right — that is the verification step's job, and it is done against
-- Google's own returned name and address. What this enforces is that a status
-- of `verified` can only ever be written together with the evidence for it, and
-- that one Google listing cannot be attached to two salons.

create or replace function public.google_review_apify_set_place(
  p_store_code text,
  p_place_id   text,
  p_status     public.google_review_apify_source_status,
  p_name       text default null,
  p_address    text default null,
  p_maps_url   text default null,
  p_cid        text default null,
  p_note       text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_location record;
  v_clash    record;
begin
  select l.id, l.store_code into v_location
    from public.google_review_locations l
   where l.store_code = btrim(p_store_code);

  if not found then
    return jsonb_build_object('status', 'unknown_store', 'storeCode', p_store_code);
  end if;

  if p_place_id is not null then
    /*
     * ONE GOOGLE LISTING, ONE SALON. The unique constraint would refuse this
     * anyway; catching it here means the operator is told WHICH salon already
     * holds the id rather than being shown a constraint name.
     */
    select l.store_code into v_clash
      from public.google_review_locations l
     where l.google_place_id = btrim(p_place_id)
       and l.id <> v_location.id;

    if found then
      return jsonb_build_object(
        'status', 'place_already_mapped',
        'storeCode', v_location.store_code,
        'conflictsWith', v_clash.store_code
      );
    end if;
  end if;

  update public.google_review_locations l
     set google_place_id          = nullif(btrim(coalesce(p_place_id, '')), ''),
         google_cid               = nullif(btrim(coalesce(p_cid, '')), ''),
         google_maps_url          = nullif(btrim(coalesce(p_maps_url, '')), ''),
         canonical_google_name    = nullif(btrim(coalesce(p_name, '')), ''),
         canonical_google_address = nullif(btrim(coalesce(p_address, '')), ''),
         apify_source_status      = p_status,
         apify_last_verified_at   = case when p_status = 'verified' then now() else l.apify_last_verified_at end,
         apify_verification_note  = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where l.id = v_location.id;

  return jsonb_build_object('status', 'ok', 'storeCode', v_location.store_code);
end;
$$;

revoke all on function public.google_review_apify_set_place(
  text, text, public.google_review_apify_source_status, text, text, text, text, text
) from public, anon, authenticated;

-- ============================================================================
-- THE INGESTION FUNCTION, GAINING ONE PARAMETER
-- ============================================================================
--
-- `p_ingestion_source` is the ONLY behavioural change: it records which
-- transport filed the batch. Everything else below is the function as it stood,
-- reproduced because Postgres has no way to add a parameter in place.
--
-- WHY THE SOURCE IS NOT PART OF "CHANGED". A review re-read by the other
-- transport has not changed; it has been seen again. Counting it as an update
-- would make "3 new, 5 already synced" meaningless the moment both sources run.

drop function if exists public.ingest_google_reviews(jsonb, text, text, timestamptz, jsonb);

create or replace function public.ingest_google_reviews(
  p_reviews        jsonb,
  p_parser_version text,
  p_credential_id  text default null,
  p_seen_at        timestamptz default now(),
  p_store_plans    jsonb default '[]'::jsonb,
  p_ingestion_source public.google_review_ingestion_source default 'brave_extension'
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item      jsonb;
  v_plan      jsonb;
  v_location  record;
  v_existing  record;
  v_external  text;
  v_store     text;
  v_rating    int;
  v_name      text;
  v_text      text;
  v_relative  text;
  v_absolute  timestamptz;
  v_estimate  timestamptz;
  v_position  int;
  v_place     text;
  v_has_reply boolean;
  v_reply     text;
  v_reply_at  text;
  v_status    public.google_review_response_status;
  v_changed   boolean;
  v_assign    boolean;

  v_period    uuid;
  v_run_id    uuid;

  v_store_ok       jsonb := '{}'::jsonb;
  v_store_advance  jsonb := '{}'::jsonb;
  v_store_counted  jsonb := '{}'::jsonb;

  v_received  int := 0;
  v_created   int := 0;
  v_updated   int := 0;
  v_unchanged int := 0;
  v_ignored   int := 0;
  v_invalid   int := 0;
  v_counted   int := 0;
  v_historical int := 0;
  v_problems  jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_reviews) <> 'array' then
    raise exception 'ingest_google_reviews expects a JSON array of reviews.';
  end if;
  if p_parser_version is null or btrim(p_parser_version) = '' then
    raise exception 'ingest_google_reviews requires a parser version.';
  end if;

  v_period := public.google_review_current_period(p_seen_at);

  insert into public.google_review_sync_runs (ingest_credential_id, parser_version, ingestion_source)
  values (p_credential_id, p_parser_version, p_ingestion_source)
  returning id into v_run_id;

  /* -------------------------------------------- the store plans, checked -- */

  for v_plan in select * from jsonb_array_elements(coalesce(p_store_plans, '[]'::jsonb))
  loop
    v_store := btrim(coalesce(v_plan ->> 'storeCode', ''));
    if v_store = '' then continue; end if;

    select l.id, l.counted_through_external_review_id as anchor
      into v_location
      from public.google_review_locations l
     where l.store_code = v_store;

    if not found then continue; end if;

    if coalesce(v_plan ->> 'expectedAnchor', '') is distinct from coalesce(v_location.anchor, '') then
      v_store_ok := v_store_ok || jsonb_build_object(v_store, false);
      v_problems := v_problems ||
        jsonb_build_object('code', 'anchor_moved', 'storeCode', v_store);
    else
      v_store_ok := v_store_ok || jsonb_build_object(v_store, true);
      if coalesce(v_plan ->> 'advanceAnchorTo', '') <> '' then
        v_store_advance := v_store_advance ||
          jsonb_build_object(v_store, v_plan ->> 'advanceAnchorTo');
      end if;
    end if;
  end loop;

  /* ------------------------------------------------------- the reviews --- */

  for v_item in select * from jsonb_array_elements(p_reviews)
  loop
    v_received := v_received + 1;

    v_external := btrim(coalesce(v_item ->> 'externalReviewId', ''));
    v_store    := btrim(coalesce(v_item ->> 'storeCode', ''));
    v_name     := btrim(coalesce(v_item ->> 'reviewerName', ''));

    begin
      v_rating := (v_item ->> 'rating')::int;
    exception when others then
      v_rating := null;
    end;

    if v_external = '' or v_external !~ '^[A-Za-z0-9_-]{6,128}$' then
      v_invalid := v_invalid + 1;
      v_problems := v_problems || jsonb_build_object('code', 'invalid_review_id');
      continue;
    end if;

    if v_rating is null or v_rating < 1 or v_rating > 5 then
      v_invalid := v_invalid + 1;
      v_problems := v_problems ||
        jsonb_build_object('code', 'invalid_rating', 'storeCode', v_store);
      continue;
    end if;

    if v_name = '' then
      v_invalid := v_invalid + 1;
      v_problems := v_problems ||
        jsonb_build_object('code', 'missing_reviewer_name', 'storeCode', v_store);
      continue;
    end if;

    select l.id, l.store_code, l.is_active, l.google_place_id
      into v_location
      from public.google_review_locations l
     where l.store_code = v_store;

    if not found then
      v_ignored := v_ignored + 1;
      v_problems := v_problems ||
        jsonb_build_object('code', 'ignored_unknown_store', 'storeCode', v_store);
      continue;
    end if;

    if not v_location.is_active then
      v_ignored := v_ignored + 1;
      v_problems := v_problems ||
        jsonb_build_object('code', 'ignored_inactive_store', 'storeCode', v_store);
      continue;
    end if;

    v_text     := nullif(btrim(coalesce(v_item ->> 'reviewText', '')), '');
    v_relative := nullif(btrim(coalesce(v_item ->> 'relativeDateText', '')), '');
    v_reply    := nullif(btrim(coalesce(v_item ->> 'ownerResponseText', '')), '');
    v_reply_at := nullif(btrim(coalesce(v_item ->> 'ownerResponseDateText', '')), '');

    begin
      v_absolute := nullif(btrim(coalesce(v_item ->> 'googleAbsoluteDate', '')), '')::timestamptz;
    exception when others then
      v_absolute := null;
    end;

    begin
      v_position := nullif(btrim(coalesce(v_item ->> 'feedPosition', '')), '')::int;
    exception when others then
      v_position := null;
    end;
    if v_position is not null and v_position < 0 then v_position := null; end if;

    /*
     * THE PLACE ID THE SOURCE REPORTED, kept only if it matches what we hold
     * for this listing. A payload that names a different place than the mapping
     * does is recorded as a problem and the value is dropped — the review is
     * still filed, against the salon the MAPPING says, because the mapping is
     * the authority and a scraped identifier is not.
     */
    v_place := nullif(btrim(coalesce(v_item ->> 'reportedPlaceId', '')), '');
    if v_place is not null and v_place !~ '^[A-Za-z0-9_-]{10,255}$' then
      v_place := null;
    end if;
    if v_place is not null
       and v_location.google_place_id is not null
       and v_place <> v_location.google_place_id then
      v_problems := v_problems ||
        jsonb_build_object('code', 'place_id_mismatch', 'storeCode', v_store);
      v_place := null;
    end if;

    /*
     * THE BACKLOG'S ORDERING TIME. The real publication instant when the
     * source supplied one, and Google's bucketed relative wording only when it
     * did not — an exact instant is strictly better evidence than "a month
     * ago", so it wins wherever both exist. Still never a period key: that is
     * decided by position against the anchor. What changes is that an
     * Apify-sourced backlog now sorts correctly on screen instead of falling
     * back to the day somebody imported it.
     */
    v_estimate := coalesce(
      v_absolute,
      public.google_review_estimate_from_relative(v_relative, p_seen_at)
    );

    v_has_reply := coalesce((v_item ->> 'hasOwnerResponse')::boolean, false)
                   or v_reply is not null;
    if not v_has_reply then
      v_reply := null;
      v_reply_at := null;
    end if;
    v_status := case when v_has_reply then 'responded' else 'needs_response' end;

    v_assign := coalesce((v_item ->> 'periodAssignment') = 'current', false)
                and coalesce((v_store_ok ->> v_store)::boolean, false);

    select r.id,
           r.rating,
           r.review_text,
           r.reviewer_name,
           r.has_owner_response,
           r.owner_response_text,
           r.owner_response_date_text,
           r.google_relative_date_text,
           r.google_absolute_date,
           r.store_code,
           r.location_id,
           r.reporting_period_id
      into v_existing
      from public.google_reviews r
     where r.source = 'google_business_profile'
       and r.external_review_id = v_external;

    if not found then
      insert into public.google_reviews (
        source, external_review_id, location_id, store_code,
        reviewer_name, rating, review_text,
        google_relative_date_text, google_absolute_date, google_estimated_at,
        first_seen_at, last_seen_at,
        has_owner_response, owner_response_text, owner_response_date_text,
        response_status, first_seen_week, parser_version, ingest_credential_id,
        reporting_period_id, reporting_assignment_status,
        feed_position, feed_run_id,
        first_ingestion_source, last_ingestion_source, reported_place_id
      ) values (
        'google_business_profile', v_external, v_location.id, v_location.store_code,
        left(v_name, 200), v_rating, left(v_text, 8000),
        left(v_relative, 120), v_absolute, v_estimate,
        p_seen_at, p_seen_at,
        v_has_reply, left(v_reply, 8000), left(v_reply_at, 120),
        v_status, public.google_review_week_start(p_seen_at), p_parser_version, p_credential_id,
        case when v_assign then v_period else null end,
        (case when v_assign then 'anchor_assigned' else 'historical' end)
          ::public.google_review_assignment_status,
        v_position, v_run_id,
        p_ingestion_source, p_ingestion_source, v_place
      )
      on conflict (source, external_review_id) do nothing;

      if found then
        v_created := v_created + 1;
        if v_assign then
          v_counted := v_counted + 1;
          v_store_counted := v_store_counted || jsonb_build_object(v_store, true);
        else
          v_historical := v_historical + 1;
        end if;
      else
        /*
         * SOMEBODY ELSE CREATED IT BETWEEN THE SELECT AND THE INSERT — the
         * other transport, or a concurrent sync. It is the same review, so the
         * row is touched rather than duplicated, and the transport that just
         * saw it becomes the latest.
         */
        update public.google_reviews r
           set last_seen_at = p_seen_at,
               last_ingestion_source = p_ingestion_source
         where r.source = 'google_business_profile'
           and r.external_review_id = v_external;
        v_updated := v_updated + 1;
      end if;

      continue;
    end if;

    v_changed :=
         v_existing.rating                    is distinct from v_rating
      or v_existing.review_text               is distinct from v_text
      or v_existing.reviewer_name             is distinct from left(v_name, 200)
      or v_existing.has_owner_response        is distinct from v_has_reply
      or v_existing.owner_response_text       is distinct from v_reply
      or v_existing.owner_response_date_text  is distinct from v_reply_at
      or v_existing.google_relative_date_text is distinct from v_relative
      or (v_absolute is not null and v_existing.google_absolute_date is distinct from v_absolute)
      or v_existing.location_id               is distinct from v_location.id;

    update public.google_reviews r
       set last_seen_at              = p_seen_at,
           rating                    = v_rating,
           review_text               = left(v_text, 8000),
           reviewer_name             = left(v_name, 200),
           has_owner_response        = v_has_reply,
           owner_response_text       = left(v_reply, 8000),
           owner_response_date_text  = left(v_reply_at, 120),
           response_status           = v_status,
           google_relative_date_text = left(v_relative, 120),
           google_absolute_date      = coalesce(v_absolute, r.google_absolute_date),
           google_estimated_at       = coalesce(v_estimate, r.google_estimated_at),
           location_id               = v_location.id,
           store_code                = v_location.store_code,
           parser_version            = p_parser_version,
           feed_position             = coalesce(v_position, r.feed_position),
           feed_run_id               = case when v_position is null then r.feed_run_id else v_run_id end,
           /*
            * THE DISCOVERY FACTS. `first_ingestion_source` is never rewritten —
            * it is how this review was found, which already happened. The
            * latest transport is recorded, and the place id is only ever added,
            * never erased by a source that does not report one.
            */
           last_ingestion_source     = p_ingestion_source,
           reported_place_id         = coalesce(v_place, r.reported_place_id),
           reporting_period_id =
             case when r.reporting_period_id is null and v_assign
                  then v_period else r.reporting_period_id end,
           reporting_assignment_status =
             case when r.reporting_period_id is null and v_assign
                  then 'anchor_assigned'::public.google_review_assignment_status
                  else r.reporting_assignment_status end
     where r.id = v_existing.id;

    if v_existing.reporting_period_id is null and v_assign then
      v_counted := v_counted + 1;
      v_store_counted := v_store_counted || jsonb_build_object(v_store, true);
    end if;

    if v_changed then
      v_updated := v_updated + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  /* ------------------------------------------------- the anchor advance -- */

  for v_store in select jsonb_object_keys(v_store_counted)
  loop
    if coalesce(v_store_advance ->> v_store, '') <> '' then
      update public.google_review_locations l
         set counted_through_external_review_id = v_store_advance ->> v_store,
             counted_through_set_at = p_seen_at,
             counted_through_set_by = left(coalesce(p_credential_id, 'sync'), 64)
       where l.store_code = v_store;
    end if;
  end loop;

  update public.google_review_sync_runs
     set received        = v_received,
         created_count   = v_created,
         updated_count   = v_updated,
         unchanged_count = v_unchanged,
         ignored_non_stc = v_ignored,
         invalid_count   = v_invalid,
         problems        = v_problems
   where id = v_run_id;

  return jsonb_build_object(
    'runId',         v_run_id,
    'periodId',      v_period,
    'received',      v_received,
    'created',       v_created,
    'updated',       v_updated,
    'duplicates',    v_unchanged,
    'ignoredNonStc', v_ignored,
    'invalid',       v_invalid,
    'countedIntoPeriod', v_counted,
    'storedAsHistorical', v_historical,
    'problems',      v_problems
  );
end;
$$;

revoke all on function public.ingest_google_reviews(
  jsonb, text, text, timestamptz, jsonb, public.google_review_ingestion_source
) from public, anon, authenticated;

comment on function public.ingest_google_reviews(
  jsonb, text, text, timestamptz, jsonb, public.google_review_ingestion_source
) is
  'Idempotent batch upsert, keyed on (source, external_review_id) — Google''s own review id, whichever transport read it. A review is assigned to the open reporting period ONLY where the caller proved it sits above the listing''s anchor and that anchor has not moved since. p_ingestion_source records the transport beside the review and is never part of its identity, so Brave and Apify converge on one row.';

-- ================================================================ views ====

/*
 * THE INTEGRATION STATUS PANEL'S READ MODEL.
 *
 * ONE ROW PER LISTING, ALL FIFTEEN, whether or not it is configured and whether
 * or not it holds a review — because "locations configured: 14 / 15" is only a
 * useful sentence if the fifteenth is on the list saying why.
 */
create or replace view public.google_review_apify_locations
with (security_invoker = true) as
select
  l.store_code,
  d.salon_number,
  d.store_name          as location_name,
  d.district_label      as district,
  l.google_location_label,
  l.listing_state,
  l.is_active,
  l.google_place_id,
  l.google_cid,
  l.google_maps_url,
  l.canonical_google_name,
  l.canonical_google_address,
  l.expected_state,
  l.expected_city,
  l.apify_source_status,
  l.apify_last_verified_at,
  l.apify_verification_note,
  l.counted_through_external_review_id is not null as counting_active,

  /* What this listing holds, split by the transport that last saw each review. */
  coalesce(stats.reviews_total, 0)      as reviews_total,
  coalesce(stats.reviews_from_apify, 0) as reviews_from_apify,
  coalesce(stats.reviews_from_brave, 0) as reviews_from_brave,
  stats.latest_published_at,
  stats.latest_seen_at
from public.google_review_locations l
left join public.salon_directory d on d.salon_id = l.salon_id
left join lateral (
  select
    count(*)                                                        as reviews_total,
    count(*) filter (where r.last_ingestion_source = 'apify')        as reviews_from_apify,
    count(*) filter (where r.last_ingestion_source = 'brave_extension') as reviews_from_brave,
    max(coalesce(r.google_absolute_date, r.google_estimated_at))      as latest_published_at,
    max(r.last_seen_at)                                               as latest_seen_at
  from public.google_reviews r
 where r.location_id = l.id
) stats on true;

comment on view public.google_review_apify_locations is
  'All fifteen listings with their Google identifier, verification state and per-transport review counts. A listing with zero reviews returned is still a row: "no new reviews" and "mapping not configured" are different facts and this view keeps them apart.';

/*
 * BRAVE VERSUS APIFY, WHICH IS THE QUESTION THE CUTOVER RESTS ON.
 *
 * If both transports report the same Google review id, the same review found
 * twice is one row that has been seen by both — and `both_sources` counts them.
 * If Apify's id representation ever DIFFERS from the Business Profile page's
 * `data-lid`, that failure is silent in every other view: two rows, both
 * plausible, one customer. `suspected_duplicates` is the detector — same
 * listing, same reviewer, same rating, within a day of each other, and two
 * different ids discovered by two different transports.
 *
 * IT IS A REPORT, NOT A MERGE. Nothing here rewrites an identity on a
 * resemblance; a person reads it and decides.
 */
create or replace view public.google_review_source_reconciliation
with (security_invoker = true) as
with per_location as (
  select
    l.store_code,
    count(r.id)                                                          as reviews_total,
    count(r.id) filter (where r.first_ingestion_source = 'apify')         as discovered_by_apify,
    count(r.id) filter (where r.first_ingestion_source = 'brave_extension') as discovered_by_brave,
    count(r.id) filter (
      where r.first_ingestion_source is distinct from r.last_ingestion_source
    )                                                                     as seen_by_both_sources,
    count(r.id) filter (where r.google_absolute_date is not null)         as with_publication_time
  from public.google_review_locations l
  left join public.google_reviews r on r.location_id = l.id
  group by l.store_code
),
suspected as (
  select
    l.store_code,
    count(*) as suspected_duplicates
  from public.google_reviews a
  join public.google_reviews b
    on b.location_id = a.location_id
   and b.id <> a.id
   and b.external_review_id <> a.external_review_id
   and lower(btrim(b.reviewer_name)) = lower(btrim(a.reviewer_name))
   and b.rating = a.rating
   and a.first_ingestion_source = 'brave_extension'
   and b.first_ingestion_source = 'apify'
   and (
     a.google_absolute_date is null
     or b.google_absolute_date is null
     or abs(extract(epoch from (b.google_absolute_date - a.google_absolute_date))) < 86400
   )
  join public.google_review_locations l on l.id = a.location_id
  group by l.store_code
)
select
  p.store_code,
  p.reviews_total,
  p.discovered_by_apify,
  p.discovered_by_brave,
  p.seen_by_both_sources,
  p.with_publication_time,
  coalesce(s.suspected_duplicates, 0) as suspected_duplicates
from per_location p
left join suspected s on s.store_code = p.store_code;

comment on view public.google_review_source_reconciliation is
  'Per listing: how many reviews each transport discovered, how many both have seen, and how many pairs LOOK like one review stored twice under two different ids. seen_by_both_sources > 0 is the evidence that Brave and Apify agree on Google''s review id; suspected_duplicates > 0 is the evidence that they do not. A report for a person, never an automatic merge.';

revoke all on public.google_review_apify_locations from anon, authenticated;
revoke all on public.google_review_source_reconciliation from anon, authenticated;
