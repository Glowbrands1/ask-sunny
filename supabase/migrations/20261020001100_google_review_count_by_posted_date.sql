-- ============================================================================
-- GOOGLE REVIEWS COUNT IN THE WEEK AND MONTH THEY WERE POSTED
-- ============================================================================
--
-- THE DEFECT. A review counted only when a sync PROVED it sat above its
-- listing's anchor — the last review already counted — in the same page of
-- the feed. That proof fails whenever the anchor is not on the page, and every
-- way that happened in October 2026 was silent and permanent:
--
--   * the anchored review left Google (MO Kansas City Wornall, 140: an
--     anonymous review from 30 September stopped appearing after 3 October);
--   * the run's date cutoff fell after the anchor (MO St Joseph, 409);
--   * more new reviews arrived between syncs than the run fetched per listing.
--
-- Each logged `anchor_not_in_feed` to `google_review_apify_runs.problems` and
-- stored every later review as historical. By 20 October five listings held
-- 28 reviews posted in October and counted toward nothing, and a salon director
-- compared Ask Sunny's "2 this month" with the 9 on her Google listing.
--
-- THE RULE FROM 1 OCTOBER 2026. Apify reports Google's real publication
-- instant for every review, so whether a review is new no longer has to be
-- inferred from where it sits on a page:
--
--   A review counts when its listing has a posted-date start and Google says it
--   was posted on or after it. It counts in the reporting week it was POSTED
--   (Sunday to Saturday, Central), and toward the month it was posted.
--
-- That is the number a manager can check for themselves on Google, it needs no
-- boundary that can go missing, and a review a sync missed counts in the right
-- week whenever it is first seen.
--
-- WHAT DOES NOT CHANGE.
--
--   * Nothing already counted moves. `reporting_period_id` stays write-once
--     (`google_reviews_freeze_period`), so every `anchor_assigned` review keeps
--     its week, and month to date keeps crediting it to the month it was first
--     seen — see `counted_at` below. No listing's figure can go down.
--   * September is untouched: the start is 1 October, and nothing posted before
--     it is assigned here.
--   * A review with no publication instant (the Brave extension's) still counts
--     only through the anchor, exactly as before. The anchor keeps advancing,
--     so that path keeps working.
--   * 1- and 2-star reviews are still assigned but never qualifying —
--     `eligible_for_weekly_count` is unchanged.

-- --------------------------------------------- the posted-date start ------

alter table public.google_review_locations
  add column if not exists count_by_posted_date_from timestamptz;

comment on column public.google_review_locations.count_by_posted_date_from is
  'Reviews Google says were posted at or after this instant count toward the week and month they were posted (Central). Null: the listing counts only through its anchor. Set once, when the listing first gets an anchor; 1 October 2026 Central for the listings counting when the rule arrived.';

/*
 * EVERY LISTING ALREADY COUNTING STARTS AT MIDNIGHT ON 1 OCTOBER, CENTRAL.
 * A listing with no anchor has never been baselined and stays null: its held
 * reviews are an import nobody has drawn a line under yet.
 */
update public.google_review_locations
   set count_by_posted_date_from = timestamp '2026-10-01 00:00:00' at time zone 'America/Chicago'
 where counted_through_external_review_id is not null
   and count_by_posted_date_from is null;

/*
 * A LISTING ANCHORED LATER STARTS WHEN ITS ANCHOR IS SET — the baseline
 * screen's "count from the next review onward", by publication time. A trigger
 * rather than an edit to the two anchor functions, so neither is re-declared
 * here and both keep exactly the behaviour they had.
 */
create or replace function public.google_review_locations_posted_date_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.count_by_posted_date_from is null
     and new.counted_through_external_review_id is not null
     and old.counted_through_external_review_id is null then
    new.count_by_posted_date_from := coalesce(new.counted_through_set_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.google_review_locations_posted_date_start()
  from public, anon, authenticated;

drop trigger if exists google_review_locations_posted_date_start on public.google_review_locations;
create trigger google_review_locations_posted_date_start
  before update of counted_through_external_review_id on public.google_review_locations
  for each row execute function public.google_review_locations_posted_date_start();

-- ------------------------------------------------- the ingestion function --
--
-- The function as `20260918001000_google_review_apify_source.sql` left it, with
-- one addition: before the anchor is consulted, a review whose listing has a
-- posted-date start and whose publication instant is on or after it is
-- assigned to the reporting week it was posted. The anchor path is unchanged
-- and still decides everything the posted-date rule does not.

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

  v_exists    boolean;
  v_posted    timestamptz;
  v_by_date   boolean;
  v_target    uuid;
  v_target_status public.google_review_assignment_status;

  v_period    uuid;
  v_run_id    uuid;

  v_store_ok       jsonb := '{}'::jsonb;
  v_store_advance  jsonb := '{}'::jsonb;
  v_store_counted  jsonb := '{}'::jsonb;
  v_store_top      jsonb := '{}'::jsonb;

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

    select l.id, l.store_code, l.is_active, l.google_place_id, l.count_by_posted_date_from
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
     * ago", so it wins wherever both exist.
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
    v_exists := found;

    /*
     * WHERE THIS REVIEW COUNTS, IF ANYWHERE. By the date Google says it was
     * posted wherever the listing counts that way and the instant is known —
     * the instant this batch carries, or the one already stored. Capped at
     * the sync instant, so a clock that runs ahead cannot file a review into a
     * week that has not happened. Otherwise the anchor decides, as before.
     */
    v_posted := coalesce(v_absolute, case when v_exists then v_existing.google_absolute_date end);
    v_by_date := v_location.count_by_posted_date_from is not null
                 and v_posted is not null
                 and v_posted >= v_location.count_by_posted_date_from;

    /*
     * THE NEWEST REVIEW THIS BATCH SAW, per listing that counts by posted date
     * — by Google's publication instant, so a page delivered out of order
     * cannot nominate an older review. See "the anchor, kept current" below.
     */
    if v_location.count_by_posted_date_from is not null
       and v_position is not null
       and v_posted is not null
       and coalesce((v_store_top -> v_store ->> 'posted')::timestamptz < v_posted, true) then
      v_store_top := v_store_top ||
        jsonb_build_object(v_store, jsonb_build_object('posted', v_posted, 'id', v_external));
    end if;

    if v_by_date then
      v_target := public.google_review_current_period(least(v_posted, p_seen_at));
      v_target_status := 'posted_date';
    elsif v_assign then
      v_target := v_period;
      v_target_status := 'anchor_assigned';
    else
      v_target := null;
      v_target_status := 'historical';
    end if;

    if not v_exists then
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
        v_target, v_target_status,
        v_position, v_run_id,
        p_ingestion_source, p_ingestion_source, v_place
      )
      on conflict (source, external_review_id) do nothing;

      if found then
        v_created := v_created + 1;
        if v_target is not null then
          v_counted := v_counted + 1;
          /* Only an anchor-proven count may move the anchor. */
          if v_assign then
            v_store_counted := v_store_counted || jsonb_build_object(v_store, true);
          end if;
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
           /* Write-once: a review already counting stays exactly where it is. */
           reporting_period_id =
             case when r.reporting_period_id is null and v_target is not null
                  then v_target else r.reporting_period_id end,
           reporting_assignment_status =
             case when r.reporting_period_id is null and v_target is not null
                  then v_target_status
                  else r.reporting_assignment_status end
     where r.id = v_existing.id;

    if v_existing.reporting_period_id is null and v_target is not null then
      v_counted := v_counted + 1;
      if v_assign then
        v_store_counted := v_store_counted || jsonb_build_object(v_store, true);
      end if;
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

  /*
   * THE ANCHOR, KEPT CURRENT. A listing that counts by posted date no longer
   * needs its anchor to decide anything, but every sync still measures against
   * it — and an anchor that has left the feed would log `anchor_not_in_feed`
   * on every run for ever, reading as a fault on a listing that is counting
   * correctly. So it is moved to the top of the feed this sync saw, unless the
   * plan's own advance already moved it or the plan was measured against an
   * anchor that has since moved.
   */
  for v_store in select jsonb_object_keys(v_store_top)
  loop
    if v_store_counted ? v_store and coalesce(v_store_advance ->> v_store, '') <> '' then
      continue;
    end if;
    if not coalesce((v_store_ok ->> v_store)::boolean, false) then
      continue;
    end if;
    update public.google_review_locations l
       set counted_through_external_review_id = v_store_top -> v_store ->> 'id',
           counted_through_set_at = p_seen_at,
           counted_through_set_by = left('posted-date:' || coalesce(p_credential_id, 'sync'), 64)
     where l.store_code = v_store
       and l.count_by_posted_date_from is not null
       and l.counted_through_external_review_id is distinct from (v_store_top -> v_store ->> 'id');
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
  'Idempotent batch upsert, keyed on (source, external_review_id). A review whose listing has a posted-date start and whose Google publication instant is on or after it is assigned to the reporting week it was posted (posted_date); otherwise it is assigned to the open period only where the caller proved it sits above the listing''s anchor and that anchor has not moved since (anchor_assigned). An assigned review never moves.';

-- ------------------------------------------------------ the repair --------
--
-- THE REVIEWS OCTOBER MISSED. Every review held as historical that the rule
-- above would have counted is assigned now, to the week it was posted — the
-- same thing the next sync to see each of them would do, except that the
-- feed only ever re-reads a listing's newest few, so most would never be seen
-- again. Null-to-period is the one transition the freeze trigger allows.

update public.google_reviews r
   set reporting_period_id = public.google_review_current_period(least(r.google_absolute_date, now())),
       reporting_assignment_status = 'posted_date'
  from public.google_review_locations l
 where l.id = r.location_id
   and r.reporting_period_id is null
   and r.google_absolute_date is not null
   and l.count_by_posted_date_from is not null
   and r.google_absolute_date >= l.count_by_posted_date_from;

-- -------------------------------------------------------------- the view ---
--
-- `google_reviews_enriched` as `20260917002200` declared it, with one column
-- appended: `counted_at`, the instant a counted review counts AT for month to
-- date. Its posting time when it counts by posted date; its first-seen time
-- when the anchor counted it, which is the floor of when that sync ran and is
-- exactly what month to date used before. Null for a review counted nowhere.

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
  r.updated_at,

  case
    when r.reporting_period_id is null then null
    when r.reporting_assignment_status = 'posted_date' then r.google_absolute_date
    else r.first_seen_at
  end                 as counted_at
from public.google_reviews r
join public.google_review_locations l on l.id = r.location_id
left join public.google_review_periods p on p.id = r.reporting_period_id
left join public.salon_directory d on d.salon_id = l.salon_id;

comment on view public.google_reviews_enriched is
  'One row per Google review with its salon name and district resolved through salon_directory, and its reporting period resolved through google_review_periods. A null period_start means the review is historical: stored and shown, counted nowhere. counted_at is the instant month to date credits a counted review to: when it was posted (posted_date) or first seen (anchor_assigned).';

revoke all on public.google_reviews_enriched from anon, authenticated;
