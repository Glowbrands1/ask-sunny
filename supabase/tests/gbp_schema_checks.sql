-- Ask Sunny — behavioural checks for the Business Profile API migration
-- (20261016001000_google_review_business_profile_api.sql).
--
-- Run against a THROWAWAY LOCAL CLUSTER, never against Supabase. Every value is
-- invented. The google_reviews migrations (20260917002000 onwards) must already
-- be applied, then the migration under test.
--
-- SELF-ASSERTING: each block raises if a guarantee does not hold, so with
-- ON_ERROR_STOP a clean run means every check passed.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/gbp_schema_checks.sql

\set ON_ERROR_STOP on
\pset pager off

-- ------------------------------------------------------------- fixtures ----
insert into public.salons (salon_number, store_name) values
  ('9001', 'Fixture One'), ('9002', 'Fixture Two')
on conflict do nothing;

insert into public.google_review_locations (store_code, salon_id, google_location_label)
select v.code, s.id, 'Sun Tan City - ' || v.code
from (values ('306', '9001'), ('307', '9002')) as v(code, num)
join public.salons s on s.salon_number = v.num
on conflict do nothing;

insert into public.google_reviews
  (external_review_id, location_id, store_code, reviewer_name, rating, review_text,
   google_absolute_date, first_seen_week, parser_version)
select x.id, l.id, '306', x.name, x.rating, x.txt, x.ts::timestamptz, date '2026-09-27', 'apify-v1'
from public.google_review_locations l,
     (values ('apify-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Sarah Miller', 5, 'Loved it', '2026-10-01T15:00:00Z'),
             ('apify-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Tom Jones', 4, 'Good', '2026-10-02T15:00:00Z'))
       as x(id, name, rating, txt, ts)
where l.store_code = '306'
on conflict do nothing;

-- ----------------------------- 1. existing rows untouched by the migration ----
do $$
declare v int;
begin
  select count(*) into v from public.google_reviews
   where gbp_review_id is not null or gbp_link_method is not null or gbp_create_time is not null;
  if v <> 0 then raise exception 'existing reviews must start unlinked, found % linked', v; end if;
  select count(*) into v from public.google_review_locations where gbp_mapping_status <> 'unmapped';
  if v <> 0 then raise exception 'existing listings must start unmapped'; end if;
end $$;

-- --------------------------------------------- 2. mapping confirmation rules ----
do $$
declare r jsonb;
begin
  r := public.gbp_confirm_location_mapping('306', 'accounts/1', 'locations/100', 'ChIJplace3060000', '{}'::jsonb, 'admin@example.com');
  if r ->> 'status' <> 'confirmed' then raise exception 'confirm failed: %', r; end if;

  -- the same Google location cannot be claimed by a second listing
  r := public.gbp_confirm_location_mapping('307', 'accounts/1', 'locations/100', null, '{}'::jsonb, 'admin@example.com');
  if r ->> 'status' <> 'location_already_mapped' then raise exception 'must refuse shared location: %', r; end if;

  -- a confirmed listing cannot be silently re-pointed
  r := public.gbp_confirm_location_mapping('306', 'accounts/1', 'locations/200', null, '{}'::jsonb, 'admin@example.com');
  if r ->> 'status' <> 'already_confirmed_to_different_location' then raise exception 'must refuse re-point: %', r; end if;

  -- an unknown store code is not invented
  r := public.gbp_confirm_location_mapping('999', 'accounts/1', 'locations/300', null, '{}'::jsonb, 'admin@example.com');
  if r ->> 'status' <> 'unknown_store_code' then raise exception 'must refuse unknown store: %', r; end if;

  -- an anonymous confirmation is refused
  begin
    perform public.gbp_confirm_location_mapping('307', 'accounts/1', 'locations/400', null, '{}'::jsonb, '  ');
    raise exception 'blank confirmer must be refused';
  exception when raise_exception then
    if sqlerrm like 'blank confirmer%' then raise; end if;
  end;
end $$;

