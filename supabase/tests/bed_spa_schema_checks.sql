-- Ask Sunny — behavioural checks for the Bed Usage and Spa reporting migrations.
--
-- Run against a THROWAWAY LOCAL CLUSTER, never against Supabase. See README.md
-- in this directory for the exact commands.
--
-- Every value below is invented. There is no real salon, figure or period here.
--
-- Steps marked MUST FAIL are expected to print an error: they are the point of
-- the file. A MUST FAIL step that succeeds is a regression in the schema.
--
-- What this covers that static text analysis cannot:
--
--   * that a zero-session spa row is REFUSED BY POSTGRES, not merely avoided
--     by the parser;
--   * that MTD, YTD and LTM through the same day are three distinct periods;
--   * that supersession is scoped to (period, company) and a different period
--     supersedes nothing;
--   * that the Spa Conversion view joins on the period ROW, so a year's
--     sessions cannot be divided by a month's traffic;
--   * that a peer count of zero cannot carry a peer average;
--   * that the browser-held roles hold no write privilege on any new table.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== seed sanity ==='
select 'levels seeded' as check, count(*)::text as result from public.bed_equipment_levels
union all select 'FAST is advisory', (advisory_only::text) from public.bed_equipment_levels where code='FAST'
union all select 'FASTER is premium', (is_premium::text) from public.bed_equipment_levels where code='FASTER'
union all select 'new sources seeded', count(*)::text from public.report_sources
  where code in ('bed_usage_email','spa_wellness_email','spa_engagement_email')
union all select 'ltm grain exists',
  (exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
          where t.typname='report_period_grain' and e.enumlabel='ltm'))::text;

-- ------------------------------------------------------------- fixtures ---

insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/bed.xlsx','bed.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('c',64), 'BED-MSG-1' from public.report_sources where code='bed_usage_email';

insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/spa.xlsx','spa.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('d',64), 'SPA-MSG-1' from public.report_sources where code='spa_wellness_email';

\echo '--- P1 three periods ending on the SAME DAY, three grains -> MUST SUCCEED'
insert into public.report_periods (grain, period_end, period_start, fiscal_year, label_raw) values
  ('mtd','2026-09-30','2026-09-01',2026,'Bed Usage Report: 9/1/2026 to 9/30/2026'),
  ('ytd','2026-09-30','2026-01-01',2026,'SPA Wellness YTD'),
  ('ltm','2026-09-30','2025-09-30',2026,'SPA Wellness LTM');

select 'P1' as t, count(*)::text as periods_ending_same_day, (count(*)=3)::text as pass
from public.report_periods where period_end='2026-09-30';

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'bed_usage_monthly', 1, 'succeeded', p.id, repeat('e',64), now()
from public.report_files f, public.report_periods p
where f.original_filename='bed.xlsx' and p.grain='mtd' and p.period_end='2026-09-30';

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'spa_wellness_tracking', 1, 'succeeded', p.id, repeat('f',64), now()
from public.report_files f, public.report_periods p
where f.original_filename='spa.xlsx' and p.grain='mtd' and p.period_end='2026-09-30';

insert into public.salons (salon_number, store_name) values
  ('0901','Fictional Bed Store'),
  ('0902','Fictional Spa Store');

-- ---------------------------------------------------------- bed usage ---

insert into public.bed_usage_snapshots (ingestion_id, period_id, company, salon_count, equipment_count, source_salon_count, source_company_count)
select i.id, i.period_id, 'Fictional Holdings', 1, 2, 250, 30
from public.report_ingestions i where i.parser_key='bed_usage_monthly';

\echo '--- B1 salon fact -> MUST SUCCEED'
insert into public.bed_usage_salon_facts (ingestion_id, snapshot_id, period_id, salon_id, total_tans, bed_count, source_row)
select s.ingestion_id, s.id, s.period_id, sa.id, 1000, 5, 24
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number='0901';

\echo '--- B2 a SECOND live salon fact for the same salon and period -> MUST FAIL'
insert into public.bed_usage_salon_facts (ingestion_id, snapshot_id, period_id, salon_id, total_tans, bed_count, source_row)
select s.ingestion_id, s.id, s.period_id, sa.id, 9999, 5, 25
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number='0901';

