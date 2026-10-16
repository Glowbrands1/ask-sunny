-- ============================================================================
-- GOOGLE REVIEWS — THE OFFICIAL GOOGLE BUSINESS PROFILE API SOURCE
-- ============================================================================
--
-- ADDITIVE ONLY. Nothing here drops, renames, rewrites or backfills an existing
-- column, row, view, trigger or function. Apify and the Brave extension keep
-- working exactly as they do today, and `google_reviews_enriched` — the view
-- every dashboard reads — is not touched.
--
-- ============================================================================
-- WHY THE OFFICIAL REVIEW ID IS A NEW COLUMN, NOT THE DEDUPLICATION KEY
-- ============================================================================
--
-- `unique (source, external_review_id)` is the identity of every review already
-- in this system, and those ids came from two transports that do not share an
-- id space with the Business Profile API:
--
--   Brave `data-lid`        20 characters
--   Apify `reviewId`        68 characters
--   Business Profile API    `reviewId` of its own
--
-- Keying the new source on its own id alone would file every historical review
-- a second time and put it back in the response queue. So the official id is
-- stored BESIDE the existing identity (`gbp_review_id`), the existing
-- `external_review_id` is never rewritten, and the two are joined by a
-- reconciliation step that refuses to guess (see the items table below).
--
-- `first_seen_week`, `first_seen_at`, `reporting_period_id`,
-- `reporting_assignment_status`, `feed_position`, the anchors and the generated
-- `eligible_for_weekly_count` are not touched by anything in this file, and
-- every function below writes `gbp_*` columns only.
--
-- OFFICIAL VALUES ARE STORED ALONGSIDE, NEVER OVER, THE EXISTING ONES. The
-- official rating, text, reviewer name and reply live in `gbp_*` columns so a
-- discrepancy between Apify-derived and official data is queryable instead of
-- silently overwritten.
-- ============================================================================

-- ---------------------------------------------------------------- enums ----

-- A new transport value. It is only ADDED here and never used in this
-- migration, because a new enum value cannot be used in the transaction that
-- creates it.
alter type public.google_review_ingestion_source add value if not exists 'gbp_api';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_gbp_mapping_status') then
    create type public.google_review_gbp_mapping_status as enum (
      /* No Business Profile location has been proposed for this listing. */
      'unmapped',
      /* Discovery found a candidate. Nothing syncs from a proposal. */
      'proposed',
      /* A person confirmed it. The ONLY state that takes part in a sync. */
      'confirmed',
      /* Confirmed wrong or ambiguous. Excluded until resolved. */
      'rejected'
    );
  end if;
end
$$;

-- ------------------------------------------------- the location mapping ----

alter table public.google_review_locations
  /* `accounts/{id}` — the Business Profile account that owns the listing. */
  add column if not exists gbp_account_name text,
  /* `locations/{id}` — Business Information API resource name. */
  add column if not exists gbp_location_name text,
  /* Google's Place ID as the Business Profile API reports it. Evidence only. */
  add column if not exists gbp_place_id text,
  add column if not exists gbp_mapping_status
    public.google_review_gbp_mapping_status not null default 'unmapped',
  /* What the confirmation was based on: store code, place id, title. No secrets. */
  add column if not exists gbp_mapping_evidence jsonb,
  add column if not exists gbp_mapping_confirmed_at timestamptz,
  add column if not exists gbp_mapping_confirmed_by text;

alter table public.google_review_locations
  drop constraint if exists google_review_locations_gbp_location_format;
alter table public.google_review_locations
  add constraint google_review_locations_gbp_location_format
  check (gbp_location_name is null or gbp_location_name ~ '^locations/[0-9]{1,30}$');

alter table public.google_review_locations
  drop constraint if exists google_review_locations_gbp_account_format;
alter table public.google_review_locations
  add constraint google_review_locations_gbp_account_format
  check (gbp_account_name is null or gbp_account_name ~ '^accounts/[0-9]{1,30}$');

