-- ===========================================================================
-- THE ADDRESS ASK SUNNY EXPECTS TO FIND, SO NOBODY HAS TO HUNT FOR A PLACE ID
-- ===========================================================================
--
-- Discovery already searches Google for each salon, but it searched on what the
-- roster happened to carry: a brand, a city, a state, and for six salons a
-- street token scraped out of the salon's own name. That is enough to separate
-- three salons in Lincoln and not much more, and when it is not enough the
-- honest answer is `ambiguous` — which lands an operator in the fallback form
-- being asked for a Google Place ID, a value nobody has and nobody should have
-- to find fifteen times.
--
-- A person knows the address. This is where they put it.
--
-- ===========================================================================
-- IT REUSES THE COLUMNS THAT ALREADY EXIST
-- ===========================================================================
--
-- `expected_city` and `expected_state` have been on this table since the source
-- migration and are already seeded for all fifteen. A second address record
-- somewhere else would immediately raise the question of which one discovery
-- reads, and the answer would drift. So this adds only what is missing —
-- street, postal code, country — beside the two that are already here.
--
-- There is no address anywhere else in ASK Sunny to reuse instead: `salons` and
-- `salon_directory` carry a salon number, a store name, a district and a
-- region, and nothing geographic below the city.
--
-- ===========================================================================
-- WHAT THIS MIGRATION DOES NOT TOUCH
-- ===========================================================================
--
-- No review, no reporting period, no anchor, no ingestion function, no
-- deduplication key, and — the one that matters most here — NO ACCEPTED
-- MAPPING. `google_place_id`, `apify_source_status`, `canonical_google_name`
-- and `canonical_google_address` are the record of a listing somebody has
-- signed off. Writing an expected address is stating what we are looking for;
-- it is not a claim about what was found, and the setter below cannot reach
-- those columns at all.

-- ------------------------------------------------- the expected address ----

alter table public.google_review_locations
  /*
   * THE STREET AS A PERSON WOULD WRITE IT, including the suite where there is
   * one. The matcher normalises before comparing and ignores the suite — Google
   * frequently omits it — so "2624 Iowa St Ste B" and "2624 Iowa Street" are
   * the same street to the check, and neither has to be typed a particular way.
   */
  add column if not exists expected_street_address text,

  /*
   * THE ZIP, WHICH IS THE STRONGEST CHEAP DISCRIMINATOR THERE IS. Two Sun Tan
   * City salons in one city share a brand, a city and a state; they do not
   * share a postcode. It is optional because a person may not have it to hand,
   * and a check that demanded it would block the common case to strengthen the
   * rare one.
   */
  add column if not exists expected_postal_code text,

  /* Recorded for completeness and for the day this is not a US-only roster. */
  add column if not exists expected_country text;

comment on column public.google_review_locations.expected_street_address is
  'The street address ASK Sunny expects Google to report for this salon, as a person would write it. Compared house-number-and-street-name first, with the suite ignored, because Google routinely omits it. Null means the city, state and street hint are all the discovery has to go on.';

comment on column public.google_review_locations.expected_postal_code is
  'The postcode ASK Sunny expects. Optional — but where BOTH sides carry one and they disagree, the candidate is refused outright, because two addresses in one city with different postcodes are two different places.';

comment on column public.google_review_locations.expected_country is
  'The country this salon trades in. Recorded for completeness; the discovery Actor is already scoped to the US, so nothing matches on it today.';

/*
 * EVERY EXISTING ROW IS IN THE UNITED STATES, and typing that fifteen times is
 * a chore that teaches nobody anything. Seeded only where it is null, so a
 * future correction by hand is never overwritten by a re-run.
 */
update public.google_review_locations
   set expected_country = 'United States'
 where expected_country is null;