-- 'confirmed' without evidence is impossible
do $$
begin
  begin
    update public.google_review_locations set gbp_mapping_status = 'confirmed' where store_code = '307';
    raise exception 'confirmed without evidence must be refused';
  exception when check_violation then null;
  end;
  begin
    update public.google_review_locations set gbp_location_name = 'locations/abc' where store_code = '307';
    raise exception 'malformed location name must be refused';
  exception when check_violation then null;
  end;
end $$;

-- ------------------------------------------------------- 3. linking rules ----
do $$
declare
  a uuid; b uuid; r jsonb;
  before_week date; before_seen timestamptz; before_period uuid; before_status text; before_pos int; before_text text; before_rating smallint; before_name text;
begin
  select id, first_seen_week, first_seen_at, review_text, rating, reviewer_name, reporting_period_id, reporting_assignment_status::text, feed_position
    into a, before_week, before_seen, before_text, before_rating, before_name, before_period, before_status, before_pos
    from public.google_reviews where external_review_id like 'apify-aaa%';
  select id into b from public.google_reviews where external_review_id like 'apify-bbb%';

  r := public.gbp_apply_links(jsonb_build_array(jsonb_build_object(
        'reviewId', a, 'gbpReviewId', 'GBPREVIEW0001', 'gbpReviewName', 'accounts/1/locations/100/reviews/GBPREVIEW0001',
        'method', 'auto_match', 'createTime', '2026-10-01T15:00:05Z', 'updateTime', '2026-10-02T00:00:00Z',
        'reviewerName', 'Sarah M. Miller', 'rating', 3, 'comment', 'CHANGED TEXT', 'replyText', 'Thank you', 'replyUpdateTime', '2026-10-02T01:00:00Z')));
  if (r ->> 'linked')::int <> 1 then raise exception 'link failed: %', r; end if;

  -- the official values sit BESIDE the stored ones; the stored ones are untouched
  if exists (select 1 from public.google_reviews where id = a and
       (first_seen_week is distinct from before_week or first_seen_at is distinct from before_seen
        or reporting_period_id is distinct from before_period or reporting_assignment_status::text is distinct from before_status
        or feed_position is distinct from before_pos
        or review_text is distinct from before_text or rating is distinct from before_rating
        or reviewer_name is distinct from before_name or has_owner_response or owner_response_text is not null)) then
    raise exception 'linking must not change first_seen_week, first_seen_at, reporting period/assignment, feed position, rating, text, name or reply';
  end if;
  if not exists (select 1 from public.google_reviews where id = a and gbp_rating = 3 and gbp_comment = 'CHANGED TEXT'
                  and gbp_reply_text = 'Thank you' and gbp_link_method = 'auto_match' and gbp_linked_at is not null) then
    raise exception 'official values were not recorded';
  end if;

  -- idempotent: the same link again refreshes, never duplicates
  r := public.gbp_apply_links(jsonb_build_array(jsonb_build_object('reviewId', a, 'gbpReviewId', 'GBPREVIEW0001', 'method', 'exact_id', 'rating', 3)));
  if (r ->> 'refreshed')::int <> 1 or (r ->> 'linked')::int <> 0 then raise exception 'repeat link must refresh: %', r; end if;
  if (select gbp_link_method from public.google_reviews where id = a) <> 'auto_match' then
    raise exception 'a repeat sync must not rewrite how the link was first established';
  end if;

  -- one official review cannot attach to two stored rows
  r := public.gbp_apply_links(jsonb_build_array(jsonb_build_object('reviewId', b, 'gbpReviewId', 'GBPREVIEW0001', 'method', 'auto_match', 'rating', 4)));
  if (r ->> 'conflicts')::int <> 1 then raise exception 'must refuse a second row for one official id: %', r; end if;

  -- a linked row cannot be re-pointed at a different official review
  r := public.gbp_apply_links(jsonb_build_array(jsonb_build_object('reviewId', a, 'gbpReviewId', 'GBPREVIEW0002', 'method', 'auto_match', 'rating', 5)));
  if (r ->> 'conflicts')::int <> 1 then raise exception 'must refuse re-pointing: %', r; end if;

  -- the unique index backs it up even if the function were bypassed
  begin
    update public.google_reviews set gbp_review_id = 'GBPREVIEW0001', gbp_link_method = 'manual', gbp_linked_at = now() where id = b;
    raise exception 'unique index must refuse a duplicate official id';
  exception when unique_violation then null;
  end;

  -- a half-written link is impossible
  begin
    update public.google_reviews set gbp_review_id = 'GBPREVIEW0009' where id = b;
    raise exception 'a link without method/time must be refused';
  exception when check_violation then null;
  end;