/*
 * CONFIRMED MEANS EVIDENCE EXISTS, the same discipline `apify_source_status`
 * uses: a row cannot claim `confirmed` without the identifiers it was
 * confirmed for, and without who confirmed it and when.
 */
alter table public.google_review_locations
  drop constraint if exists google_review_locations_gbp_confirmed_has_evidence;
alter table public.google_review_locations
  add constraint google_review_locations_gbp_confirmed_has_evidence
  check (
    gbp_mapping_status <> 'confirmed'
    or (
      gbp_account_name is not null
      and gbp_location_name is not null
      and gbp_mapping_confirmed_at is not null
      and gbp_mapping_confirmed_by is not null
    )
  );

/* Two salons pointing at one Business Profile location would merge their reviews. */
create unique index if not exists google_review_locations_gbp_location_key
  on public.google_review_locations (gbp_location_name)
  where gbp_location_name is not null;

comment on column public.google_review_locations.gbp_mapping_status is
  'Whether this listing may take part in a Business Profile API sync. Only `confirmed` does, and only a person confirms. Fail closed: unmapped, proposed and rejected listings are skipped and reported as skipped.';
comment on column public.google_review_locations.gbp_location_name is
  'The Business Profile location resource name (locations/{id}). Unique: one Business Profile location per salon, never inferred from a store-code transformation.';

-- ---------------------------------------------------- the official fields ----

alter table public.google_reviews
  /* `accounts/{a}/locations/{l}/reviews/{id}` and the bare id. */
  add column if not exists gbp_review_name text,
  add column if not exists gbp_review_id text,
  /* How the link between this row and the official review was established. */
  add column if not exists gbp_link_method text,
  add column if not exists gbp_linked_at timestamptz,
  add column if not exists gbp_last_synced_at timestamptz,
  /* Google's own timestamps, exactly as the API reports them. */
  add column if not exists gbp_create_time timestamptz,
  add column if not exists gbp_update_time timestamptz,
  /* The official values, held BESIDE the existing columns and never over them. */
  add column if not exists gbp_reviewer_name text,
  add column if not exists gbp_rating smallint,
  add column if not exists gbp_comment text,
  add column if not exists gbp_reply_text text,
  add column if not exists gbp_reply_update_time timestamptz;

alter table public.google_reviews
  drop constraint if exists google_reviews_gbp_link_method_check;
alter table public.google_reviews
  add constraint google_reviews_gbp_link_method_check
  check (gbp_link_method is null or gbp_link_method in
    ('exact_id', 'auto_match', 'created_from_gbp', 'manual'));

alter table public.google_reviews
  drop constraint if exists google_reviews_gbp_rating_check;
alter table public.google_reviews
  add constraint google_reviews_gbp_rating_check
  check (gbp_rating is null or gbp_rating between 1 and 5);

alter table public.google_reviews
  drop constraint if exists google_reviews_gbp_review_id_format;
alter table public.google_reviews
  add constraint google_reviews_gbp_review_id_format
  check (gbp_review_id is null or gbp_review_id ~ '^[A-Za-z0-9_-]{6,128}$');

/* A link has a method and a time, or it is not a link. */
alter table public.google_reviews
  drop constraint if exists google_reviews_gbp_link_complete;
alter table public.google_reviews
  add constraint google_reviews_gbp_link_complete
  check (
    (gbp_review_id is null and gbp_link_method is null)
    or (gbp_review_id is not null and gbp_link_method is not null and gbp_linked_at is not null)
  );

/*
 * ONE OFFICIAL REVIEW, ONE ROW. This is what makes the link idempotent and what
 * stops a bad match from attaching one official review to two stored rows.
 */
create unique index if not exists google_reviews_gbp_review_id_key
  on public.google_reviews (gbp_review_id)
  where gbp_review_id is not null;

create index if not exists google_reviews_gbp_unlinked
  on public.google_reviews (location_id)
  where gbp_review_id is null;