\echo '--- B3 TWO MODELS AT THE SAME LEVEL for one salon -> MUST SUCCEED'
-- A salon really does hold two INSTANT models (CLASSIC Ergoline 1050 and
-- SIGNATURE KBL 8000 HybridSun), so the model is part of the live key.
insert into public.bed_usage_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, level, bed_type, qty, client_tans, per_bed, v_chain_percent, v_chain_ratio)
select s.ingestion_id, s.id, s.period_id, sa.id, 'INSTANT', 'Model A', 2, 600, 300, 0, 1.0
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number='0901';

insert into public.bed_usage_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, level, bed_type, qty, client_tans, per_bed, v_chain_percent, v_chain_ratio)
select s.ingestion_id, s.id, s.period_id, sa.id, 'INSTANT', 'Model B', 1, 400, 400, 33.3333, 1.3333
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number='0901';

\echo '--- B4 the SAME model twice at the same level -> MUST FAIL'
insert into public.bed_usage_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, level, bed_type, qty, client_tans, per_bed)
select s.ingestion_id, s.id, s.period_id, sa.id, 'INSTANT', 'Model A', 2, 111, 55
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number='0901';

\echo '--- B5 a zero quantity -> MUST FAIL (a row describes installed units)'
insert into public.bed_usage_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, level, bed_type, qty, client_tans, per_bed)
select s.ingestion_id, s.id, s.period_id, sa.id, 'SPA', 'Model C', 0, 10, 10
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number='0901';

\echo '--- B6 an UNKNOWN equipment level -> MUST SUCCEED (a new level understates nothing)'
insert into public.bed_usage_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, level, bed_type, qty, client_tans, per_bed)
select s.ingestion_id, s.id, s.period_id, sa.id, 'ULTRA', 'Model D', 1, 250, 250
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number='0901';

\echo '--- B7 the salon read view recomputes per-bed usage'
select 'B7' as t, total_tans::text, bed_count::text, per_bed::text, (per_bed = 200)::text as pass
from public.bed_usage_current_salon_facts where salon_number='0901';

\echo '--- B9 a SUPERSEDED salon attribute row must not duplicate a salon'
-- THE FAN-OUT THIS PINS. `salon_period_attributes` is unique per (salon,
-- period) only among LIVE rows, because a corrected Comp Report keeps the old
-- attributes and marks them superseded. The live project holds two rows per
-- (salon, mtd 2026-08-31) from two comp parsers. A left join on (salon_id,
-- period_id) alone therefore returns one copy of each Bed Usage row per
-- historical attribute row — 30 salons instead of 15, and double every total,
-- while the per-bed ratio stays correct because it divides two doubled sums.
insert into public.salon_period_attributes (salon_id, period_id, ingestion_id, district_label, region_label)
select sa.id, s.period_id, s.ingestion_id, 'Live District', 'Live Region'
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number = '0901';

insert into public.salon_period_attributes (salon_id, period_id, ingestion_id, district_label, region_label, superseded_by_ingestion_id)
select sa.id, s.period_id, s.ingestion_id, 'Stale District', 'Stale Region', s.ingestion_id
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number = '0901';

select 'B9' as t,
       count(*)::text as salon_rows_in_the_view,
       max(district_label) as district_shown,
       (count(*) = 1 and max(district_label) = 'Live District')::text as pass
from public.bed_usage_current_salon_facts where salon_number = '0901';

\echo '--- B9b the equipment view must not duplicate either'
select 'B9b' as t,
       count(*)::text as equipment_rows,
       (count(*) = (select count(*) from public.bed_usage_equipment_facts f
                     join public.salons sa on sa.id = f.salon_id
                    where sa.salon_number = '0901'
                      and f.superseded_by_ingestion_id is null))::text as pass
from public.bed_usage_current_equipment_facts where salon_number = '0901';

\echo '--- B8 the FAST advisory flag reaches the read view'
insert into public.bed_usage_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, level, bed_type, qty, client_tans, per_bed, v_chain_percent)
select s.ingestion_id, s.id, s.period_id, sa.id, 'FAST', 'Model E', 4, 40, 10, -90
from public.bed_usage_snapshots s, public.salons sa where sa.salon_number='0901';

