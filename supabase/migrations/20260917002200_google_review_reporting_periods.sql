-- ---------------------------------------------------------------------------
-- GOOGLE REVIEWS — REPORTING PERIODS, AND THE ANCHOR THAT DECIDES THEM.
--
-- ===========================================================================
-- THE DEFECT THIS CORRECTS
-- ===========================================================================
--
-- `20260917002000_google_reviews.sql` keyed the reporting week on
-- `first_seen_at`: a review belonged to the week ASK Sunny first saw it. The
-- reasoning was that the legacy manual count measures DISCOVERY rather than
-- posting, which is true — and the implementation was still wrong, in one
-- specific and unacceptable way:
--
--   IMPORTING A BACKLOG INFLATES THE CURRENT WEEK. The first sync of a
--   location pulls in whatever Google has rendered — reviews from last month,
--   last quarter, last year — and every one of them was "first seen today", so
--   every one of them landed in this week's official count. The number a
--   Salon Director reads on Monday would have been the size of the import.
--
-- The legacy process never had this problem, because it does not ask "when did
-- I first see this?". It asks "which reviews sit ABOVE the last one I counted?"
-- — a position in the feed relative to a known boundary. That is the mechanism
-- this migration implements, and `first_seen_at` goes back to being what it
-- always should have been: ingestion metadata.
--
-- ===========================================================================
-- HOW A REVIEW GETS INTO A REPORTING PERIOD NOW
-- ===========================================================================
--
-- Each Google listing carries an ANCHOR: `counted_through_external_review_id`,
-- the newest review that has already been counted. It is a Google review id,
-- never a reviewer name — two customers called "Sarah M." at one salon is
-- exactly the case a name-keyed anchor gets wrong.
--
-- When a sync arrives, the server finds the anchor's POSITION in the submitted
-- feed for that listing. Everything above it is newer and is assigned to the
-- open period. The anchor itself and everything below it are not — the anchor
-- has already been counted, and counting it twice is the specific error the
-- manual process was careful to avoid. The anchor then advances to the newest
-- review just counted, so the next sync starts from there.
--
-- IF THE BOUNDARY CANNOT BE PROVEN, NOTHING IS COUNTED. Three cases, all of
-- which store the reviews and assign them to no period at all:
--
--   NO ANCHOR YET      — the first sync of a listing. Nothing above an unknown
--                        boundary can be called new, so the whole import is
--                        `historical` and the weekly count stays at zero until
--                        somebody establishes the baseline.
--   ANCHOR NOT ON THE PAGE — the feed did not reach back far enough, or the
--                        anchored review was deleted. The boundary is unknown.
--   FEED ORDER UNRELIABLE  — Google's reviews page has a sort control, and a
--                        page sorted by rating makes position meaningless. The
--                        server checks the submitted order against the relative
--                        dates and refuses to assign when they disagree.
--
-- That is the whole safety property: `historical` is the default, and a review
-- is only ever counted when the boundary above it is known.
--
-- ===========================================================================
-- WHAT `first_seen_at` IS NOW
-- ===========================================================================
--
-- Audit metadata, and nothing else. `reporting_week_start` is RENAMED to
-- `first_seen_week` in this migration, because a column named for reporting
-- that is not read by reporting is a trap with a countdown on it.
-- ---------------------------------------------------------------------------

-- The three views are rebuilt at the end. Dropped first so the rename below
-- does not have to work around their dependencies.
drop view if exists public.google_review_location_weeks;
drop view if exists public.google_review_week_anchors;
drop view if exists public.google_review_location_directory;
drop view if exists public.google_reviews_enriched;