comment on column public.google_reviews.gbp_review_id is
  'The official Business Profile review id. Stored beside external_review_id, never in place of it: the Brave and Apify ids that already identify these rows are a different id space.';
comment on column public.google_reviews.gbp_create_time is
  'Google''s own creation timestamp for the review, from the official API. Display and audit only: it never moves first_seen_week, first_seen_at or the reporting period.';

-- ----------------------------------- the manual-review queue for matching ----

create table if not exists public.google_review_reconciliation_items (
  id uuid primary key default extensions.gen_random_uuid(),

  location_id uuid not null references public.google_review_locations (id) on delete restrict,
  gbp_review_id text not null
    check (gbp_review_id ~ '^[A-Za-z0-9_-]{6,128}$'),

  /*
   * WHY THIS NEEDS A PERSON. The reasons are codes, not prose, so a list of
   * open items can be grouped: `no_timestamp_on_existing`, `multiple_candidates`,
   * `rating_differs`, `name_differs`, `text_differs`, `time_outside_window`.
   */
  reasons text[] not null default '{}',
  candidate_review_ids uuid[] not null default '{}',

  /* The official side of the comparison, so a reviewer can decide without the API. */
  official jsonb not null default '{}'::jsonb,

  status text not null default 'needs_review'
    check (status in ('needs_review', 'resolved_linked', 'resolved_new', 'dismissed')),
  resolved_review_id uuid references public.google_reviews (id) on delete restrict,
  resolved_by text,
  resolved_at timestamptz,

  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint google_review_reconciliation_items_gbp_key unique (gbp_review_id),
  constraint google_review_reconciliation_items_resolved_complete
    check (status = 'needs_review' or (resolved_by is not null and resolved_at is not null))
);

drop trigger if exists google_review_reconciliation_items_touch_updated_at
  on public.google_review_reconciliation_items;
create trigger google_review_reconciliation_items_touch_updated_at
  before update on public.google_review_reconciliation_items
  for each row execute function public.touch_updated_at();

create index if not exists google_review_reconciliation_items_open
  on public.google_review_reconciliation_items (location_id, first_detected_at)
  where status = 'needs_review';

comment on table public.google_review_reconciliation_items is
  'Official reviews that could not be safely matched to a stored review. Nothing in this table is ingested or merged automatically: a person resolves each one. Holds review text, so it is server-only like every other review table.';

-- ----------------------------------------------------------- sync ledger ----

create table if not exists public.google_review_gbp_sync_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text not null check (mode in ('dry_run', 'live')),
  scope text not null check (scope in ('incremental', 'backfill', 'single_location')),
  trigger text not null check (trigger in ('cron', 'pubsub', 'admin')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  requests integer not null default 0 check (requests >= 0),
  /* Counts and refusal codes per listing. Never review text, never a token. */
  summary jsonb not null default '{}'::jsonb,
  error_code text check (error_code is null or length(error_code) <= 80)
);

create index if not exists google_review_gbp_sync_runs_started
  on public.google_review_gbp_sync_runs (started_at desc);

comment on table public.google_review_gbp_sync_runs is
  'One row per Business Profile sync attempt, dry runs included, so "last successful sync" is a recorded fact. Counts and codes only.';

-- ------------------------------------------------------------------- RLS ----
--
-- SERVER-ONLY, like every other review table: RLS on, no policy, and the
-- browser roles hold no privilege. The app reaches these through the service
-- role only.

alter table public.google_review_reconciliation_items enable row level security;
alter table public.google_review_gbp_sync_runs enable row level security;

revoke all on public.google_review_reconciliation_items from public, anon, authenticated;
revoke all on public.google_review_gbp_sync_runs from public, anon, authenticated;

-- ------------------------------------------------------------ functions ----