select 'B8' as t, level, level_advisory_only::text, v_chain_percent::text,
       (level_advisory_only)::text as pass
from public.bed_usage_current_equipment_facts where salon_number='0901' and level='FAST';

-- -------------------------------------------------------- spa wellness ---

insert into public.spa_equipment_types (code, label, short_label, is_comparable, display_order)
values
  ('spa_hydromassage','SPA Hydromassage','Hydromassage',true,1),
  ('spa_novel_device','SPA Novel Device','Novel Device',true,2),
  ('other','Other','Other',false,3);

\echo '--- S0 a type first seen in a delivery is stored, no deployment needed'
select 'S0' as t, code, is_comparable::text from public.spa_equipment_types where code='spa_novel_device';

insert into public.spa_wellness_snapshots (ingestion_id, period_id, window_code, source_sheet, company, salon_count, equipment_type_count, equipment_use_count, not_installed_cell_count)
select i.id, i.period_id, 'mtd', 'MTD', 'Fictional Holdings', 1, 3, 1, 2
from public.report_ingestions i where i.parser_key='spa_wellness_tracking';

\echo '--- S1 an installed, used unit -> MUST SUCCEED'
insert into public.spa_wellness_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, equipment_type_id, sessions)
select s.ingestion_id, s.id, s.period_id, sa.id, t.id, 140
from public.spa_wellness_snapshots s, public.salons sa, public.spa_equipment_types t
where sa.salon_number='0901' and t.code='spa_hydromassage';

\echo '--- S2 A ZERO-SESSION ROW -> MUST FAIL'
-- THE CENTRAL BUSINESS RULE, ENFORCED BY POSTGRES. A zero in this source means
-- the equipment is not installed, so there is nothing to store — and no
-- average written later can count an absence as a failure.
insert into public.spa_wellness_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, equipment_type_id, sessions)
select s.ingestion_id, s.id, s.period_id, sa.id, t.id, 0
from public.spa_wellness_snapshots s, public.salons sa, public.spa_equipment_types t
where sa.salon_number='0901' and t.code='spa_novel_device';

\echo '--- S3 A NULL-SESSION ROW -> MUST FAIL'
insert into public.spa_wellness_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, equipment_type_id, sessions)
select s.ingestion_id, s.id, s.period_id, sa.id, t.id, null
from public.spa_wellness_snapshots s, public.salons sa, public.spa_equipment_types t
where sa.salon_number='0901' and t.code='spa_novel_device';

\echo '--- S4 a benchmark with NO PEERS and a peer average -> MUST FAIL'
-- Nobody to compare with is not a comparison of nothing.
insert into public.spa_equipment_benchmarks (ingestion_id, snapshot_id, period_id, equipment_type_id, chain_salon_count, chain_average_sessions, peer_salon_count, peer_average_sessions)
select s.ingestion_id, s.id, s.period_id, t.id, 1, 140, 0, 500
from public.spa_wellness_snapshots s, public.spa_equipment_types t where t.code='spa_hydromassage';

\echo '--- S5 a benchmark with no peers and a NULL peer average -> MUST SUCCEED'
insert into public.spa_equipment_benchmarks (ingestion_id, snapshot_id, period_id, equipment_type_id, chain_salon_count, chain_average_sessions, peer_salon_count, peer_average_sessions)
select s.ingestion_id, s.id, s.period_id, t.id, 1, 140, 0, null
from public.spa_wellness_snapshots s, public.spa_equipment_types t where t.code='spa_hydromassage';

\echo '--- S6 first use after last use -> MUST FAIL'
insert into public.spa_wellness_equipment_facts (ingestion_id, snapshot_id, period_id, salon_id, equipment_type_id, sessions, first_use_date, last_use_date)
select s.ingestion_id, s.id, s.period_id, sa.id, t.id, 12, '2026-09-30', '2026-09-01'
from public.spa_wellness_snapshots s, public.salons sa, public.spa_equipment_types t
where sa.salon_number='0902' and t.code='spa_novel_device';

insert into public.spa_wellness_salon_facts (ingestion_id, snapshot_id, period_id, salon_id, total_sessions, equipment_pieces, equipment_types_used)
select s.ingestion_id, s.id, s.period_id, sa.id, 140, 4, 1
from public.spa_wellness_snapshots s, public.salons sa where sa.salon_number='0901';

