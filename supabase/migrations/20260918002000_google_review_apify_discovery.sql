-- ============================================================================
-- GOOGLE REVIEWS — DISCOVERING THE FIFTEEN GOOGLE LISTINGS
-- ============================================================================
--
-- The Apify source needs a stable Google Place ID per listing. Phase 2 got
-- those by having somebody paste fifteen of them. This adds the step that
-- finds them: one setup run searches Google Maps from the roster this system
-- already holds, and proposes a candidate per salon.
--
-- ============================================================================
-- DISCOVERY AND RUNNABILITY ARE TWO DIFFERENT FACTS
-- ============================================================================
--
-- This migration adds a SECOND status rather than widening the first, and that
-- separation is the whole safety design:
--
--   `apify_source_status`    MAY THIS LISTING BE SCRAPED. Only `verified`
--                            may, and that still requires the evidence
--                            constraint the previous migration added.
--
--   `discovery_status`       WHAT A SEARCH FOUND. `candidate_found`,
--                            `ambiguous`, `not_found`, `profile_issue`.
--
-- A discovery run writes ONLY the second, into columns of its own. It cannot
-- make a listing runnable, cannot overwrite a verified mapping, and cannot
-- promote itself — a person presses a button, and that button refuses anything
-- that is not an unambiguous match. So the worst a bad search can do is put a
-- wrong candidate on screen for somebody to reject.
--
-- ============================================================================
-- WHAT THIS MIGRATION DOES NOT TOUCH
-- ============================================================================
--
-- No review is read, written, moved or deleted. No existing constraint is
-- changed. No column is dropped or rewritten. `google_review_locations` keeps
-- every value it holds, including the fifteen seeded expectations, and
-- `google_reviews` is not mentioned outside one read-only view.

-- ------------------------------------------------ what a search concluded ---

do $$
begin
  if not exists (select 1 from pg_type where typname = 'google_review_discovery_status') then
    create type public.google_review_discovery_status as enum (
      /* No search has been run for this listing. */
      'not_searched',
      /* A discovery run is live and this listing is in it. */
      'searching',
      /* Exactly one candidate matched, and nothing else matched it. */
      'candidate_found',
      /* Two or more candidates matched equally well. NEVER auto-attached. */
      'ambiguous',
      /* Google returned nothing that matched the roster. */
      'not_found',
      /* A candidate was found and Google flags the listing — closed, or
         needing verification. Not mapped until a person looks. */
      'profile_issue'
    );
  end if;
end
$$;

comment on type public.google_review_discovery_status is
  'What a Google Maps search concluded for a listing. Deliberately separate from apify_source_status, which decides whether a listing may be scraped: discovery proposes, a person disposes, and no discovery outcome can make a listing runnable on its own.';

-- ------------------------------------------- the candidate, kept apart -----
--
-- SEPARATE COLUMNS FROM THE VERIFIED MAPPING, on purpose.
--
-- `google_place_id` / `canonical_google_name` / `canonical_google_address` are
-- what this system ACCEPTED and files reviews against. The `discovered_*`
-- columns are what a search PROPOSED. Writing a proposal straight into the
-- accepted fields would mean a search could silently re-point a salon that was
-- already verified — the one thing this whole area exists to prevent — and
-- would also lose the audit trail of what was suggested versus what was taken.

alter table public.google_review_locations
  add column if not exists discovery_status
    public.google_review_discovery_status not null default 'not_searched',
  add column if not exists discovered_place_id text,
  add column if not exists discovered_name text,
  add column if not exists discovered_address text,
  add column if not exists discovered_maps_url text,
  add column if not exists discovered_cid text,
  /* How many candidates matched this listing's rules. 2+ is the ambiguity. */
  add column if not exists discovery_candidate_count integer not null default 0,
  add column if not exists discovered_at timestamptz,
  /* Why, in the words the review table prints. Operator-facing, never a value. */
  add column if not exists discovery_note text,
  /* The exact search string sent to Google, so a bad result can be read. */
  add column if not exists discovery_query text;

alter table public.google_review_locations
  drop constraint if exists google_review_locations_discovered_place_format;
alter table public.google_review_locations
  add constraint google_review_locations_discovered_place_format
  check (discovered_place_id is null or discovered_place_id ~ '^[A-Za-z0-9_-]{10,255}$');