/*
 * LINK OFFICIAL REVIEWS TO STORED ROWS.
 *
 * Writes `gbp_*` columns and NOTHING ELSE. In particular it cannot touch
 * rating, review_text, reviewer_name, first_seen_week, first_seen_at,
 * reporting_period_id, reporting_assignment_status or any
 * owner-response column, so a bad call cannot restate a week or overwrite what
 * Apify or Brave recorded.
 *
 * NEVER RE-POINTS. A row that already carries a different official id is left
 * alone and reported as `conflict`; an official id already held by another row
 * is reported the same way. A link that already exists is refreshed, which is
 * what makes a repeated sync a no-op for identity.
 *
 * Input: [{ reviewId (uuid), gbpReviewId, gbpReviewName, method, createTime,
 *           updateTime, reviewerName, rating, comment, replyText,
 *           replyUpdateTime }]
 */
create or replace function public.gbp_apply_links(p_links jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item      jsonb;
  v_row       public.google_reviews%rowtype;
  v_holder    uuid;
  v_linked    int := 0;
  v_refreshed int := 0;
  v_conflicts int := 0;
  v_missing   int := 0;
  v_problems  jsonb := '[]'::jsonb;
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array' then
    raise exception 'gbp_apply_links expects a JSON array';
  end if;
  if jsonb_array_length(p_links) > 1000 then
    raise exception 'gbp_apply_links accepts at most 1000 links per call';
  end if;

  for v_item in select * from jsonb_array_elements(p_links)
  loop
    select * into v_row
      from public.google_reviews
     where id = (v_item ->> 'reviewId')::uuid
       for update;

    if not found then
      v_missing := v_missing + 1;
      v_problems := v_problems || jsonb_build_object('code', 'review_not_found');
      continue;
    end if;

    select id into v_holder
      from public.google_reviews
     where gbp_review_id = v_item ->> 'gbpReviewId'
       and id <> v_row.id;

    if found or (v_row.gbp_review_id is not null
                 and v_row.gbp_review_id <> v_item ->> 'gbpReviewId') then
      v_conflicts := v_conflicts + 1;
      v_problems := v_problems || jsonb_build_object('code', 'link_conflict');
      continue;
    end if;

    if v_row.gbp_review_id is null then
      update public.google_reviews
         set gbp_review_id        = v_item ->> 'gbpReviewId',
             gbp_review_name      = v_item ->> 'gbpReviewName',
             gbp_link_method      = v_item ->> 'method',
             gbp_linked_at        = now(),
             gbp_last_synced_at   = now(),
             gbp_create_time      = nullif(v_item ->> 'createTime', '')::timestamptz,
             gbp_update_time      = nullif(v_item ->> 'updateTime', '')::timestamptz,
             gbp_reviewer_name    = left(v_item ->> 'reviewerName', 200),
             gbp_rating           = nullif(v_item ->> 'rating', '')::smallint,
             gbp_comment          = left(v_item ->> 'comment', 8000),
             gbp_reply_text       = left(v_item ->> 'replyText', 8000),
             gbp_reply_update_time = nullif(v_item ->> 'replyUpdateTime', '')::timestamptz
       where id = v_row.id;
      v_linked := v_linked + 1;
    else
      update public.google_reviews
         set gbp_review_name      = coalesce(v_item ->> 'gbpReviewName', gbp_review_name),
             gbp_last_synced_at   = now(),
             gbp_create_time      = coalesce(nullif(v_item ->> 'createTime', '')::timestamptz, gbp_create_time),
             gbp_update_time      = nullif(v_item ->> 'updateTime', '')::timestamptz,
             gbp_reviewer_name    = left(v_item ->> 'reviewerName', 200),
             gbp_rating           = nullif(v_item ->> 'rating', '')::smallint,
             gbp_comment          = left(v_item ->> 'comment', 8000),
             gbp_reply_text       = left(v_item ->> 'replyText', 8000),
             gbp_reply_update_time = nullif(v_item ->> 'replyUpdateTime', '')::timestamptz
       where id = v_row.id;
      v_refreshed := v_refreshed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'linked', v_linked,
    'refreshed', v_refreshed,
    'conflicts', v_conflicts,
    'missing', v_missing,
    'problems', v_problems
  );