-- ----------------------------------------------------- spa conversion ---

\echo '--- C1 the conversion view divides sessions by tans for the SAME period'
select 'C1' as t, salon_number, total_tans::text, spa_sessions::text,
       round(spa_conversion_rate, 4)::text as rate,
       (round(spa_conversion_rate, 4) = round(140.0/1000.0, 4))::text as pass
from public.spa_conversion_current where salon_number='0901';

\echo '--- C2 a YTD spa window cannot be divided by an MTD traffic figure'
-- Same period_end, eight times the sessions. The view joins on the period ROW,
-- which carries the grain, so this must produce NO ROW rather than a plausible
-- and meaningless percentage.
insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'spa_wellness_tracking', 2, 'succeeded', p.id, repeat('1',64), now()
from public.report_files f, public.report_periods p
where f.original_filename='spa.xlsx' and p.grain='ytd' and p.period_end='2026-09-30';

insert into public.spa_wellness_snapshots (ingestion_id, period_id, window_code, source_sheet, company, salon_count, equipment_type_count, equipment_use_count)
select i.id, i.period_id, 'ytd', 'YTD', 'Fictional Holdings', 1, 3, 1
from public.report_ingestions i where i.parser_key='spa_wellness_tracking' and i.parser_version=2;

insert into public.spa_wellness_salon_facts (ingestion_id, snapshot_id, period_id, salon_id, total_sessions, equipment_pieces, equipment_types_used)
select s.ingestion_id, s.id, s.period_id, sa.id, 1120, 4, 1
from public.spa_wellness_snapshots s, public.salons sa
where s.window_code='ytd' and sa.salon_number='0901';

select 'C2' as t, count(*)::text as conversion_rows_for_salon, (count(*)=1)::text as pass
from public.spa_conversion_current where salon_number='0901';

-- ------------------------------------------------------ spa engagement ---

insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/eng.xlsx','eng.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('2',64), 'ENG-MSG-1' from public.report_sources where code='spa_engagement_email';

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'spa_engagement_unique_tanner', 1, 'succeeded', p.id, repeat('3',64), now()
from public.report_files f, public.report_periods p
where f.original_filename='eng.xlsx' and p.grain='mtd' and p.period_end='2026-09-30';

insert into public.spa_engagement_snapshots (ingestion_id, period_id, company, rank_population, rank_weights, salon_count)
select i.id, i.period_id, 'Fictional Holdings', 248,
       '{"rank_spa_sessions_per_bed":0.25,"rank_spa_sessions_per_unique_per_bed":0.25,"rank_unique_spa_tanner_pct":0.5}'::jsonb,
       1
from public.report_ingestions i where i.parser_key='spa_engagement_unique_tanner';

\echo '--- E1 the four raw counts -> MUST SUCCEED'
insert into public.spa_engagement_salon_facts (
  ingestion_id, snapshot_id, period_id, salon_id,
  spa_sessions, total_unique_tanners, unique_spa_tanners, spa_beds,
  reported_overall_rank, reported_ranks)
select s.ingestion_id, s.id, s.period_id, sa.id, 33, 74, 17, 4, 7,
       '{"rank_spa_sessions_per_bed":20}'::jsonb
from public.spa_engagement_snapshots s, public.salons sa where sa.salon_number='0901';

\echo '--- E2 more spa customers than customers -> MUST FAIL'
insert into public.spa_engagement_salon_facts (
  ingestion_id, snapshot_id, period_id, salon_id,
  spa_sessions, total_unique_tanners, unique_spa_tanners, spa_beds)
select s.ingestion_id, s.id, s.period_id, sa.id, 10, 20, 30, 2
from public.spa_engagement_snapshots s, public.salons sa where sa.salon_number='0902';

\echo '--- E3 the read view keeps Spa Per Unique % and the bed-normalized figure APART'
-- 33/74 = 0.4459 and 33/74/4 = 0.1115. A factor of four apart, because the
-- salon has four beds. Labelling one as the other changes a business
-- definition.
select 'E3' as t,
       round(spa_per_unique_pct, 6)::text as spa_per_unique,
       round(spa_sessions_per_unique_per_bed, 6)::text as per_unique_per_bed,
       round(spa_sessions_per_bed, 6)::text as per_bed,
       round(unique_spa_tanner_pct, 6)::text as unique_pct,
       (round(spa_per_unique_pct / spa_sessions_per_unique_per_bed, 6) = 4)::text as pass
