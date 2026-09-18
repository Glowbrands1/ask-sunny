-- ---------------------------------------------------------------------------
-- GOOGLE REVIEWS — the real review records, one row per Google review.
--
-- Phase 1 of Google review ingestion. The Google Business Profile API is not
-- available to this business (approval could not be obtained), so the reviews
-- arrive from an authorized person's own signed-in Brave session: a Manifest V3
-- extension reads the reviews Google has already rendered to them, and posts
-- normalised records at an ASK Sunny endpoint. The extension never touches
-- Supabase, and there is no Google credential anywhere in this system.
--
-- ===========================================================================
-- THE ONE THING TO READ BEFORE TOUCHING THIS FILE
-- ===========================================================================
--
-- A GOOGLE STORE CODE IS NOT AN ASK SUNNY SALON NUMBER, and for this estate the
-- two collide in the worst possible way — they overlap without agreeing:
--
--   Google store code 306  is  KS Manhattan             ASK Sunny salon 0462
--   ASK Sunny salon   0306 is  MO Kansas City Wornall   Google store code 140
--
--   Google store code 314  is  KS Lawrence              ASK Sunny salon 0468
--   ASK Sunny salon   0314 is  NE Omaha 144th and Center  Google store code 148
--
--   Google store code 307  is  KS Shawnee Mission Pkwy  ASK Sunny salon 0463
--   ASK Sunny salon   0307 is  NE Grand Island          Google store code 141
--
-- So zero-padding a Google store code and joining it to `salons.salon_number`
-- succeeds, silently, and files three salons' reviews under three different
-- salons. Nothing would look broken. That is why the mapping below is an
-- explicit table with a foreign key rather than a string transformation, and
-- why `google_reviews` NEVER stores a salon number of its own — it stores a
-- `location_id`, and the salon comes back through the mapping row.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY *NOT* STORED HERE
-- ===========================================================================
--
-- THE DISTRICT AND THE STORE NAME. Both already exist — `public.salon_directory`
-- resolves them from the most recent non-superseded `salon_period_attributes`
-- row, and it is the same view the analytics screens read. Copying a district
-- onto a review row would create a second district taxonomy that drifts the
-- first time a salon changes manager, and the copy is the one nobody updates.
-- They are joined in `google_reviews_enriched` instead, so every reader sees
-- one answer.
--
-- ===========================================================================
-- THE REPORTING RULE, IN THE DATABASE RATHER THAN IN A QUERY
-- ===========================================================================
--
-- The existing directive: only 3-, 4- and 5-star reviews count toward the
-- official weekly Google Review total. 1- and 2-star reviews are still stored,
-- still shown, and still worked in the response queue — they simply do not
-- raise the number. `eligible_for_weekly_count` is a GENERATED column, so no
-- query can disagree with the rule and no ingestion path can forget it.
--
-- ===========================================================================
-- THE REPORTING WEEK, AND WHY IT IS FIRST-SEEN
-- ===========================================================================
--
-- The legacy manual process opens each listing, finds the reviewer who was last
-- counted, and counts everything above them. What that actually measures is
-- "reviews that appeared since the last count" — a DISCOVERY window, not a
-- posting window. Google's own interface gives relative text ("7 hours ago"),
-- so a posting timestamp is not reliably available at all.
--
-- So a review belongs to the week it was FIRST SEEN by ASK Sunny, which is the
-- same thing the manual count measures and is knowable exactly. It is frozen at
-- insert by a trigger: a review can never move between weeks, which is what
-- makes "these are the 37 reviews behind Monday's number" answerable a month
-- later. `google_absolute_date` exists for when a real posting timestamp
-- becomes available; it is display and audit, never the period key.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------- enums ----

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_source') then
    /*
     * WHERE A REVIEW CAME FROM. One member today, and it is an enum anyway:
     * the deduplication key is (source, external_review_id), and an id from a
     * future source — the Business Profile API, a partner feed — must not be
     * able to collide with a `data-lid` from the browser extension.
     */
    create type public.google_review_source as enum ('google_business_profile');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_response_status') then
    create type public.google_review_response_status as enum (
      'needs_response',
      'responded'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_listing_state') then
    /*
     * WHAT GOOGLE CURRENTLY SAYS ABOUT THE LISTING ITSELF.
     *
     * Two profiles show a verification problem on Google today (KS Lawrence and
     * MO Kansas City Wornall). That is a fact about the Google listing, not
     * about the salon: both are trading, both are in the roster, and both stay
     * in every total. Recording it here means the dashboard can say "Google is
     * not currently serving reviews for this listing" instead of the salon
     * silently reading as a quiet week.
     */
    create type public.google_listing_state as enum (
      'verified',
      'verification_required'
    );
  end if;
end
$$;

-- ------------------------------------------------------ the week helper ----
--
-- SUNDAY-TO-SATURDAY, IN THE BUSINESS ZONE. The same week `businessWeekEnd()`
-- in `src/lib/business-date.ts` uses — the US retail week salon schedules and
-- the existing weekly review count are already read in.
--
-- THE ZONE IS A LITERAL AND IT MUST MATCH `BUSINESS_TIMEZONE`. A mismatch would
-- put a Saturday-evening review in a different week on the server than on the
-- dashboard, which is the kind of off-by-one nobody finds for a month.
-- `src/lib/reviews/reporting-week.test.ts` reads this file as text and asserts
-- the two agree, so the pair cannot drift silently.

create or replace function public.google_review_week_start(
  p_at timestamptz,
  p_zone text default 'America/New_York'
) returns date
language sql
immutable
set search_path = ''
as $$
  select ((p_at at time zone p_zone)::date
          - extract(dow from (p_at at time zone p_zone))::int);
$$;

comment on function public.google_review_week_start(timestamptz, text) is
  'The Sunday that opens the US retail week containing this instant, in the business timezone. The reporting period key for a Google review, frozen at insert.';

-- ------------------------------------------------ the store code mapping ---

create table if not exists public.google_review_locations (
  id uuid primary key default extensions.gen_random_uuid(),

  /*
   * THE GOOGLE STORE CODE, EXACTLY AS GOOGLE RENDERS IT, AND AS TEXT.
   *
   * Text for the same reason `salons.salon_number` is text — a code that looks
   * numeric is not a number, and the moment one is read as an integer the
   * leading zeros go and the history splits. Here it matters even more: see the
   * header. This column is never compared with, derived from, or coerced into a
   * salon number.
   */
  store_code text not null,

  /*
   * THE SALON THIS LISTING IS. A real foreign key, so a review can only ever
   * be filed against a salon that exists in the roster every other report
   * reads. `on delete restrict`: deleting a salon that has reviews should fail
   * loudly rather than orphan them.
   */
  salon_id uuid not null references public.salons (id) on delete restrict,

  /* The listing's own name on Google, for a person reconciling the two lists. */
  google_location_label text not null,

  /*
   * OPTIONAL AND NEVER GUESSED. Phase 1 does not need a website and must not
   * block ingestion on one; these are filled in by hand later. Nothing here
   * scrapes or infers a URL.
   */
  website_url text
    check (website_url is null or website_url ~ '^https?://[^\s]{3,300}$'),

  listing_state public.google_listing_state not null default 'verified',

  /*
   * Whether reviews may be ingested for this listing at all. A closed salon
   * stops accepting reviews without its history being deleted.
   */
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint google_review_locations_store_code_key unique (store_code),
  /* One Google listing per salon. Two would double-count every total. */
  constraint google_review_locations_salon_key unique (salon_id),
  constraint google_review_locations_store_code_format
    check (store_code ~ '^[0-9]{1,8}$'),
  constraint google_review_locations_label_not_blank
    check (btrim(google_location_label) <> '')
);

drop trigger if exists google_review_locations_touch_updated_at on public.google_review_locations;
create trigger google_review_locations_touch_updated_at
  before update on public.google_review_locations
  for each row execute function public.touch_updated_at();

comment on table public.google_review_locations is
  'The allowlist: one row per Sun Tan City Google listing this system will ingest, mapping the Google store code to an ASK Sunny salon. A store code is NOT a salon number — for this estate 306, 307 and 314 mean different salons in each system — so the mapping is a table with a foreign key and never a string transformation.';
comment on column public.google_review_locations.store_code is
  'Google''s own store code, as text. Never zero-padded, never compared with salons.salon_number, never coerced to a number.';
comment on column public.google_review_locations.listing_state is
  'What Google currently says about the listing. verification_required is a fact about the Google profile, not about the salon: the salon stays in the roster and in every total.';

-- ------------------------------------------------------- the reviews -------

create table if not exists public.google_reviews (
  id uuid primary key default extensions.gen_random_uuid(),

  source public.google_review_source not null default 'google_business_profile',

  /*
   * THE DEDUPLICATION KEY — Google's own review id, read from `data-lid`.
   *
   * Never the reviewer's name. Two people called "Sarah M." leave reviews at
   * the same salon in the same week, and the legacy process — which keys on a
   * name — counts one of them. The unique constraint below is what makes a
   * second sync of the same page a no-op rather than a duplicate, and it is why
   * the extension can be clicked as many times as anybody likes.
   */
  external_review_id text not null,

  /*
   * THE LISTING, AND THROUGH IT THE SALON. `store_code` is carried alongside as
   * the value that actually arrived, so a mapping corrected later cannot
   * rewrite what the extension reported.
   */
  location_id uuid not null references public.google_review_locations (id) on delete restrict,
  store_code text not null,

  reviewer_name text not null
    check (length(btrim(reviewer_name)) > 0 and length(reviewer_name) <= 200),

  rating smallint not null check (rating between 1 and 5),

  /*
   * NULL MEANS "RATING ONLY", WHICH IS A REAL AND COMMON CASE and is not the
   * same as an empty string. The dashboard prints "Rating only — no written
   * comment." for a null and would print nothing at all for a blank.
   */
  review_text text check (review_text is null or length(review_text) <= 8000),

  /*
   * WHAT GOOGLE ACTUALLY SHOWED. Google's reviews interface renders relative
   * time ("7 hours ago", "2 days ago"), and that text is preserved verbatim
   * rather than converted into a timestamp nobody can audit.
   */
  google_relative_date_text text
    check (google_relative_date_text is null or length(google_relative_date_text) <= 120),

  /*
   * AN ABSOLUTE POSTING TIME, WHEN ONE IS EVER AVAILABLE. Nullable and unused
   * in Phase 1. It is display and audit only — the reporting period is keyed on
   * first_seen_at, so filling this in later cannot move a review between weeks.
   */
  google_absolute_date timestamptz,

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  has_owner_response boolean not null default false,
  owner_response_text text
    check (owner_response_text is null or length(owner_response_text) <= 8000),
  owner_response_date_text text
    check (owner_response_date_text is null or length(owner_response_date_text) <= 120),

  response_status public.google_review_response_status not null default 'needs_response',

  /*
   * THE REPORTING RULE, GENERATED RATHER THAN SUPPLIED.
   *
   * No caller passes this and no caller can contradict it. 3, 4 and 5 count
   * toward the official weekly total; 1 and 2 do not. Every dashboard figure
   * that claims to be "qualifying" reads this column.
   */
  eligible_for_weekly_count boolean
    generated always as (rating >= 3) stored,

  /*
   * THE WEEK THIS REVIEW COUNTED IN. Frozen at insert by the trigger below — a
   * review is counted once, in one week, forever. See the header for why it is
   * keyed on discovery rather than on Google's posting text.
   */
  reporting_week_start date not null,

  /*
   * WHICH PARSER READ IT. Google's markup changes; when a field starts coming
   * back wrong, this is what says which records to re-check.
   */
  parser_version text not null
    check (length(btrim(parser_version)) > 0 and length(parser_version) <= 40),

  /*
   * WHICH SYNC CREDENTIAL FILED IT. The credential's operator-chosen ID, never
   * the secret. This is what an audit line uses and what says which credential
   * to revoke.
   */
  ingest_credential_id text check (ingest_credential_id is null or length(ingest_credential_id) <= 64),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * THE CONSTRAINT THE WHOLE DESIGN RESTS ON. A duplicate import is refused by
   * the database, not merely avoided by the application.
   */
  constraint google_reviews_external_id_key unique (source, external_review_id),

  constraint google_reviews_external_id_format
    check (external_review_id ~ '^[A-Za-z0-9_-]{6,128}$'),

  /* An owner response and "responded" are one fact stated twice; they must agree. */
  constraint google_reviews_response_agrees
    check (
      (response_status = 'responded' and has_owner_response)
      or (response_status = 'needs_response' and not has_owner_response)
    ),
  /* Response text without a response is a parse error, not a record. */
  constraint google_reviews_response_text_needs_response
    check (owner_response_text is null or has_owner_response),

  constraint google_reviews_last_seen_after_first
    check (last_seen_at >= first_seen_at)
);

drop trigger if exists google_reviews_touch_updated_at on public.google_reviews;
create trigger google_reviews_touch_updated_at
  before update on public.google_reviews
  for each row execute function public.touch_updated_at();

/*
 * FIRST SEEN AND THE REPORTING WEEK ARE WRITE-ONCE.
 *
 * "Never assign the same review to more than one reporting period" is the
 * business rule; this is the mechanism. An UPDATE that tries to move either
 * fails loudly rather than quietly restating last week's number.
 */
create or replace function public.google_reviews_freeze_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reporting_week_start is distinct from old.reporting_week_start then
    raise exception
      'google_reviews.reporting_week_start is write-once (review %, % -> %): a review is counted in exactly one weekly period.',
      old.external_review_id, old.reporting_week_start, new.reporting_week_start;
  end if;
  if new.first_seen_at is distinct from old.first_seen_at then
    raise exception
      'google_reviews.first_seen_at is write-once (review %): it is the anchor the reporting week was derived from.',
      old.external_review_id;
  end if;
  return new;
end;
$$;

revoke all on function public.google_reviews_freeze_period() from public, anon, authenticated;

drop trigger if exists google_reviews_freeze_period on public.google_reviews;
create trigger google_reviews_freeze_period
  before update on public.google_reviews
  for each row execute function public.google_reviews_freeze_period();

comment on table public.google_reviews is
  'One row per Google review, deduplicated on (source, external_review_id) — Google''s own data-lid, never the reviewer name. eligible_for_weekly_count is generated from the rating so no query can disagree with the 3-star rule, and the reporting week is frozen at insert so a review is counted once.';
comment on column public.google_reviews.external_review_id is
  'Google''s review id, read from the data-lid attribute. The deduplication key, and the reason a repeated sync is a no-op.';
comment on column public.google_reviews.eligible_for_weekly_count is
  'Generated: rating >= 3. The official weekly total counts 3, 4 and 5 stars; 1 and 2 are stored, shown and worked, and never raise the number.';
comment on column public.google_reviews.reporting_week_start is
  'The Sunday of the week this review was first seen. Write-once — a review belongs to exactly one weekly period, forever.';

/* The dashboard's own reads: a week, a salon, the queue, the rating split. */
create index if not exists google_reviews_week
  on public.google_reviews (reporting_week_start desc, rating);
create index if not exists google_reviews_location
  on public.google_reviews (location_id, reporting_week_start desc);
create index if not exists google_reviews_queue
  on public.google_reviews (response_status, rating, first_seen_at);
create index if not exists google_reviews_first_seen
  on public.google_reviews (first_seen_at desc);

-- -------------------------------------------------------- the sync runs ----
--
-- ONE ROW PER SYNC, so "last successful sync" is a fact rather than something
-- the extension remembers about itself, and so a run that imported nothing can
-- be told apart from a run that never happened.

create table if not exists public.google_review_sync_runs (
  id uuid primary key default extensions.gen_random_uuid(),

  started_at timestamptz not null default now(),

  /* The credential's id, never its secret. */
  ingest_credential_id text check (ingest_credential_id is null or length(ingest_credential_id) <= 64),
  parser_version text not null,

  received        integer not null default 0 check (received >= 0),
  created_count   integer not null default 0 check (created_count >= 0),
  updated_count   integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  ignored_non_stc integer not null default 0 check (ignored_non_stc >= 0),
  invalid_count   integer not null default 0 check (invalid_count >= 0),

  /*
   * WHY records were refused — a list of `{code, storeCode}` findings, never a
   * reviewer name and never review text. A refusal is an operational fact about
   * the parser, and a rejected payload is exactly where somebody's words should
   * not be retained.
   */
  problems jsonb not null default '[]'::jsonb
);

comment on table public.google_review_sync_runs is
  'One row per accepted sync request. Carries counts and refusal codes only — never a reviewer name and never review text, because a rejected payload is the last place to retain somebody''s words.';

create index if not exists google_review_sync_runs_started
  on public.google_review_sync_runs (started_at desc);

-- ------------------------------------------------------------- the view ----
--
-- WHAT EVERY READER READS. The review, its listing, and the salon's CURRENT
-- name and district from `salon_directory` — the same view the analytics
-- screens resolve a district through, so there is one district taxonomy in this
-- application and not two.

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
  r.first_seen_at,
  r.last_seen_at,
  r.has_owner_response,
  r.owner_response_text,
  r.owner_response_date_text,
  r.response_status,
  r.eligible_for_weekly_count,
  r.reporting_week_start,
  (r.reporting_week_start + 6) as reporting_week_end,
  r.parser_version,
  r.created_at,
  r.updated_at
from public.google_reviews r
join public.google_review_locations l on l.id = r.location_id
left join public.salon_directory d on d.salon_id = l.salon_id;

comment on view public.google_reviews_enriched is
  'One row per Google review with its salon''s current store name and district resolved through salon_directory. The district is joined, never copied onto the review, so this application has one district taxonomy rather than two that drift.';

-- --------------------------------------------------- the weekly anchors ----
--
-- THE AUDIT THE LEGACY PROCESS DID BY HAND.
--
-- Somebody used to write down the last reviewer counted last week and count
-- everything above that name. This answers the same question and answers it
-- with review ids: for each week and each listing, which review OPENED the
-- counted run and which CLOSED it. The reviewer names are carried because that
-- is what a person checking the number against Google will recognise — but they
-- are the label, and the id is the anchor.
--
-- QUALIFYING REVIEWS ONLY, because that is what the weekly number counts. The
-- 1- and 2-star reviews of the same week are excluded here and present
-- everywhere else, which is precisely the distinction the directive draws.

create or replace view public.google_review_week_anchors
with (security_invoker = true) as
select
  r.reporting_week_start,
  (r.reporting_week_start + 6)                      as reporting_week_end,
  r.location_id,
  r.store_code,
  d.store_name                                      as location_name,
  d.district_label                                  as district,
  count(*)                                          as qualifying_reviews,
  min(r.first_seen_at)                              as opened_at,
  max(r.first_seen_at)                              as closed_at,
  (array_agg(r.external_review_id order by r.first_seen_at, r.id))[1]
                                                    as opening_anchor_review_id,
  (array_agg(r.reviewer_name     order by r.first_seen_at, r.id))[1]
                                                    as opening_anchor_reviewer,
  (array_agg(r.external_review_id order by r.first_seen_at desc, r.id desc))[1]
                                                    as ending_anchor_review_id,
  (array_agg(r.reviewer_name     order by r.first_seen_at desc, r.id desc))[1]
                                                    as ending_anchor_reviewer
from public.google_reviews r
join public.google_review_locations l on l.id = r.location_id
left join public.salon_directory d on d.salon_id = l.salon_id
where r.eligible_for_weekly_count
group by r.reporting_week_start, r.location_id, r.store_code, d.store_name, d.district_label;

comment on view public.google_review_week_anchors is
  'Per week and listing: how many reviews counted, and which review opened and closed the counted run. The auditable replacement for "find the last reviewer we counted and count above them" — keyed on Google review ids, with the reviewer names kept as the human-readable label.';

-- ---------------------------------------------------------- the ingest -----
--
-- ONE FUNCTION, ONE TRANSACTION, IDEMPOTENT.
--
-- Everything that decides whether a record is admitted happens here, in the
-- database, under the same constraints every other writer obeys — so the
-- allowlist is enforced a third time (after the extension and after the API
-- route) by the only layer a caller cannot skip.
--
-- WHAT AN UPDATE MAY CHANGE, AND WHAT IT MAY NOT. A re-sync moves last_seen_at,
-- may add an owner response that has since been written, may correct the text,
-- the rating or the relative date if Google now shows something different — and
-- may NOT touch first_seen_at or the reporting week. The freeze trigger above
-- enforces that independently of this function.

create or replace function public.ingest_google_reviews(
  p_reviews        jsonb,
  p_parser_version text,
  p_credential_id  text default null,
  p_seen_at        timestamptz default now()
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item      jsonb;
  v_location  record;
  v_existing  record;
  v_external  text;
  v_store     text;
  v_rating    int;
  v_name      text;
  v_text      text;
  v_relative  text;
  v_absolute  timestamptz;
  v_has_reply boolean;
  v_reply     text;
  v_reply_at  text;
  v_status    public.google_review_response_status;
  v_changed   boolean;

  v_received  int := 0;
  v_created   int := 0;
  v_updated   int := 0;
  v_unchanged int := 0;
  v_ignored   int := 0;
  v_invalid   int := 0;
  v_problems  jsonb := '[]'::jsonb;
  v_run_id    uuid;
begin
  if jsonb_typeof(p_reviews) <> 'array' then
    raise exception 'ingest_google_reviews expects a JSON array of reviews.';
  end if;
  if p_parser_version is null or btrim(p_parser_version) = '' then
    raise exception 'ingest_google_reviews requires a parser version.';
  end if;

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

    /* ------------------------------------------------- shape refusals -- */

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

    /* -------------------------------------------- the allowlist, again -- */

    select l.id, l.store_code, l.is_active
      into v_location
      from public.google_review_locations l
     where l.store_code = v_store;

    if not found then
      /*
       * NOT AN ERROR. Buff City Soap and every other business on the same
       * Google account reach this branch, and the right answer is to ignore
       * them and say how many were ignored — not to fail the sync the manager
       * just clicked.
       */
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

    /* ------------------------------------------------- the normalised -- */

    v_text := nullif(btrim(coalesce(v_item ->> 'reviewText', '')), '');
    v_relative := nullif(btrim(coalesce(v_item ->> 'relativeDateText', '')), '');
    v_reply := nullif(btrim(coalesce(v_item ->> 'ownerResponseText', '')), '');
    v_reply_at := nullif(btrim(coalesce(v_item ->> 'ownerResponseDateText', '')), '');

    begin
      v_absolute := nullif(btrim(coalesce(v_item ->> 'googleAbsoluteDate', '')), '')::timestamptz;
    exception when others then
      v_absolute := null;
    end;

    /*
     * "HAS AN OWNER RESPONSE" IS THE CALLER'S OBSERVATION, and response text
     * without the flag is treated as a response rather than discarded: the
     * parser can read the words and miss the marker, and the words are the
     * stronger evidence.
     */
    v_has_reply := coalesce((v_item ->> 'hasOwnerResponse')::boolean, false)
                   or v_reply is not null;
    if not v_has_reply then
      v_reply := null;
      v_reply_at := null;
    end if;
    v_status := case when v_has_reply then 'responded' else 'needs_response' end;

    /* ------------------------------------------------------ the upsert -- */

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
           r.location_id
      into v_existing
      from public.google_reviews r
     where r.source = 'google_business_profile'
       and r.external_review_id = v_external;

    if not found then
      insert into public.google_reviews (
        source, external_review_id, location_id, store_code,
        reviewer_name, rating, review_text,
        google_relative_date_text, google_absolute_date,
        first_seen_at, last_seen_at,
        has_owner_response, owner_response_text, owner_response_date_text,
        response_status, reporting_week_start, parser_version, ingest_credential_id
      ) values (
        'google_business_profile', v_external, v_location.id, v_location.store_code,
        left(v_name, 200), v_rating, left(v_text, 8000),
        left(v_relative, 120), v_absolute,
        p_seen_at, p_seen_at,
        v_has_reply, left(v_reply, 8000), left(v_reply_at, 120),
        v_status, public.google_review_week_start(p_seen_at), p_parser_version, p_credential_id
      )
      /*
       * BELT AND BRACES AGAINST A CONCURRENT SYNC. Two clicks a second apart
       * can race between the select above and this insert; the unique
       * constraint would then abort the whole transaction and lose the other
       * forty reviews. `do nothing` turns that race into "somebody else created
       * it", which is counted as an update below rather than as a failure.
       */
      on conflict (source, external_review_id) do nothing;

      if found then
        v_created := v_created + 1;
      else
        update public.google_reviews r
           set last_seen_at = p_seen_at
         where r.source = 'google_business_profile'
           and r.external_review_id = v_external;
        v_updated := v_updated + 1;
      end if;

      continue;
    end if;

    /*
     * WHAT COUNTS AS A CHANGE. `last_seen_at` moves on every sync and is
     * deliberately not part of this test — otherwise every review would report
     * as "updated" forever and "3 new, 5 already synced" would be meaningless.
     */
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
           /* A later sync may ADD an absolute date; it may not erase one. */
           google_absolute_date      = coalesce(v_absolute, r.google_absolute_date),
           location_id               = v_location.id,
           store_code                = v_location.store_code,
           parser_version            = p_parser_version
     where r.id = v_existing.id;

    if v_changed then
      v_updated := v_updated + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  insert into public.google_review_sync_runs (
    ingest_credential_id, parser_version, received,
    created_count, updated_count, unchanged_count, ignored_non_stc, invalid_count, problems
  ) values (
    p_credential_id, p_parser_version, v_received,
    v_created, v_updated, v_unchanged, v_ignored, v_invalid, v_problems
  )
  returning id into v_run_id;

  return jsonb_build_object(
    'runId',         v_run_id,
    'received',      v_received,
    'created',       v_created,
    'updated',       v_updated,
    'duplicates',    v_unchanged,
    'ignoredNonStc', v_ignored,
    'invalid',       v_invalid,
    'problems',      v_problems
  );
end;
$$;

revoke all on function public.ingest_google_reviews(jsonb, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.google_review_week_start(timestamptz, text)
  from public, anon, authenticated;

comment on function public.ingest_google_reviews(jsonb, text, text, timestamptz) is
  'Idempotent batch upsert of Google reviews, keyed on (source, external_review_id). Re-enforces the store-code allowlist in the database, refuses a rating outside 1-5, and returns counts. An unknown store is ignored rather than failed: Buff City Soap shares the Google account.';

-- ----------------------------------------------------------- the seed ------
--
-- THE FIFTEEN SUN TAN CITY LISTINGS, joined to the roster on the SALON NUMBER
-- and never on the store code — see the header for what the alternative does.
--
-- IDEMPOTENT: `on conflict do update` so re-running converges, and a salon that
-- is missing from `salons` is skipped rather than aborting the migration.

insert into public.google_review_locations
  (store_code, salon_id, google_location_label, listing_state)
select
  seed.store_code,
  s.id,
  seed.label,
  seed.state_text::public.google_listing_state
from (values
  ('314', '0468', 'Sun Tan City - KS Lawrence',             'verification_required'),
  ('306', '0462', 'Sun Tan City - KS Manhattan',            'verified'),
  ('373', '0476', 'Sun Tan City - KS Overland Park',        'verified'),
  ('307', '0463', 'Sun Tan City - KS Shawnee Mission Pkwy', 'verified'),
  ('231', '0394', 'Sun Tan City - MO Kansas City Liberty',  'verified'),
  ('140', '0306', 'Sun Tan City - MO Kansas City Wornall',  'verification_required'),
  ('409', '0495', 'Sun Tan City - MO St Joseph',            'verified'),
  ('141', '0307', 'Sun Tan City - NE Grand Island',         'verified'),
  ('143', '0309', 'Sun Tan City - NE Kearney',              'verified'),
  ('144', '0310', 'Sun Tan City - NE Lincoln 27th Street',  'verified'),
  ('145', '0311', 'Sun Tan City - NE Lincoln O Street',     'verified'),
  ('146', '0312', 'Sun Tan City - NE Lincoln Pine Lake',    'verified'),
  ('147', '0313', 'Sun Tan City - NE Omaha 132nd and Maple','verified'),
  ('148', '0314', 'Sun Tan City - NE Omaha 144th and Center','verified'),
  ('254', '0410', 'Sun Tan City - NE Omaha Pacific',        'verified')
) as seed(store_code, salon_number, label, state_text)
join public.salons s on s.salon_number = seed.salon_number
on conflict (store_code) do update
  set salon_id              = excluded.salon_id,
      google_location_label = excluded.google_location_label,
      listing_state         = excluded.listing_state;

-- ---------------------------------------------------------- the security ---
--
-- THE SAME POSTURE AS EVERY OTHER TABLE HERE, and for the reason
-- `20260916001000_reporting_tables_server_only.sql` recorded at length: the
-- publishable key ships in every browser bundle, so anything `authenticated`
-- may select is readable from PostgREST directly, with no application scope
-- check in the way.
--
-- Nothing in the browser reads these relations. Every read goes through
-- `getSupabaseAdmin()` inside a module carrying `import "server-only"`, and
-- every write goes through the ingestion route's machine credential. So the
-- browser roles are revoked and NO POLICY IS DEFINED — RLS enabled with no
-- policy denies every role that does not bypass it, which is exactly the
-- intent. `service_role` holds BYPASSRLS, so server reads are unaffected.

alter table public.google_review_locations enable row level security;
alter table public.google_review_locations force  row level security;
alter table public.google_reviews          enable row level security;
alter table public.google_reviews          force  row level security;
alter table public.google_review_sync_runs enable row level security;
alter table public.google_review_sync_runs force  row level security;

revoke all on public.google_review_locations   from anon, authenticated;
revoke all on public.google_reviews            from anon, authenticated;
revoke all on public.google_review_sync_runs   from anon, authenticated;
revoke all on public.google_reviews_enriched   from anon, authenticated;
revoke all on public.google_review_week_anchors from anon, authenticated;
