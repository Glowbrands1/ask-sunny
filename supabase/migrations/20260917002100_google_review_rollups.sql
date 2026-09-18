-- ---------------------------------------------------------------------------
-- GOOGLE REVIEWS — the two rollups the dashboard reads.
--
-- WHY THESE EXIST RATHER THAN THE SCREEN SUMMING ROWS. The Google Reviews page
-- draws eleven figures — a weekly total, a twelve-week trend, a rating split, a
-- month-to-date count, a salon leaderboard, district totals — and every one of
-- them is a count over the same table. Fetching every review to add them up in
-- TypeScript would move a growing payload across the wire on every render to
-- produce forty numbers, and the numbers would then be computed in a different
-- place from the ones the drill-down shows.
--
-- So the AGGREGATES are grouped in Postgres and arrive as tens of rows, and the
-- DRILL-DOWN reads the individual reviews through `google_reviews_enriched`
-- with the same filters. Both read `google_reviews`, so a total and the list
-- behind it cannot disagree.
--
-- GRAIN: one row per listing per reporting week. Every review has a week — the
-- column is `not null` and frozen at insert — so summing every week for a
-- listing gives its all-time totals exactly, and no separate lifetime view is
-- needed.
--
-- ADDITIVE: two views. No table is altered and nothing is dropped.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------ the fifteen, always all ---
--
-- ONE ROW PER LISTING WHETHER OR NOT IT HAS REVIEWS, which is the point. A
-- leaderboard built by grouping the review table shows fourteen salons in a
-- week where one had none, and the missing salon is exactly the one somebody
-- needs to see. The district and store name come from `salon_directory`, the
-- same view the analytics screens resolve a district through.

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
  l.is_active
from public.google_review_locations l
left join public.salon_directory d on d.salon_id = l.salon_id;

comment on view public.google_review_location_directory is
  'The fifteen Sun Tan City Google listings with the salon name and district they resolve to, whether or not any review has been ingested for them. The leaderboard''s row set, so a salon with a quiet week is visible rather than absent.';

-- ----------------------------------------------- listing x week rollup -----

create or replace view public.google_review_location_weeks
with (security_invoker = true) as
select
  r.location_id,
  r.store_code,
  r.reporting_week_start,
  (r.reporting_week_start + 6)                                  as reporting_week_end,

  count(*)                                                      as all_reviews,

  /*
   * THE OFFICIAL WEEKLY NUMBER AND ITS COMPLEMENT, SIDE BY SIDE.
   *
   * `eligible_for_weekly_count` is generated in the table from the rating, so
   * these two cannot drift from the directive: 3, 4 and 5 count; 1 and 2 are
   * stored, shown, worked in the response queue, and never raise the total.
   * Both are published here so a screen never has to derive one from the other
   * and get the subtraction wrong.
   */
  count(*) filter (where r.eligible_for_weekly_count)           as qualifying_reviews,
  count(*) filter (where not r.eligible_for_weekly_count)       as critical_reviews,

  /*
   * STILL UNANSWERED *NOW*, grouped by the week the review arrived in. A
   * current-state fact against a historical bucket, deliberately: "three of
   * last week's reviews still have no reply" is the sentence a DM acts on.
   */
  count(*) filter (where r.response_status = 'needs_response')  as unanswered,
  count(*) filter (
    where r.response_status = 'needs_response' and r.rating <= 2
  )                                                             as critical_unanswered,

  count(*) filter (where r.rating = 1)                          as rating_1,
  count(*) filter (where r.rating = 2)                          as rating_2,
  count(*) filter (where r.rating = 3)                          as rating_3,
  count(*) filter (where r.rating = 4)                          as rating_4,
  count(*) filter (where r.rating = 5)                          as rating_5,

  /*
   * THE SUM, NOT THE AVERAGE. An average of averages is wrong the moment two
   * groups have different sizes, and every district and chain figure on this
   * page is exactly that kind of re-aggregation. The caller divides once, at
   * the level it is actually reporting.
   */
  sum(r.rating)::bigint                                         as rating_sum,

  min(r.first_seen_at)                                          as first_seen_at,
  max(r.first_seen_at)                                          as last_seen_at
from public.google_reviews r
group by r.location_id, r.store_code, r.reporting_week_start;

comment on view public.google_review_location_weeks is
  'Counts per Google listing per reporting week: all, qualifying (3-5 stars), critical (1-2), still-unanswered, the per-star split and the rating SUM. Sums rather than averages, so district and chain figures re-aggregate correctly instead of averaging averages.';

revoke all on public.google_review_location_directory from anon, authenticated;
revoke all on public.google_review_location_weeks     from anon, authenticated;