from public.spa_engagement_current_salon_facts where salon_number='0901';

\echo '--- E4 a salon with no spa beds gets NULL, not zero'
insert into public.spa_engagement_salon_facts (
  ingestion_id, snapshot_id, period_id, salon_id,
  spa_sessions, total_unique_tanners, unique_spa_tanners, spa_beds)
select s.ingestion_id, s.id, s.period_id, sa.id, 0, 50, 0, 0
from public.spa_engagement_snapshots s, public.salons sa where sa.salon_number='0902';

select 'E4' as t, salon_number,
       coalesce(spa_sessions_per_bed::text, 'NULL') as per_bed,
       (spa_sessions_per_bed is null)::text as pass
from public.spa_engagement_current_salon_facts where salon_number='0902';

\echo '--- E5 one live daily row per salon per day -> the second MUST FAIL'
insert into public.spa_engagement_daily_facts (ingestion_id, snapshot_id, salon_id, activity_date, unique_tanners, unique_spa_tanners, total_visits, spa_visits)
select s.ingestion_id, s.id, sa.id, '2026-09-01', 74, 17, 87, 33
from public.spa_engagement_snapshots s, public.salons sa where sa.salon_number='0901';

insert into public.spa_engagement_daily_facts (ingestion_id, snapshot_id, salon_id, activity_date, unique_tanners, unique_spa_tanners, total_visits, spa_visits)
select s.ingestion_id, s.id, sa.id, '2026-09-01', 99, 17, 87, 33
from public.spa_engagement_snapshots s, public.salons sa where sa.salon_number='0901';

-- -------------------------------------------- supersession, by function ---

\echo '--- X1 a CORRECTED report for the SAME period supersedes the earlier one'
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/bed-v2.xlsx','bed-v2.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('4',64), 'BED-MSG-2' from public.report_sources where code='bed_usage_email';

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, fingerprint)
select f.id, f.source_id, 'bed_usage_monthly', 1, 'parsing', repeat('5',64)
from public.report_files f where f.original_filename='bed-v2.xlsx';

select 'X1' as t, public.complete_bed_usage_ingestion(
  (select id from public.report_ingestions where fingerprint = repeat('5',64)),
  jsonb_build_object(
    'period', jsonb_build_object('grain','mtd','period_end','2026-09-30','period_start','2026-09-01','fiscal_year',2026,'label_raw','Bed Usage Report: 9/1/2026 to 9/30/2026'),
    'company','Fictional Holdings',
    'salons', jsonb_build_array(jsonb_build_object('store_name','Fictional Bed Store','total_tans',1200,'bed_count',5,'source_row',24)),
    'equipment', jsonb_build_array(jsonb_build_object('store_name','Fictional Bed Store','level','INSTANT','bed_type','Model A','qty',2,'client_tans',700,'per_bed',350)),
    'benchmarks', jsonb_build_array(jsonb_build_object('level','INSTANT','tans_per_bed',300,'total_beds',800)),
    'diagnostics', jsonb_build_object('source_salon_count',250,'source_company_count',30),
    'warnings', jsonb_build_array()
  )
)::text as result;

select 'X1b' as t, 'live snapshots for the period' as check, count(*)::text as result, (count(*)=1)::text as pass
from public.bed_usage_snapshots where period_id=(select id from public.report_periods where grain='mtd' and period_end='2026-09-30')
  and superseded_by_ingestion_id is null;

select 'X1c' as t, 'the corrected figure is the live one' as check, total_tans::text as result, (total_tans=1200)::text as pass
from public.bed_usage_current_salon_facts where salon_number='0901';

\echo '--- X2 a report for a DIFFERENT period supersedes NOTHING'
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/bed-aug.xlsx','bed-aug.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('6',64), 'BED-MSG-3' from public.report_sources where code='bed_usage_email';

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, fingerprint)
select f.id, f.source_id, 'bed_usage_monthly', 1, 'parsing', repeat('7',64)
from public.report_files f where f.original_filename='bed-aug.xlsx';