-- --------------------------------------------- saving an expected address ---
--
-- ===========================================================================
-- THE ONE THING THIS FUNCTION CANNOT DO IS CHANGE A MAPPING
-- ===========================================================================
--
-- Its update list is five address columns and nothing else. It cannot write
-- `google_place_id`, cannot move `apify_source_status`, and cannot touch the
-- canonical name or address Google returned — so no amount of address editing,
-- by anybody, can quietly re-point a salon at a different Google listing or
-- promote one nobody checked.
--
-- A verified salon may still have its expected address corrected. That is
-- deliberate and safe: the expectation is what a FUTURE search is checked
-- against, and correcting a typo on a salon that is already mapped changes
-- nothing about the mapping it already has.
--
-- EMPTY MEANS CLEAR, AND NULL MEANS LEAVE ALONE. An operator blanking a field
-- means "there is no such thing here"; a caller omitting it means "I am not
-- talking about that field". Collapsing the two would make it impossible to
-- remove a wrong street address once one had been saved.

create or replace function public.google_review_apify_set_expected_address(
  p_store_code     text,
  p_street_address text default null,
  p_city           text default null,
  p_state          text default null,
  p_postal_code    text default null,
  p_country        text default null,
  p_actor          text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
begin
  select l.id, l.store_code, l.is_active
    into v_row
    from public.google_review_locations l
   where l.store_code = btrim(p_store_code)
   limit 1;

  if not found then
    return jsonb_build_object(
      'storeCode', p_store_code,
      'status', 'unknown_store_code'
    );
  end if;

  update public.google_review_locations l
     set expected_street_address =
           case
             when p_street_address is null then l.expected_street_address
             else nullif(btrim(p_street_address), '')
           end,
         expected_city =
           case
             when p_city is null then l.expected_city
             else nullif(btrim(p_city), '')
           end,
         expected_state =
           case
             when p_state is null then l.expected_state
             /*
              * UPPER-CASED because every check downstream compares a two-letter
              * code, and "ks" typed in a form is the same state as "KS".
              */
             else nullif(upper(btrim(p_state)), '')
           end,
         expected_postal_code =
           case
             when p_postal_code is null then l.expected_postal_code
             else nullif(btrim(p_postal_code), '')
           end,
         expected_country =
           case
             when p_country is null then l.expected_country
             else nullif(btrim(p_country), '')
           end,
         apify_verification_note =
           case
             /*
              * THE NOTE RECORDS THE EDIT WITHOUT OVERWRITING A VERIFICATION.
              * On a verified listing the existing note is Google's own answer
              * being confirmed, which is worth more than "somebody typed an
              * address", so it is left exactly as it is.
              */
             when l.apify_source_status = 'verified' then l.apify_verification_note
             else 'Expected address set by ' || coalesce(nullif(btrim(p_actor), ''), 'an administrator')
                  || '. Nothing has been mapped — run a search.'
           end
   where l.id = v_row.id;

  return jsonb_build_object(
    'storeCode', v_row.store_code,
    'status', 'ok'
  );
end;
$$;

comment on function public.google_review_apify_set_expected_address(
  text, text, text, text, text, text, text
) is
  'Records the address ASK Sunny expects Google to report for one salon. Touches five address columns and a note and nothing else: it cannot write google_place_id, move apify_source_status, or change the canonical name and address, so editing an expectation can never re-point or promote a mapping. A null argument leaves that field alone; an empty string clears it.';

revoke all on function public.google_review_apify_set_expected_address(
  text, text, text, text, text, text, text
) from anon, authenticated;

-- --------------------------------------------------- the rebuilt view -------
--
-- DROPPED AND RECREATED RATHER THAN REPLACED. `create or replace view` can only
-- APPEND columns to the end of the select list; inserting `expected_street_address`
-- beside the city and state it belongs with renames a position and Postgres
-- refuses with 42P16. The previous migration in this series learned that the
-- expensive way.
--
-- NO `cascade`. If something has come to depend on this view since, this
-- migration must fail loudly rather than silently drop it.

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

  /* What we expect to find — the whole address, in one place. */
  l.expected_street_address,
  l.expected_city,
  l.expected_state,
  l.expected_postal_code,
  l.expected_country,
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
  'All fifteen listings: the address ASK Sunny expects, the accepted Google mapping, the candidate a search proposed, and per-transport review counts. Expectation, proposal and acceptance are three separate groups of columns because each is a different kind of claim.';

revoke all on public.google_review_apify_locations from anon, authenticated;