alter table public.google_review_locations
  drop constraint if exists google_review_locations_discovery_count_sane;
alter table public.google_review_locations
  add constraint google_review_locations_discovery_count_sane
  check (discovery_candidate_count >= 0 and discovery_candidate_count <= 1000);

/*
 * A CANDIDATE STATUS NEEDS A CANDIDATE. `candidate_found` without an id is a
 * row that would offer a person a button that could do nothing.
 */
alter table public.google_review_locations
  drop constraint if exists google_review_locations_candidate_has_place;
alter table public.google_review_locations
  add constraint google_review_locations_candidate_has_place
  check (discovery_status <> 'candidate_found' or discovered_place_id is not null);

comment on column public.google_review_locations.discovered_place_id is
  'What a search PROPOSED for this listing. Never what reviews are filed against — that is google_place_id, which only the promotion step writes and only from an unambiguous match.';
comment on column public.google_review_locations.discovery_status is
  'The search outcome. ambiguous and not_found are real answers and are shown as such: a listing nobody could resolve automatically is a row asking for a person, not a row quietly left out.';

-- ---------------------------------------------- the street hint per salon ---
--
-- THE ROSTER NAMES CARRY THE ONLY STREET INFORMATION THIS SYSTEM HAS.
--
-- There is no address column anywhere in ASK Sunny — the roster is names and
-- states — so "NE Lincoln 27th Street" is, literally, everything known about
-- where that salon is beyond its city. That matters because THREE salons are in
-- Lincoln and THREE are in Omaha: a search for "Sun Tan City Lincoln NE"
-- returns all three, and every one of them is a genuine Sun Tan City. Without
-- the street hint the honest answer for all three is `ambiguous`.
--
-- So the hint is seeded explicitly, here, as data — not parsed out of the label
-- at run time. A rule that split "NE Omaha 132nd and Maple" into tokens would
-- work until somebody renamed a salon, and would fail silently when it did.
--
-- A NULL HINT IS NOT A WILDCARD. It means the city alone identifies the salon,
-- which is true for the nine listings that are the only Sun Tan City in their
-- city. Where a hint IS set, a candidate must match it or it does not match.

alter table public.google_review_locations
  add column if not exists expected_street_hint text[];

update public.google_review_locations l
   set expected_street_hint = v.hint
  from (values
    ('140', array['wornall']),
    ('141', null::text[]),
    ('143', null::text[]),
    ('144', array['27th']),
    ('145', array['o st', 'o street']),
    ('146', array['pine lake']),
    ('147', array['132nd', 'maple']),
    ('148', array['144th', 'center']),
    ('231', null::text[]),
    ('254', array['pacific']),
    ('306', null::text[]),
    ('307', array['shawnee mission']),
    ('314', null::text[]),
    ('373', null::text[]),
    ('409', null::text[])
  ) as v(store_code, hint)
 where l.store_code = v.store_code
   and l.expected_street_hint is null;

comment on column public.google_review_locations.expected_street_hint is
  'Street or landmark tokens that distinguish this salon from another in the same city — the only street information ASK Sunny holds, taken from the roster name. Null means the city alone identifies the salon. Where set, a candidate must match at least one token or it is not a match.';

-- ----------------------------------------------- the discovery run kind ----
--
-- Safe inside a transaction: the value is added here and used by nothing in
-- this migration, which is the condition Postgres imposes.

alter type public.google_review_apify_run_kind add value if not exists 'location_discovery';

-- --------------------------------------------- recording what was found ----