select 'X2' as t, (public.complete_bed_usage_ingestion(
  (select id from public.report_ingestions where fingerprint = repeat('7',64)),
  jsonb_build_object(
    'period', jsonb_build_object('grain','mtd','period_end','2026-08-31','period_start','2026-08-01','fiscal_year',2026,'label_raw','Bed Usage Report: 8/1/2026 to 8/31/2026'),
    'company','Fictional Holdings',
    'salons', jsonb_build_array(jsonb_build_object('store_name','Fictional Bed Store','total_tans',900,'bed_count',5,'source_row',24)),
    'equipment', jsonb_build_array(jsonb_build_object('store_name','Fictional Bed Store','level','INSTANT','bed_type','Model A','qty',2,'client_tans',500,'per_bed',250)),
    'benchmarks', jsonb_build_array(),
    'diagnostics', jsonb_build_object('source_salon_count',250,'source_company_count',30),
    'warnings', jsonb_build_array()
  )
)->>'superseded_facts') as superseded, 'a backfill must supersede nothing' as note;

select 'X2b' as t, 'both periods are live' as check, count(*)::text as result, (count(*)=2)::text as pass
from public.bed_usage_salon_facts where superseded_by_ingestion_id is null;

\echo '--- X3 an unresolved salon name is RETURNED, never invented'
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/bed-oct.xlsx','bed-oct.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('8',64), 'BED-MSG-4' from public.report_sources where code='bed_usage_email';

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, fingerprint)
select f.id, f.source_id, 'bed_usage_monthly', 1, 'parsing', repeat('9',64)
from public.report_files f where f.original_filename='bed-oct.xlsx';

select 'X3' as t, (public.complete_bed_usage_ingestion(
  (select id from public.report_ingestions where fingerprint = repeat('9',64)),
  jsonb_build_object(
    'period', jsonb_build_object('grain','mtd','period_end','2026-10-31','period_start','2026-10-01','fiscal_year',2026,'label_raw','Bed Usage Report: 10/1/2026 to 10/31/2026'),
    'company','Fictional Holdings',
    'salons', jsonb_build_array(
      jsonb_build_object('store_name','Fictional Bed Store','total_tans',950,'bed_count',5,'source_row',24),
      jsonb_build_object('store_name','A Salon Nobody Knows','total_tans',100,'bed_count',2,'source_row',25)),
    'equipment', jsonb_build_array(jsonb_build_object('store_name','Fictional Bed Store','level','INSTANT','bed_type','Model A','qty',2,'client_tans',500,'per_bed',250)),
    'benchmarks', jsonb_build_array(),
    'diagnostics', jsonb_build_object('source_salon_count',250,'source_company_count',30),
    'warnings', jsonb_build_array()
  )
)->>'unresolved_salons') as unresolved, 'the unknown name comes back, no salon created' as note;

select 'X3b' as t, 'no salon was invented' as check, count(*)::text as result, (count(*)=0)::text as pass
from public.salons where store_name='A Salon Nobody Knows';

\echo '--- X4 the spa wellness function refuses a zero-session row rather than storing it'
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/spa-v2.xlsx','spa-v2.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('a',63)||'0', 'SPA-MSG-2' from public.report_sources where code='spa_wellness_email';

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, fingerprint)
select f.id, f.source_id, 'spa_wellness_tracking', 1, 'parsing', repeat('b',63)||'0'
from public.report_files f where f.original_filename='spa-v2.xlsx';

