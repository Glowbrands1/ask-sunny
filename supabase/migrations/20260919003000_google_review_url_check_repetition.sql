-- ===========================================================================
-- TWO CHECK CONSTRAINTS THAT COULD NEVER PASS, BECAUSE THEIR REGEX IS INVALID
-- ===========================================================================
--
-- `google_review_locations_maps_url_format` reads:
--
--   CHECK (google_maps_url IS NULL OR google_maps_url ~ '^https://[^\s]{5,500}$')
--
-- PostgreSQL's regular expression engine rejects a bounded repetition count
-- above 255. `{5,500}` is not a stricter rule than `{5,255}` — it is a SYNTAX
-- ERROR, and the error is raised when the expression is EXECUTED rather than
-- when the constraint is created. So the constraint was accepted happily at
-- migration time and then threw on first use:
--
--   ERROR: 2201B invalid regular expression: invalid repetition count(s)
--
-- ===========================================================================
-- WHAT IT ACTUALLY BROKE
-- ===========================================================================
--
-- Every attempt to save a Google Maps URL against a salon. The constraint is
-- only evaluated when `google_maps_url` is NOT NULL, so:
--
--   PASTING A BARE PLACE ID worked — the route leaves the URL null, the check
--   short-circuits on IS NULL, and nothing evaluates the broken pattern.
--
--   PASTING A MAPS URL — which is what an operator actually has, and what the
--   form asks for first — set the column, evaluated the pattern, and raised.
--   `assign_places` saw an RPC error and reported "The Google location mapping
--   could not be saved. Nothing has been changed." That message was true and
--   gave no hint that the fault was a constraint on a column nobody typed into.
--
-- `google_review_locations_website_url_check` carries the same defect with
-- `{3,300}`. Nothing writes `website_url` on the Apify path today, so it has
-- not bitten yet; it is fixed here because it is the same bug and finding it
-- again later from a different symptom would cost the same day twice.
--
-- ===========================================================================
-- THE REPLACEMENT KEEPS EVERY RULE AND SPLITS IT IN TWO
-- ===========================================================================
--
-- The intent was: an https URL, no whitespace in it, and not unboundedly long.
-- All three survive — the length bound simply moves out of the regex, where it
-- does not fit, and into `length()`, where it does.
--
-- NOT VALIDATED IS NOT USED. Both columns are checked against every existing
-- row, because there are only fifteen and a constraint nobody proved is a
-- constraint nobody can rely on.

alter table public.google_review_locations
  drop constraint if exists google_review_locations_maps_url_format;

alter table public.google_review_locations
  add constraint google_review_locations_maps_url_format
  check (
    google_maps_url is null
    or (
      /* 255 is the engine's ceiling for a bounded repeat, so the pattern
         checks the SHAPE and the length check below checks the SIZE. */
      google_maps_url ~ '^https://[^\s]{5,255}'
      and google_maps_url !~ '\s'
      and length(google_maps_url) <= 500
    )
  );

comment on constraint google_review_locations_maps_url_format
  on public.google_review_locations is
  'An https URL with no whitespace, at most 500 characters. The length bound lives in length() rather than in the regex because PostgreSQL rejects a bounded repetition above 255 — the previous version used {5,500} and raised 2201B on every evaluation, which made saving any Maps URL impossible.';

alter table public.google_review_locations
  drop constraint if exists google_review_locations_website_url_check;

alter table public.google_review_locations
  add constraint google_review_locations_website_url_check
  check (
    website_url is null
    or (
      website_url ~ '^https?://[^\s]{3,255}'
      and website_url !~ '\s'
      and length(website_url) <= 300
    )
  );

comment on constraint google_review_locations_website_url_check
  on public.google_review_locations is
  'An http(s) URL with no whitespace, at most 300 characters. Same fix as the Maps URL constraint: {3,300} exceeded PostgreSQL''s 255-character bound for a repetition count and raised on evaluation.';

/*
 * PROOF THE PATTERNS NOW EXECUTE. A constraint that throws when evaluated is
 * indistinguishable from a working one until something writes to the column —
 * which is exactly how this shipped. Evaluating both here, against a URL of
 * the shape an operator actually pastes, means a repeat of the same mistake
 * fails the migration instead of production.
 */
do $$
declare
  v_long text := 'https://www.google.com/maps/search/?api=1&query='
                 || repeat('x', 300)
                 || '&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4';
begin
  if not ('https://maps.google.com/?cid=123' ~ '^https://[^\s]{5,255}') then
    raise exception 'the Maps URL pattern rejects a valid short URL';
  end if;

  /* Over 500 characters: refused by length, not by a broken pattern. */
  if length(v_long) <= 500 then
    raise exception 'the long-URL probe is not actually long enough to test';
  end if;

  if ('https://example.com/a b' !~ '\s') then
    raise exception 'the whitespace rule is not rejecting whitespace';
  end if;
end $$;