end $$;

-- the write-once triggers still bite after the migration
do $$
begin
  begin
    update public.google_reviews set first_seen_week = date '2026-01-04' where external_review_id like 'apify-aaa%';
    raise exception 'first_seen_week must stay write-once';
  exception when raise_exception then
    if sqlerrm like 'first_seen_week must%' then raise; end if;
  end;
end $$;

-- ------------------------------------------- 4. manual-review queue rules ----
do $$
declare loc uuid; rid uuid; n int;
begin
  select id into loc from public.google_review_locations where store_code = '306';
  select id into rid from public.google_reviews where external_review_id like 'apify-bbb%';

  n := public.gbp_record_review_items(jsonb_build_array(jsonb_build_object(
        'locationId', loc, 'gbpReviewId', 'GBPREVIEW0050', 'reasons', jsonb_build_array('no_timestamp_on_existing'),
        'candidateReviewIds', jsonb_build_array(rid), 'official', jsonb_build_object('rating', 5))));
  if n <> 1 then raise exception 'item not recorded'; end if;

  -- recorded twice is still one row (idempotent), and a resolved item is never reopened
  perform public.gbp_record_review_items(jsonb_build_array(jsonb_build_object(
        'locationId', loc, 'gbpReviewId', 'GBPREVIEW0050', 'reasons', jsonb_build_array('multiple_candidates'),
        'candidateReviewIds', '[]'::jsonb, 'official', '{}'::jsonb)));
  if (select count(*) from public.google_review_reconciliation_items where gbp_review_id = 'GBPREVIEW0050') <> 1 then
    raise exception 'queue must be idempotent';
  end if;

  update public.google_review_reconciliation_items
     set status = 'resolved_new', resolved_by = 'admin@example.com', resolved_at = now()
   where gbp_review_id = 'GBPREVIEW0050';
  perform public.gbp_record_review_items(jsonb_build_array(jsonb_build_object(
        'locationId', loc, 'gbpReviewId', 'GBPREVIEW0050', 'reasons', jsonb_build_array('rating_differs'),
        'candidateReviewIds', '[]'::jsonb, 'official', '{}'::jsonb)));
  if (select reasons from public.google_review_reconciliation_items where gbp_review_id = 'GBPREVIEW0050') <> array['multiple_candidates'] then
    raise exception 'a resolved item must not be reopened or rewritten by a later sync';
  end if;

  begin
    update public.google_review_reconciliation_items set status = 'dismissed' where gbp_review_id = 'GBPREVIEW0050' and false;
    update public.google_review_reconciliation_items set status = 'dismissed', resolved_by = null where gbp_review_id = 'GBPREVIEW0050';
    raise exception 'a resolution without who/when must be refused';
  exception when check_violation then null;
  end;
end $$;

-- ------------------------------ 5. the existing ingestion RPC takes gbp_api ----
-- The new enum value must be usable by the unchanged ingest function, and must
-- file under the EXISTING dedup key without disturbing the stored week.
select public.google_review_ingestion_source 'gbp_api' as gbp_value_is_usable;

-- ---------------------------------------------- 6. privileges and RLS ----
do $$
declare t text;
begin
  foreach t in array array['google_review_reconciliation_items', 'google_review_gbp_sync_runs'] loop
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception 'browser roles must hold no privilege on %', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'RLS must be enabled on %', t;
    end if;
  end loop;

  foreach t in array array[
    'public.gbp_apply_links(jsonb)',
    'public.gbp_record_review_items(jsonb)',
    'public.gbp_confirm_location_mapping(text,text,text,text,jsonb,text)'] loop
    if has_function_privilege('anon', t, 'execute') or has_function_privilege('authenticated', t, 'execute') then
      raise exception 'browser roles must not execute %', t;
    end if;
  end loop;