select 'X4' as t, public.complete_spa_wellness_ingestion(
  (select id from public.report_ingestions where fingerprint = repeat('b',63)||'0'),
  jsonb_build_object(
    'period', jsonb_build_object('grain','mtd','period_end','2026-10-31','period_start','2026-10-01','fiscal_year',2026,'label_raw','SPA Wellness MTD'),
    'window_code','mtd','source_sheet','MTD','company','Fictional Holdings',
    'equipment_types', jsonb_build_array(
      jsonb_build_object('code','spa_hydromassage','label','SPA Hydromassage','short_label','Hydromassage','is_comparable',true,'display_order',1),
      jsonb_build_object('code','spa_brand_new_2027','label','SPA Brand New 2027','short_label','Brand New 2027','is_comparable',true,'display_order',2)),
    'salons', jsonb_build_array(jsonb_build_object('store_name','Fictional Bed Store','total_sessions',150,'equipment_pieces',4,'equipment_types_used',1,'source_row',11)),
    'equipment_use', jsonb_build_array(
      jsonb_build_object('store_name','Fictional Bed Store','equipment_code','spa_hydromassage','sessions',150,'source_row',11),
      jsonb_build_object('store_name','Fictional Bed Store','equipment_code','spa_brand_new_2027','sessions',0,'source_row',11)),
    'benchmarks', jsonb_build_array(jsonb_build_object('equipment_code','spa_hydromassage','chain_salon_count',5,'chain_average_sessions',300,'peer_salon_count',4,'peer_average_sessions',330)),
    'diagnostics', jsonb_build_object('source_salon_count',248,'not_installed_cells',1),
    'warnings', jsonb_build_array()
  )
)::text as result;

select 'X4b' as t, 'the zero-session row was not stored' as check, count(*)::text as result, (count(*)=1)::text as pass
from public.spa_wellness_equipment_facts f
join public.report_periods p on p.id=f.period_id
where p.period_end='2026-10-31' and f.superseded_by_ingestion_id is null;

select 'X4c' as t, 'a type first seen this delivery was created' as check, count(*)::text as result, (count(*)=1)::text as pass
from public.spa_equipment_types where code='spa_brand_new_2027';

-- ------------------------------------------------------------ privileges ---

\echo '\echo ''
\echo '=== SHARED PERIODS MUST NOT MOVE THE SALON PERFORMANCE TAB ==='
--
-- THE REGRESSION. `report_periods` is shared between families on purpose — Spa
-- Conversion Rate needs Bed Usage traffic and SPA Wellness sessions on the SAME
-- period row. What must NOT follow is another family's ingestion becoming the
-- period the Comp Report tab opens on.
--
-- Salon Performance resolves its period with, in effect,
--   select * from comp_sales_report_scope order by period_end desc, ingested_at desc limit 1
-- so a non-Comp row that sorts first silently retargets the whole page. In
-- production that showed as "This period holds no comparisons yet" over a
-- period whose Comp Report held 922 live facts.

-- A COMP delivery on an EARLIER period, with facts.
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/comp.xlsx','comp.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('a',64), 'COMP-MSG-1' from public.report_sources where code='comp_report_email';

insert into public.report_periods (grain, period_end, period_start, fiscal_year, label_raw)
values ('mtd','2026-10-31','2026-10-01',2026,'MTD 10/31/2026')
on conflict (grain, period_end) do nothing;

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'comp_sales_mtd_vs_2024', 1, 'succeeded', p.id, repeat('1',64), now() - interval '1 hour'
from public.report_files f, public.report_periods p
where f.original_filename='comp.xlsx' and p.grain='mtd' and p.period_end='2026-10-31';

insert into public.comp_sales_facts
  (ingestion_id, period_id, salon_id, metric_id, metric_basis_year_required,
   source_sheet, source_column, value)
-- `metric_basis_year_required` is READ FROM THE METRIC, not asserted: the FK is
-- COMPOSITE — (metric_id, metric_basis_year_required) references
-- report_metrics (id, basis_year_required) — so a fact cannot disagree with its
-- own metric's definition. Hard-coding `false` here was refused, which is the
-- constraint doing its job.
select i.id, i.period_id, sa.id, m.id, m.basis_year_required, 'Comp Report', 'U', 1234
from public.report_ingestions i, public.salons sa,
     -- A metric that needs NO basis year, so no `basis_year` column is
     -- required: `comp_sales_facts_basis_year_matches_metric` insists the two
     -- agree, and the composite FK above insists the flag matches the metric.
     -- Two guards on one column, both worth leaving intact.
     (select id, basis_year_required from public.report_metrics
       where basis_year_required = false order by code limit 1) m
where i.parser_key='comp_sales_mtd_vs_2024' and sa.salon_number='0901';

-- A BED USAGE delivery on a LATER period, ingested MORE RECENTLY. Before the
-- fix this row won the ordering and became the Comp tab's scope.
insert into public.report_periods (grain, period_end, period_start, fiscal_year, label_raw)
values ('mtd','2026-11-30','2026-11-01',2026,'Bed Usage Report: 11/1/2026 to 11/30/2026')
on conflict (grain, period_end) do nothing;