-- ------------------------------------------------------------- the enum ----

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_assignment_status') then
    /*
     * TWO STATES, AND THE DEFAULT IS THE SAFE ONE.
     *
     *   historical       No reporting period. The review is stored, shown, and
     *                    searchable, and it raises no count. Every import
     *                    starts here.
     *
     *   anchor_assigned  Proven to sit above the listing's anchor at the moment
     *                    it was read, and therefore assigned to the period that
     *                    was open then. `reporting_period_id` says which.
     *
     * There is deliberately no third state meaning "current period": whether a
     * review is in the CURRENT period is a question about which period it
     * points at and which week it is today, and storing that as a status would
     * be a fact with an expiry date.
     */
    create type public.google_review_assignment_status as enum (
      'historical',
      'anchor_assigned'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_period_status') then
    create type public.google_review_period_status as enum ('open', 'closed');
  end if;
end
$$;

-- ---------------------------------------------------------- the periods ----

create table if not exists public.google_review_periods (
  id uuid primary key default extensions.gen_random_uuid(),

  /*
   * SUNDAY TO SATURDAY, the US retail week the rest of this application
   * already reads. The period is CHAIN-WIDE — one week is one week everywhere —
   * while the ANCHOR that decides membership is per listing, because each
   * Google listing has its own feed and its own last-counted review.
   */
  period_start date not null,
  period_end   date not null,

  /*
   * `closed` means the per-listing ending anchors have been snapshotted into
   * `google_review_period_anchors`. It is not what decides whether a review can
   * still be assigned — the calendar does that — it records that the audit
   * trail for the period has been taken.
   */
  status public.google_review_period_status not null default 'open',

  opened_at timestamptz not null default now(),
  closed_at timestamptz,

  constraint google_review_periods_start_key unique (period_start),
  constraint google_review_periods_is_a_week check (period_end = period_start + 6),
  constraint google_review_periods_closed_has_a_time
    check ((status = 'closed') = (closed_at is not null))
);

comment on table public.google_review_periods is
  'The weekly reporting calendar for Google reviews, Sunday to Saturday. Chain-wide: membership is decided per listing by its anchor, but a week is a week everywhere.';

create index if not exists google_review_periods_start
  on public.google_review_periods (period_start desc);

-- --------------------------------------------- the anchor, per listing -----

alter table public.google_review_locations
  add column if not exists counted_through_external_review_id text
    check (counted_through_external_review_id is null
           or counted_through_external_review_id ~ '^[A-Za-z0-9_-]{6,128}$');

alter table public.google_review_locations
  add column if not exists counted_through_set_at timestamptz;

alter table public.google_review_locations
  add column if not exists counted_through_set_by text
    check (counted_through_set_by is null or length(counted_through_set_by) <= 64);

comment on column public.google_review_locations.counted_through_external_review_id is
  'The newest review already counted for this listing — a GOOGLE REVIEW ID, never a reviewer name. The boundary a sync measures against: everything above it is new, it and everything below are not. Null means no baseline has been established and nothing is being counted for this listing.';

-- ------------------------------------- the per-period anchor snapshots -----

create table if not exists public.google_review_period_anchors (
  id uuid primary key default extensions.gen_random_uuid(),

  period_id   uuid not null references public.google_review_periods (id) on delete cascade,
  location_id uuid not null references public.google_review_locations (id) on delete cascade,

  /*
   * THE ENDING ANCHOR, FROZEN. `counted_through` on the listing moves as syncs
   * arrive; this is what it read when the period closed. That is what makes
   * "which review closed week 38 at KS Manhattan?" answerable in November.
   *
   * The reviewer name is carried BESIDE the id, as the human-readable label a
   * person recognises when checking the number against Google by eye. The id is
   * the anchor; the name is how it is read aloud.
   */
  ending_external_review_id text,
  ending_reviewer_name      text,

  all_reviews        integer not null default 0 check (all_reviews >= 0),
  qualifying_reviews integer not null default 0 check (qualifying_reviews >= 0),

  snapshotted_at timestamptz not null default now(),

  constraint google_review_period_anchors_key unique (period_id, location_id)
);

comment on table public.google_review_period_anchors is
  'One row per listing per closed period: the ending anchor and what the period counted. The auditable replacement for "find the last reviewer we counted and count above them", keyed on Google review ids.';

-- --------------------------------------- the review''s own assignment ------

alter table public.google_reviews
  add column if not exists reporting_period_id uuid references public.google_review_periods (id);

alter table public.google_reviews
  add column if not exists reporting_assignment_status
    public.google_review_assignment_status not null default 'historical';

/*
 * WHERE THIS REVIEW SAT IN THE FEED, AND IN WHICH SYNC.
 *
 * Position is only comparable WITHIN one sync — two runs an hour apart index
 * from different tops — so the run id travels with it. That pair is what lets
 * `google_review_set_anchor` say "these reviews were above the anchor on the
 * page where the anchor was seen" rather than guessing from timestamps.
 */
alter table public.google_reviews
  add column if not exists feed_position integer check (feed_position is null or feed_position >= 0);

alter table public.google_reviews
  add column if not exists feed_run_id uuid references public.google_review_sync_runs (id) on delete set null;

/*
 * AN APPROXIMATE POSTING TIME, DERIVED FROM GOOGLE'S OWN RELATIVE TEXT.
 *
 * "7 hours ago" read at 14:00 becomes 07:00. It is an APPROXIMATION and is
 * never the period key: Google's buckets are coarse ("a month ago" covers five
 * weeks), and manufacturing precision from them is how a review ends up in a
 * week it was not in. It is used for two honest things — ordering the backlog
 * for a human, and checking that a submitted feed really is newest-first.
 *
 * `google_relative_date_text` keeps Google's own words, unchanged, always.
 */
alter table public.google_reviews
  add column if not exists google_estimated_at timestamptz;

comment on column public.google_reviews.google_estimated_at is
  'Approximate posting time derived from Google''s relative text at the moment it was read. Never the reporting period key — the buckets are too coarse. The original text is kept verbatim beside it.';

/*
 * THE COLUMN RENAME, AND THE REASON IT IS WORTH THE CHURN.
 *
 * `reporting_week_start` no longer decides anything about reporting. Leaving a
 * column with that name beside a `reporting_period_id` that does is an
 * invitation for the next person to group by the wrong one — which is exactly
 * the mistake this migration exists to undo. It is ingestion metadata, and it
 * is now named for what it is.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'google_reviews'
       and column_name = 'reporting_week_start'
  ) then
    alter table public.google_reviews rename column reporting_week_start to first_seen_week;
  end if;
end
$$;

comment on column public.google_reviews.first_seen_week is
  'The Sunday of the week ASK Sunny first saw this review. INGESTION METADATA ONLY — it does not decide, and must never decide, which reporting period the review counts in. See reporting_period_id.';

/* A period and a status are one fact stated twice; they must agree. */
alter table public.google_reviews
  drop constraint if exists google_reviews_assignment_agrees;
alter table public.google_reviews
  add constraint google_reviews_assignment_agrees
  check ((reporting_period_id is null) = (reporting_assignment_status = 'historical'));

create index if not exists google_reviews_period
  on public.google_reviews (reporting_period_id, rating);
create index if not exists google_reviews_unassigned
  on public.google_reviews (location_id, first_seen_at desc)
  where reporting_period_id is null;

-- ------------------------------------------------- the freeze, rewritten ---
--
-- A REVIEW IS COUNTED ONCE, IN ONE PERIOD, FOREVER — but it may go from
-- counting in NO period to counting in one, exactly once. That transition is
-- the manual anchor process itself: a backlog lands as `historical`, somebody
-- supplies the last-counted review from the old spreadsheet, and the reviews
-- above it become the period's. Everything else is refused.

create or replace function public.google_reviews_freeze_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.first_seen_week is distinct from old.first_seen_week then
    raise exception
      'google_reviews.first_seen_week is write-once (review %): it records when the review was first seen, not which period it counts in.',
      old.external_review_id;
  end if;

  if new.first_seen_at is distinct from old.first_seen_at then
    raise exception
      'google_reviews.first_seen_at is write-once (review %).',
      old.external_review_id;
  end if;

  if old.reporting_period_id is not null
     and new.reporting_period_id is distinct from old.reporting_period_id then
    raise exception
      'google_reviews.reporting_period_id is write-once once set (review %, % -> %): a review is counted in exactly one reporting period.',
      old.external_review_id, old.reporting_period_id, new.reporting_period_id;
  end if;

  return new;
end;
$$;

revoke all on function public.google_reviews_freeze_period() from public, anon, authenticated;

-- ------------------------------------------------- the relative-date read --
--
-- GOOGLE'S OWN WORDS, TURNED INTO AN APPROXIMATE INSTANT — and null whenever
-- they cannot be read with confidence. An unparsed form returns null rather
-- than a guess, because a wrong timestamp here would silently reorder a
-- backlog and mislead the feed-order check.

create or replace function public.google_review_estimate_from_relative(
  p_text    text,
  p_seen_at timestamptz
) returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text  text;
  v_count numeric;
  v_unit  text;
  v_match text[];
begin
  if p_text is null or p_seen_at is null then return null; end if;

  v_text := lower(btrim(p_text));
  /* "Edited 3 days ago" carries the same age as "3 days ago". */
  v_text := regexp_replace(v_text, '^edited\s+', '');

  if v_text in ('just now', 'today', 'a moment ago', 'moments ago') then
    return p_seen_at;
  end if;
  if v_text = 'yesterday' then
    return p_seen_at - interval '1 day';
  end if;

  v_match := regexp_match(
    v_text,
    '^(a|an|\d{1,4})\s+(second|minute|hour|day|week|month|year)s?\s+ago$'
  );
  if v_match is null then return null; end if;

  v_count := case when v_match[1] in ('a', 'an') then 1 else v_match[1]::numeric end;
  v_unit  := v_match[2];

  return p_seen_at - (v_count * (('1 ' || v_unit)::interval));
end;
$$;

revoke all on function public.google_review_estimate_from_relative(text, timestamptz)
  from public, anon, authenticated;

comment on function public.google_review_estimate_from_relative(text, timestamptz) is
  'Google''s relative text as an approximate instant, or null when it cannot be read with confidence. Never a reporting period key: the buckets are coarse and a guess here would silently reorder a backlog.';

-- ------------------------------------------------------ the open period ----

create or replace function public.google_review_current_period(
  p_at timestamptz default now()
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_start date := public.google_review_week_start(p_at);
  v_id    uuid;
begin
  select id into v_id from public.google_review_periods where period_start = v_start;
  if found then return v_id; end if;

  insert into public.google_review_periods (period_start, period_end)
  values (v_start, v_start + 6)
  on conflict (period_start) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.google_review_periods where period_start = v_start;
  end if;

  return v_id;
end;
$$;

revoke all on function public.google_review_current_period(timestamptz)
  from public, anon, authenticated;

-- --------------------------------------------------------- the ingestion ---
--
-- REWRITTEN. The shape of the change: the SERVER decides which reviews sit
-- above each listing's anchor and passes that decision in, and this function
-- enforces the invariants no caller can be trusted with — that the anchor it
-- measured against is still the current one, that an existing review's period
-- never moves, and that the anchor advances in the same transaction as the
-- assignment.
--
-- WHY THE DECISION IS NOT MADE HERE. It is a business rule with a dozen cases
-- and it has to be testable without a database. It lives in
-- `src/lib/reviews/period-assignment.ts`, which is a pure function with a test
-- per case; this function is where it is made safe. The extension never sees
-- it and cannot influence it: `normaliseReviewBatch` whitelists the fields a
-- caller may send, and `periodAssignment` is not one of them.
--
-- OPTIMISTIC CONCURRENCY ON THE ANCHOR. Each store plan carries the anchor the
-- planner measured against. If the stored anchor has moved since — a second
-- sync from another machine — the plan is stale and that store's reviews are
-- stored as `historical` rather than counted against a boundary that no longer
-- holds.

drop function if exists public.ingest_google_reviews(jsonb, text, text, timestamptz);

create or replace function public.ingest_google_reviews(
  p_reviews        jsonb,
  p_parser_version text,
  p_credential_id  text default null,
  p_seen_at        timestamptz default now(),
  p_store_plans    jsonb default '[]'::jsonb
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
  v_has_reply boolean;
  v_reply     text;
  v_reply_at  text;
  v_status    public.google_review_response_status;
  v_changed   boolean;
  v_assign    boolean;

  v_period    uuid;
  v_run_id    uuid;

  /* store_code -> may this store's reviews be assigned at all */
  v_store_ok       jsonb := '{}'::jsonb;
  /* store_code -> the review id to advance the anchor to, when assigning */
  v_store_advance  jsonb := '{}'::jsonb;
  /* store codes that actually had a review assigned in this run */
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

  /*
   * THE RUN ROW IS WRITTEN FIRST, not last, because every review stores the run
   * it was read in — that pair (run, position) is the only comparable ordering
   * this system has, and a review cannot point at a row that does not exist
   * yet. The counts are filled in at the end.
   */
  insert into public.google_review_sync_runs (ingest_credential_id, parser_version)
  values (p_credential_id, p_parser_version)
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
      /*
       * STALE PLAN. The anchor moved between the read and this write, so the
       * positions the planner measured are against a boundary that no longer
       * holds. Nothing is counted for this store; the reviews are still stored.
       */
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

    select l.id, l.store_code, l.is_active
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

    v_estimate := public.google_review_estimate_from_relative(v_relative, p_seen_at);

    v_has_reply := coalesce((v_item ->> 'hasOwnerResponse')::boolean, false)
                   or v_reply is not null;
    if not v_has_reply then
      v_reply := null;
      v_reply_at := null;
    end if;
    v_status := case when v_has_reply then 'responded' else 'needs_response' end;

    /*
     * THE ASSIGNMENT. `historical` unless the planner proved this review sits
     * above its listing's anchor AND that listing's plan survived the staleness
     * check above. Default-deny, which is the whole correction.
     */
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
        feed_position, feed_run_id
      ) values (
        'google_business_profile', v_external, v_location.id, v_location.store_code,
        left(v_name, 200), v_rating, left(v_text, 8000),
        left(v_relative, 120), v_absolute, v_estimate,
        p_seen_at, p_seen_at,
        v_has_reply, left(v_reply, 8000), left(v_reply_at, 120),
        v_status, public.google_review_week_start(p_seen_at), p_parser_version, p_credential_id,
        case when v_assign then v_period else null end,
        /*
         * CAST EXPLICITLY. A `case` over two string literals is `text`, and
         * Postgres will not coerce it into an enum column — which is a good
         * refusal: it is the same check that stops a typo becoming a silent
         * third assignment state.
         */
        (case when v_assign then 'anchor_assigned' else 'historical' end)
          ::public.google_review_assignment_status,
        v_position, v_run_id
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
        update public.google_reviews r
           set last_seen_at = p_seen_at
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

    /*
     * AN EXISTING REVIEW'S PERIOD IS NEVER MOVED. The only transition allowed
     * is `historical` -> assigned, and only when this sync proved the review is
     * above the anchor — which is what happens when a backlog was imported
     * before anybody established the baseline. The freeze trigger enforces the
     * rest independently of this function.
     */
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
  --
  -- ONLY WHERE SOMETHING WAS ACTUALLY COUNTED. A store whose feed held nothing
  -- new, or whose boundary could not be proven, keeps the anchor it had — so a
  -- sync that proves nothing changes nothing.

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
    /* The two figures that matter now: what counted, and what did not. */
    'countedIntoPeriod', v_counted,
    'storedAsHistorical', v_historical,
    'problems',      v_problems
  );
end;
$$;

revoke all on function public.ingest_google_reviews(jsonb, text, text, timestamptz, jsonb)
  from public, anon, authenticated;

comment on function public.ingest_google_reviews(jsonb, text, text, timestamptz, jsonb) is
  'Idempotent batch upsert. A review is assigned to the open reporting period ONLY where the caller proved it sits above the listing''s anchor and that anchor has not moved since; everything else is stored as historical and counts toward nothing. An existing review''s period is never moved.';

-- ------------------------------------------------------- setting anchors ---
--
-- THE MANUAL PROCESS, MECHANISED. The old spreadsheet records the last reviewer
-- counted at each salon; this takes that review's GOOGLE ID and makes it the
-- boundary. Reviews already held that sat above it ON THE PAGE WHERE IT WAS
-- SEEN become the open period's.
--
-- WHY "ON THE PAGE WHERE IT WAS SEEN" AND NOT "NEWER BY TIMESTAMP". Google's
-- relative text is bucketed to the day, week or month, so a timestamp
-- comparison cannot separate two reviews from the same Tuesday — and getting
-- that wrong in either direction is a miscount. Feed position within one sync
-- run is exact, so that is what is used, and anything not seen in the same run
-- as the anchor is left historical and reported.

create or replace function public.google_review_set_anchor(
  p_store_code         text,
  p_external_review_id text,
  p_credential_id      text default null,
  p_assign_above       boolean default true,
  p_at                 timestamptz default now()
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_location record;
  v_anchor   record;
  v_period   uuid;
  v_assigned int := 0;
  v_skipped  int := 0;
begin
  select l.id, l.store_code
    into v_location
    from public.google_review_locations l
   where l.store_code = btrim(coalesce(p_store_code, ''));

  if not found then
    return jsonb_build_object('storeCode', p_store_code, 'status', 'unknown_store');
  end if;

  select r.id, r.external_review_id, r.reviewer_name, r.feed_position, r.feed_run_id
    into v_anchor
    from public.google_reviews r
   where r.location_id = v_location.id
     and r.external_review_id = btrim(coalesce(p_external_review_id, ''));

  if not found then
    /*
     * REFUSED RATHER THAN STORED. An anchor naming a review this system does
     * not hold is a boundary nothing can be measured against, and accepting it
     * would silently stop the listing counting.
     */
    return jsonb_build_object(
      'storeCode', v_location.store_code,
      'status', 'review_not_held'
    );
  end if;

  update public.google_review_locations l
     set counted_through_external_review_id = v_anchor.external_review_id,
         counted_through_set_at = p_at,
         counted_through_set_by = left(coalesce(p_credential_id, 'manual'), 64)
   where l.id = v_location.id;

  if p_assign_above then
    v_period := public.google_review_current_period(p_at);

    if v_anchor.feed_run_id is not null and v_anchor.feed_position is not null then
      update public.google_reviews r
         set reporting_period_id = v_period,
             reporting_assignment_status = 'anchor_assigned'
       where r.location_id = v_location.id
         and r.reporting_period_id is null
         and r.feed_run_id = v_anchor.feed_run_id
         and r.feed_position < v_anchor.feed_position;
      get diagnostics v_assigned = row_count;
    end if;

    /* Held, unassigned, and not comparable with the anchor. Reported, not guessed. */
    select count(*) into v_skipped
      from public.google_reviews r
     where r.location_id = v_location.id
       and r.reporting_period_id is null
       and (v_anchor.feed_run_id is null
            or r.feed_run_id is distinct from v_anchor.feed_run_id
            or r.feed_position is null);
  end if;

  return jsonb_build_object(
    'storeCode', v_location.store_code,
    'status', 'anchor_set',
    'anchorReviewId', v_anchor.external_review_id,
    'anchorReviewer', v_anchor.reviewer_name,
    'assignedAbove', v_assigned,
    'leftHistorical', v_skipped
  );
end;
$$;

revoke all on function public.google_review_set_anchor(text, text, text, boolean, timestamptz)
  from public, anon, authenticated;

/**
 * THE BASELINE: "everything we hold is already history; count from the next
 * review onward."
 *
 * The safe way to start a listing that has no anchor. It assigns NOTHING — it
 * only draws the line — so the first week after a backfill counts exactly the
 * reviews that arrive after it, which is the behaviour the manual process has
 * always had on the week it started.
 */
create or replace function public.google_review_baseline_anchor(
  p_store_code    text,
  p_credential_id text default null,
  p_at            timestamptz default now()
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_location record;
  v_newest   record;
begin
  select l.id, l.store_code
    into v_location
    from public.google_review_locations l
   where l.store_code = btrim(coalesce(p_store_code, ''));

  if not found then
    return jsonb_build_object('storeCode', p_store_code, 'status', 'unknown_store');
  end if;

  /*
   * THE NEWEST REVIEW HELD, by the most recent sync's own ordering. Position 0
   * of the latest run is the top of the feed as Google last showed it, which is
   * the only definition of "newest" this system can defend.
   */
  select r.external_review_id, r.reviewer_name
    into v_newest
    from public.google_reviews r
   where r.location_id = v_location.id
     and r.feed_run_id is not null
     and r.feed_position is not null
   order by r.feed_run_id = (
              select r2.feed_run_id
                from public.google_reviews r2
               where r2.location_id = v_location.id
                 and r2.feed_run_id is not null
               order by r2.last_seen_at desc
               limit 1
            ) desc,
            r.feed_position asc
   limit 1;

  if not found then
    return jsonb_build_object(
      'storeCode', v_location.store_code,
      'status', 'nothing_held'
    );
  end if;

  update public.google_review_locations l
     set counted_through_external_review_id = v_newest.external_review_id,
         counted_through_set_at = p_at,
         counted_through_set_by = left(coalesce(p_credential_id, 'baseline'), 64)
   where l.id = v_location.id;

  return jsonb_build_object(
    'storeCode', v_location.store_code,
    'status', 'baseline_set',
    'anchorReviewId', v_newest.external_review_id,
    'anchorReviewer', v_newest.reviewer_name,
    'assignedAbove', 0
  );
end;
$$;

revoke all on function public.google_review_baseline_anchor(text, text, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------- closing a week -
--
-- Snapshots each listing's anchor and what the period counted, so the answer to
-- "which review closed week 38 at KS Manhattan, and how many counted?" survives
-- the anchor moving on. Idempotent.

create or replace function public.google_review_close_period(
  p_period_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_rows int;
begin
  insert into public.google_review_period_anchors (
    period_id, location_id, ending_external_review_id, ending_reviewer_name,
    all_reviews, qualifying_reviews
  )
  select p_period_id,
         l.id,
         l.counted_through_external_review_id,
         (select r.reviewer_name
            from public.google_reviews r
           where r.location_id = l.id
             and r.external_review_id = l.counted_through_external_review_id),
         count(c.id),
         count(c.id) filter (where c.eligible_for_weekly_count)
    from public.google_review_locations l
    left join public.google_reviews c
      on c.location_id = l.id
     and c.reporting_period_id = p_period_id
   group by l.id, l.counted_through_external_review_id
  on conflict (period_id, location_id) do update
     set ending_external_review_id = excluded.ending_external_review_id,
         ending_reviewer_name      = excluded.ending_reviewer_name,
         all_reviews               = excluded.all_reviews,
         qualifying_reviews        = excluded.qualifying_reviews,
         snapshotted_at            = now();

  get diagnostics v_rows = row_count;

  update public.google_review_periods
     set status = 'closed', closed_at = now()
   where id = p_period_id;

  return jsonb_build_object('periodId', p_period_id, 'listingsSnapshotted', v_rows);
end;
$$;

revoke all on function public.google_review_close_period(uuid)
  from public, anon, authenticated;

-- --------------------------------------------------------------- views -----

create or replace view public.google_reviews_enriched
with (security_invoker = true) as
select
  r.id,
  r.source,
  r.external_review_id,
  r.store_code,
  r.location_id,
  l.salon_id,
  d.salon_number,
  d.store_name        as location_name,
  d.district_label    as district,
  d.region_label      as region,
  l.google_location_label,
  l.website_url,
  l.listing_state,
  r.reviewer_name,
  r.rating,
  r.review_text,
  r.google_relative_date_text,
  r.google_absolute_date,
  r.google_estimated_at,
  r.first_seen_at,
  r.last_seen_at,
  r.first_seen_week,
  r.has_owner_response,
  r.owner_response_text,
  r.owner_response_date_text,
  r.response_status,
  r.eligible_for_weekly_count,

  /* THE REPORTING TRUTH. Null period means it counts toward nothing. */
  r.reporting_period_id,
  r.reporting_assignment_status,
  p.period_start,
  p.period_end,
  p.status            as period_status,

  r.feed_position,
  r.feed_run_id,
  r.parser_version,
  r.created_at,
  r.updated_at
from public.google_reviews r
join public.google_review_locations l on l.id = r.location_id
left join public.google_review_periods p on p.id = r.reporting_period_id
left join public.salon_directory d on d.salon_id = l.salon_id;

comment on view public.google_reviews_enriched is
  'One row per Google review with its salon name and district resolved through salon_directory, and its reporting period resolved through google_review_periods. A null period_start means the review is historical: stored and shown, counted nowhere.';

/*
 * THE LEADERBOARD'S ROW SET, now carrying the anchor and the backlog.
 *
 * All fifteen listings whether or not they hold a review, plus the two facts a
 * person needs before trusting any weekly number: whether this listing has an
 * anchor at all, and how much of what it holds is uncounted backlog.
 */
create or replace view public.google_review_location_directory
with (security_invoker = true) as
select
  l.id            as location_id,
  l.store_code,
  l.salon_id,
  d.salon_number,
  d.store_name    as location_name,
  d.district_label as district,
  d.region_label  as region,
  l.google_location_label,
  l.website_url,
  l.listing_state,
  l.is_active,
  l.counted_through_external_review_id,
  l.counted_through_set_at,
  (select r.reviewer_name
     from public.google_reviews r
    where r.location_id = l.id
      and r.external_review_id = l.counted_through_external_review_id) as counted_through_reviewer,
  (select count(*)
     from public.google_reviews r
    where r.location_id = l.id
      and r.reporting_period_id is null) as historical_reviews,
  (select count(*)
     from public.google_reviews r
    where r.location_id = l.id) as held_reviews
from public.google_review_locations l
left join public.salon_directory d on d.salon_id = l.salon_id;

comment on view public.google_review_location_directory is
  'The fifteen listings with the salon they resolve to, their reporting anchor, and how many held reviews are historical (counted nowhere). A listing with a null anchor is counting nothing, which is a fact the dashboard has to be able to state.';

/*
 * LISTING x PERIOD counts. COUNTED REVIEWS ONLY — a review with no period is
 * absent from every column here by construction, which is what makes it
 * impossible for a backlog to reach a weekly figure.
 */
create or replace view public.google_review_location_periods
with (security_invoker = true) as
select
  r.location_id,
  r.store_code,
  r.reporting_period_id,
  p.period_start,
  p.period_end,

  count(*)                                                      as all_reviews,
  count(*) filter (where r.eligible_for_weekly_count)           as qualifying_reviews,
  count(*) filter (where not r.eligible_for_weekly_count)       as critical_reviews,
  count(*) filter (where r.response_status = 'needs_response')  as unanswered,
  count(*) filter (
    where r.response_status = 'needs_response' and r.rating <= 2
  )                                                             as critical_unanswered,

  count(*) filter (where r.rating = 1) as rating_1,
  count(*) filter (where r.rating = 2) as rating_2,
  count(*) filter (where r.rating = 3) as rating_3,
  count(*) filter (where r.rating = 4) as rating_4,
  count(*) filter (where r.rating = 5) as rating_5,

  sum(r.rating)::bigint                as rating_sum,
  min(r.first_seen_at)                 as first_seen_at,
  max(r.first_seen_at)                 as last_seen_at
from public.google_reviews r
join public.google_review_periods p on p.id = r.reporting_period_id
group by r.location_id, r.store_code, r.reporting_period_id, p.period_start, p.period_end;

comment on view public.google_review_location_periods is
  'Counts per listing per REPORTING PERIOD, over assigned reviews only. Sums rather than averages, so district and chain figures re-aggregate correctly. A historical review cannot appear here at all.';

/*
 * THE BACKLOG, counted separately and never mixed in. This is what the
 * dashboard shows under "imported, not counted", and what tells somebody a
 * listing is waiting for an anchor.
 */
create or replace view public.google_review_location_backlog
with (security_invoker = true) as
select
  r.location_id,
  r.store_code,
  count(*)                                                      as historical_reviews,
  count(*) filter (where r.eligible_for_weekly_count)           as historical_qualifying,
  count(*) filter (where r.response_status = 'needs_response')  as historical_unanswered,
  count(*) filter (
    where r.response_status = 'needs_response' and r.rating <= 2
  )                                                             as historical_critical_unanswered,
  sum(r.rating)::bigint                                         as rating_sum,
  min(coalesce(r.google_estimated_at, r.first_seen_at))         as oldest_estimated_at,
  max(coalesce(r.google_estimated_at, r.first_seen_at))         as newest_estimated_at
from public.google_reviews r
where r.reporting_period_id is null
group by r.location_id, r.store_code;

comment on view public.google_review_location_backlog is
  'Held reviews assigned to no reporting period, per listing. Imported backlog and anything whose position could not be proven — stored, shown, searchable, and counted toward nothing.';

/*
 * THE PERIOD AUDIT. For each period and listing: what counted, and which review
 * opened and closed the counted run. Reads the frozen snapshot where the period
 * has been closed and the live anchor where it has not, so an open week is
 * answerable too.
 */
create or replace view public.google_review_period_summary
with (security_invoker = true) as
select
  p.id                as period_id,
  p.period_start,
  p.period_end,
  p.status            as period_status,
  lp.location_id,
  lp.store_code,
  d.store_name        as location_name,
  d.district_label    as district,
  lp.all_reviews,
  lp.qualifying_reviews,
  lp.critical_reviews,
  coalesce(a.ending_external_review_id, l.counted_through_external_review_id)
                      as ending_anchor_review_id,
  coalesce(a.ending_reviewer_name, dir.counted_through_reviewer)
                      as ending_anchor_reviewer,
  (a.id is not null)  as anchor_snapshotted,
  (array_agg(r.external_review_id order by r.first_seen_at, r.id))[1]
                      as opening_review_id,
  (array_agg(r.reviewer_name     order by r.first_seen_at, r.id))[1]
                      as opening_reviewer
from public.google_review_periods p
join public.google_review_location_periods lp on lp.reporting_period_id = p.id
join public.google_review_locations l on l.id = lp.location_id
left join public.google_review_location_directory dir on dir.location_id = lp.location_id
left join public.salon_directory d on d.salon_id = l.salon_id
left join public.google_review_period_anchors a
       on a.period_id = p.id and a.location_id = lp.location_id
left join public.google_reviews r
       on r.reporting_period_id = p.id
      and r.location_id = lp.location_id
      and r.eligible_for_weekly_count
group by p.id, p.period_start, p.period_end, p.status,
         lp.location_id, lp.store_code, d.store_name, d.district_label,
         lp.all_reviews, lp.qualifying_reviews, lp.critical_reviews,
         a.ending_external_review_id, l.counted_through_external_review_id,
         a.ending_reviewer_name, dir.counted_through_reviewer, a.id;

comment on view public.google_review_period_summary is
  'Per period and listing: what the period counted and which review closed it, from the frozen snapshot once the period is closed and from the live anchor while it is open. The auditable replacement for "find the last reviewer we counted".';

-- -------------------------------------------------------------- security ---

alter table public.google_review_periods        enable row level security;
alter table public.google_review_periods        force  row level security;
alter table public.google_review_period_anchors enable row level security;
alter table public.google_review_period_anchors force  row level security;

revoke all on public.google_review_periods         from anon, authenticated;
revoke all on public.google_review_period_anchors  from anon, authenticated;
revoke all on public.google_reviews_enriched             from anon, authenticated;
revoke all on public.google_review_location_directory    from anon, authenticated;
revoke all on public.google_review_location_periods      from anon, authenticated;
revoke all on public.google_review_location_backlog      from anon, authenticated;
revoke all on public.google_review_period_summary        from anon, authenticated;