create or replace function public.google_review_apify_record_discovery(
  p_store_code  text,
  p_status      public.google_review_discovery_status,
  p_place_id    text default null,
  p_name        text default null,
  p_address     text default null,
  p_maps_url    text default null,
  p_cid         text default null,
  p_candidates  integer default 0,
  p_note        text default null,
  p_query       text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_location record;
begin
  select l.id, l.store_code, l.apify_source_status
    into v_location
    from public.google_review_locations l
   where l.store_code = btrim(p_store_code);

  if not found then
    return jsonb_build_object('status', 'unknown_store', 'storeCode', p_store_code);
  end if;

  /*
   * A VERIFIED LISTING IS LEFT ALONE.
   *
   * Re-running discovery must not disturb a salon somebody already signed off,
   * and must not quietly propose a replacement for it. The search result is
   * discarded and the row is reported as already settled. Re-pointing a
   * verified listing is a deliberate act through the manual path, not a side
   * effect of pressing Discover twice.
   */
  if v_location.apify_source_status = 'verified' then
    return jsonb_build_object('status', 'already_verified', 'storeCode', v_location.store_code);
  end if;

  update public.google_review_locations l
     set discovery_status          = p_status,
         discovered_place_id       = nullif(btrim(coalesce(p_place_id, '')), ''),
         discovered_name           = nullif(btrim(coalesce(p_name, '')), ''),
         discovered_address        = nullif(btrim(coalesce(p_address, '')), ''),
         discovered_maps_url       = nullif(left(btrim(coalesce(p_maps_url, '')), 500), ''),
         discovered_cid            = nullif(btrim(coalesce(p_cid, '')), ''),
         discovery_candidate_count = greatest(least(coalesce(p_candidates, 0), 1000), 0),
         discovered_at             = now(),
         discovery_note            = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
         discovery_query           = nullif(left(btrim(coalesce(p_query, '')), 300), '')
   where l.id = v_location.id;

  return jsonb_build_object('status', 'ok', 'storeCode', v_location.store_code);
end;
$$;

revoke all on function public.google_review_apify_record_discovery(
  text, public.google_review_discovery_status, text, text, text, text, text, integer, text, text
) from public, anon, authenticated;

comment on function public.google_review_apify_record_discovery(
  text, public.google_review_discovery_status, text, text, text, text, text, integer, text, text
) is
  'Records what a search proposed for one listing. Writes ONLY the discovered_* columns and discovery_status — it cannot set google_place_id, cannot make a listing runnable, and refuses a listing that is already verified.';

-- ------------------------------------------- marking a run as in progress ---

create or replace function public.google_review_apify_mark_searching(
  p_store_codes text[]
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.google_review_locations l
     set discovery_status = 'searching',
         discovery_note = null
   where l.store_code = any(coalesce(p_store_codes, '{}'))
     /* A verified listing is never put back into a searching state. */
     and l.apify_source_status <> 'verified';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.google_review_apify_mark_searching(text[])
  from public, anon, authenticated;

-- ------------------------------------------------ promoting a safe match ---

create or replace function public.google_review_apify_promote_discovered(
  p_store_codes text[],
  p_actor       text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row      record;
  v_results  jsonb := '[]'::jsonb;
  v_clash    record;
begin
  /*
   * THE GATE, AND IT IS THE WHOLE POINT OF THIS FUNCTION.
   *
   * A row may be promoted only when a search concluded `candidate_found` — the
   * state that means exactly one candidate matched this salon's brand, city,
   * state and street hint, and matched no other salon. `ambiguous`,
   * `not_found`, `profile_issue`, `searching` and `not_searched` are all
   * refused here, not merely hidden from the button that calls this.
   *
   * A UI IS NOT A BOUNDARY. The screen only offers the safe rows; this refuses
   * everything else regardless of what was asked for.
   */
  for v_row in
    select l.id, l.store_code, l.discovery_status, l.discovered_place_id,
           l.discovered_name, l.discovered_address, l.discovered_maps_url,
           l.discovered_cid, l.apify_source_status
      from public.google_review_locations l
     where l.store_code = any(coalesce(p_store_codes, '{}'))
     order by l.store_code
  loop
    if v_row.apify_source_status = 'verified' then
      v_results := v_results || jsonb_build_object(
        'storeCode', v_row.store_code, 'status', 'already_verified');
      continue;
    end if;

    if v_row.discovery_status <> 'candidate_found' or v_row.discovered_place_id is null then
      v_results := v_results || jsonb_build_object(
        'storeCode', v_row.store_code, 'status', 'not_a_safe_match',
        'discoveryStatus', v_row.discovery_status);
      continue;
    end if;

    /*
     * EVIDENCE OR NOTHING. The table's own constraint refuses `verified`
     * without a name and an address; catching it here means the operator is
     * told which listing lacked evidence rather than shown a constraint name.
     */
    if v_row.discovered_name is null or v_row.discovered_address is null then
      v_results := v_results || jsonb_build_object(
        'storeCode', v_row.store_code, 'status', 'no_evidence');
      continue;
    end if;

    /* ONE GOOGLE LISTING, ONE SALON — checked before the unique index has to. */
    select l.store_code into v_clash
      from public.google_review_locations l
     where l.google_place_id = v_row.discovered_place_id
       and l.id <> v_row.id;

    if found then
      v_results := v_results || jsonb_build_object(
        'storeCode', v_row.store_code, 'status', 'place_already_mapped',
        'conflictsWith', v_clash.store_code);
      continue;
    end if;

    update public.google_review_locations l
       set google_place_id          = v_row.discovered_place_id,
           canonical_google_name    = v_row.discovered_name,
           canonical_google_address = v_row.discovered_address,
           google_maps_url          = v_row.discovered_maps_url,
           google_cid               = v_row.discovered_cid,
           apify_source_status      = 'verified',
           apify_last_verified_at   = now(),
           apify_verification_note  =
             'Discovered and matched on name, city, state'
             || case when l.expected_street_hint is null then '' else ' and street' end
             || coalesce(', accepted by ' || left(btrim(p_actor), 100), '')
     where l.id = v_row.id;

    v_results := v_results || jsonb_build_object(
      'storeCode', v_row.store_code, 'status', 'verified');
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;

revoke all on function public.google_review_apify_promote_discovered(text[], text)
  from public, anon, authenticated;

comment on function public.google_review_apify_promote_discovered(text[], text) is
  'Turns an unambiguous discovery into a verified mapping. Refuses anything that is not `candidate_found` with an id, a name and an address, and refuses a place id another salon already holds. Costs no Apify call: the evidence was captured when the candidate was found.';

-- ================================================================ views ====
--
-- The review table's row set, gaining the candidate columns.
--
-- ============================================================================
-- DROPPED AND REBUILT, NOT REPLACED, AND THAT IS NOT OPTIONAL
-- ============================================================================
--
-- `create or replace view` may only APPEND columns. It refuses to insert one
-- in the middle of an existing column list, with
--
--     42P16: cannot change name of view column "apify_source_status"
--            to "expected_street_hint"
--
-- and `expected_street_hint` belongs beside the other `expected_*` columns
-- rather than bolted onto the end where nobody would look for it. Dropping
-- first is safe here for one specific reason, checked before this was written:
-- NOTHING DEPENDS ON THIS VIEW. It is a read model for one admin screen, no
-- other view selects from it, and a view holds no data of its own — so the drop
-- costs exactly nothing and the rebuild is atomic with it inside the migration's
-- transaction.
--
-- If that ever stops being true — if a second view comes to read this one — the
-- drop will fail loudly rather than cascade, because there is no `cascade` here
-- and there must never be one.

drop view if exists public.google_review_apify_locations;

create view public.google_review_apify_locations
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
  l.expected_street_hint,
  l.apify_source_status,
  l.apify_last_verified_at,
  l.apify_verification_note,

  /* What a search proposed, kept apart from what was accepted. */
  l.discovery_status,
  l.discovered_place_id,
  l.discovered_name,
  l.discovered_address,
  l.discovered_maps_url,
  l.discovered_cid,
  l.discovery_candidate_count,
  l.discovered_at,
  l.discovery_note,
  l.discovery_query,

  l.counted_through_external_review_id is not null as counting_active,

  coalesce(stats.reviews_total, 0)      as reviews_total,
  coalesce(stats.reviews_from_apify, 0) as reviews_from_apify,
  coalesce(stats.reviews_from_brave, 0) as reviews_from_brave,
  stats.latest_published_at,
  stats.latest_seen_at
from public.google_review_locations l
left join public.salon_directory d on d.salon_id = l.salon_id
left join lateral (
  select
    count(*)                                                            as reviews_total,
    count(*) filter (where r.last_ingestion_source = 'apify')            as reviews_from_apify,
    count(*) filter (where r.last_ingestion_source = 'brave_extension')  as reviews_from_brave,
    max(coalesce(r.google_absolute_date, r.google_estimated_at))         as latest_published_at,
    max(r.last_seen_at)                                                  as latest_seen_at
  from public.google_reviews r
 where r.location_id = l.id
) stats on true;

comment on view public.google_review_apify_locations is
  'All fifteen listings: the accepted Google mapping, the candidate a search proposed, and per-transport review counts. The two mappings are separate columns because a proposal is not an acceptance.';

revoke all on public.google_review_apify_locations from anon, authenticated;