end;
$$;

/*
 * RECORD OFFICIAL REVIEWS THAT NEED A PERSON.
 *
 * An upsert keyed on the official id that never downgrades a resolved item: once
 * somebody has decided, a later sync cannot reopen the question.
 */
create or replace function public.gbp_record_review_items(p_items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_item  jsonb;
  v_count int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'gbp_record_review_items expects a JSON array';
  end if;
  if jsonb_array_length(p_items) > 1000 then
    raise exception 'gbp_record_review_items accepts at most 1000 items per call';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.google_review_reconciliation_items
      (location_id, gbp_review_id, reasons, candidate_review_ids, official)
    values (
      (v_item ->> 'locationId')::uuid,
      v_item ->> 'gbpReviewId',
      coalesce(array(select jsonb_array_elements_text(v_item -> 'reasons')), '{}'),
      coalesce(array(select (jsonb_array_elements_text(v_item -> 'candidateReviewIds'))::uuid), '{}'),
      coalesce(v_item -> 'official', '{}'::jsonb)
    )
    on conflict (gbp_review_id) do update
       set reasons              = excluded.reasons,
           candidate_review_ids = excluded.candidate_review_ids,
           official             = excluded.official,
           last_detected_at     = now()
     where public.google_review_reconciliation_items.status = 'needs_review';
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

/*
 * CONFIRM A LISTING'S BUSINESS PROFILE LOCATION.
 *
 * The one place a mapping becomes `confirmed`. Called by the admin route after
 * it has re-run discovery and re-checked the proposal; the checks here are the
 * ones the database can enforce on its own: the store code must exist, the
 * location must not already belong to another listing, and a rejected listing
 * is not silently resurrected.
 */
create or replace function public.gbp_confirm_location_mapping(
  p_store_code text,
  p_account_name text,
  p_location_name text,
  p_place_id text,
  p_evidence jsonb,
  p_confirmed_by text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_loc    public.google_review_locations%rowtype;
  v_holder text;
begin
  if coalesce(btrim(p_confirmed_by), '') = '' then
    raise exception 'A mapping must be confirmed by a named person';
  end if;

  select * into v_loc
    from public.google_review_locations
   where store_code = p_store_code
     for update;
  if not found then
    return jsonb_build_object('status', 'unknown_store_code');
  end if;

  select store_code into v_holder
    from public.google_review_locations
   where gbp_location_name = p_location_name
     and id <> v_loc.id;
  if found then
    return jsonb_build_object('status', 'location_already_mapped', 'storeCode', v_holder);
  end if;

  if v_loc.gbp_mapping_status = 'rejected' then
    return jsonb_build_object('status', 'previously_rejected');
  end if;

  if v_loc.gbp_mapping_status = 'confirmed'
     and v_loc.gbp_location_name is distinct from p_location_name then
    return jsonb_build_object('status', 'already_confirmed_to_different_location');
  end if;

  update public.google_review_locations
     set gbp_account_name = p_account_name,
         gbp_location_name = p_location_name,
         gbp_place_id = p_place_id,
         gbp_mapping_status = 'confirmed',
         gbp_mapping_evidence = p_evidence,
         gbp_mapping_confirmed_at = now(),
         gbp_mapping_confirmed_by = p_confirmed_by
   where id = v_loc.id;

  return jsonb_build_object('status', 'confirmed');
end;
$$;

revoke all on function public.gbp_apply_links(jsonb) from public, anon, authenticated;
revoke all on function public.gbp_record_review_items(jsonb) from public, anon, authenticated;
revoke all on function public.gbp_confirm_location_mapping(text, text, text, text, jsonb, text)
  from public, anon, authenticated;

comment on function public.gbp_apply_links(jsonb) is
  'Attaches official Business Profile data to stored reviews. Writes gbp_* columns only; never re-points an existing link; cannot touch ratings, text, reply columns, first_seen_week, first_seen_at or the reporting period.';