-- ITS OWN FILE. Reusing `bed.xlsx` would hit
-- `report_ingestions_one_success_key` — one success per (file, parser, version)
-- — and the ingestion would never be created, leaving S3 asserting nothing.
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/bed-nov.xlsx','bed-nov.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('b',64), 'BED-MSG-NOV' from public.report_sources where code='bed_usage_email';

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'bed_usage_monthly', 1, 'succeeded', p.id, repeat('2',64), now()
from public.report_files f, public.report_periods p
where f.original_filename='bed-nov.xlsx' and p.grain='mtd' and p.period_end='2026-11-30';

\echo '--- SP1 the Comp scope view holds ONLY comp_sales ingestions'
select 'SP1' as t,
       coalesce(string_agg(distinct report_family, ','), '(empty)') as families,
       (count(*) filter (where report_family <> 'comp_sales') = 0)::text as pass
from public.comp_sales_report_scope;

\echo '--- SP2 the period the Salon Performance tab opens on is the COMP one'
select 'SP2' as t, parser_key, period_end::text, live_fact_count::text,
       (parser_key like 'comp_sales%' and period_end = '2026-10-31'
        and live_fact_count > 0)::text as pass
from public.comp_sales_report_scope
order by period_end desc, ingested_at desc
limit 1;

\echo '--- SP3 the later Bed Usage period still exists and is still shared'
select 'SP3' as t,
       (select count(*) from public.report_periods where period_end='2026-11-30')::text as period_rows,
       (select count(*) from public.comp_sales_report_scope where period_end='2026-11-30')::text as in_comp_scope,
       (select count(*) from public.report_ingestions i join public.report_periods p on p.id=i.period_id
          where p.period_end='2026-11-30' and i.status='succeeded')::text as bed_ingestions,
       -- The bed ingestion must EXIST and be absent from the comp scope. Without
       -- the first half this passes when nothing was inserted at all.
       ((select count(*) from public.report_periods where period_end='2026-11-30') = 1
        and (select count(*) from public.report_ingestions i join public.report_periods p on p.id=i.period_id
               where p.period_end='2026-11-30' and i.status='succeeded') = 1
        and (select count(*) from public.comp_sales_report_scope where period_end='2026-11-30') = 0)::text as pass;

\echo ''
\echo '=== the browser-held roles hold NO write privilege on any new table ==='
select 'PRIV' as t, table_name, privilege_type, grantee
from information_schema.role_table_grants
where grantee in ('anon','authenticated')
  and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  and table_name in (
    'bed_equipment_levels','spa_equipment_types','bed_usage_snapshots',
    'bed_usage_salon_facts','bed_usage_equipment_facts','bed_usage_chain_benchmarks',
    'spa_wellness_snapshots','spa_wellness_salon_facts','spa_wellness_equipment_facts',
    'spa_equipment_benchmarks','spa_engagement_snapshots','spa_engagement_salon_facts',
    'spa_engagement_manager_facts','spa_bed_inventory','spa_engagement_daily_facts',
    'bed_usage_current_salon_facts','bed_usage_current_equipment_facts',
    'spa_wellness_current_salon_facts','spa_wellness_current_equipment_facts',
    'spa_engagement_current_salon_facts','spa_conversion_current');

\echo '(no rows above = correct)'

\echo '=== every new table has RLS enabled AND forced ==='
select 'RLS' as t, relname, relrowsecurity::text as enabled, relforcerowsecurity::text as forced,
       (relrowsecurity and relforcerowsecurity)::text as pass
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='r'
  and relname in (
    'bed_equipment_levels','spa_equipment_types','bed_usage_snapshots',
    'bed_usage_salon_facts','bed_usage_equipment_facts','bed_usage_chain_benchmarks',
    'spa_wellness_snapshots','spa_wellness_salon_facts','spa_wellness_equipment_facts',
    'spa_equipment_benchmarks','spa_engagement_snapshots','spa_engagement_salon_facts',
    'spa_engagement_manager_facts','spa_bed_inventory','spa_engagement_daily_facts')
order by relname;