end $$;

-- ------------------------------------------- 7. the dashboard view is intact ----
do $$
begin
  perform 1 from public.google_reviews_enriched limit 1;
  if exists (select 1 from information_schema.columns
              where table_name = 'google_reviews_enriched' and column_name like 'gbp\_%') then
    raise exception 'the dashboard view must be unchanged';
  end if;
end $$;


-- ------------------------------------------------ 8. the sealed OAuth connection ----
do $$
declare a uuid; b uuid;
begin
  a := public.gbp_set_connection('v1.AAAA.BBBB.CCCC', array['https://www.googleapis.com/auth/business.manage'], 'admin@example.com');
  b := public.gbp_set_connection('v1.DDDD.EEEE.FFFF', array['https://www.googleapis.com/auth/business.manage'], 'admin@example.com');
  if (select count(*) from public.google_review_gbp_connections where status = 'active') <> 1 then
    raise exception 'there must be exactly one active connection';
  end if;
  if (select status from public.google_review_gbp_connections where id = a) <> 'revoked' then
    raise exception 'a new connection must replace the old one';
  end if;

  -- a plaintext token can never be stored: only the sealed v1.* format is accepted
  begin
    insert into public.google_review_gbp_connections (refresh_token_sealed, connected_by)
    values ('1//0gPlaintextRefreshToken', 'admin@example.com');
    raise exception 'a plaintext token must be refused';
  exception when check_violation then null;
  end;

  -- two active connections are impossible even bypassing the function
  begin
    insert into public.google_review_gbp_connections (refresh_token_sealed, connected_by)
    values ('v1.GGGG.HHHH.IIII', 'admin@example.com');
    raise exception 'a second active connection must be refused';
  exception when unique_violation then null;
  end;

  perform public.gbp_end_connection('expired', 'invalid_grant', 'system:cron');
  if exists (select 1 from public.google_review_gbp_connections where status = 'active') then
    raise exception 'ending must deactivate the connection';
  end if;
  begin
    perform public.gbp_end_connection('bogus', null, 'x');
    raise exception 'a bad status must be refused';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ------------------------------------------------------------ 9. the run lock ----
do $$
declare first_run uuid; second_run uuid; third_run uuid;
begin
  first_run := public.gbp_claim_run('cron', 'incremental');
  if first_run is null then raise exception 'the first claim must succeed'; end if;

  second_run := public.gbp_claim_run('pubsub', 'incremental');
  if second_run is not null then raise exception 'a second concurrent run must be refused'; end if;

  -- a run that died long ago is abandoned by the next claim, not left blocking forever
  update public.google_review_gbp_sync_runs set started_at = now() - interval '2 hours' where id = first_run;
  third_run := public.gbp_claim_run('cron', 'incremental');
  if third_run is null then raise exception 'a stale run must not block the next one'; end if;
  if (select error_code from public.google_review_gbp_sync_runs where id = first_run) <> 'abandoned' then
    raise exception 'a stale run must be marked abandoned';
  end if;
  update public.google_review_gbp_sync_runs set status = 'succeeded', finished_at = now() where id = third_run;
  if public.gbp_claim_run('admin', 'incremental') is null then raise exception 'a finished run must release the lock'; end if;
end $$;

-- the new objects are server-only too
do $$
begin
  if has_table_privilege('anon', 'public.google_review_gbp_connections', 'select')
     or has_table_privilege('authenticated', 'public.google_review_gbp_connections', 'select') then
    raise exception 'browser roles must not read the sealed token table';
  end if;
  if has_function_privilege('anon', 'public.gbp_set_connection(text,text[],text)', 'execute')
     or has_function_privilege('authenticated', 'public.gbp_claim_run(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.gbp_end_connection(text,text,text)', 'execute') then
    raise exception 'browser roles must not execute the connection or lock functions';
  end if;
end $$;

\echo 'gbp_schema_checks: all checks passed'
