-- Ask Sunny — behavioural checks for the reporting migrations.
--
-- Run against a THROWAWAY LOCAL CLUSTER, never against Supabase. See README.md
-- in this directory for the exact commands.
--
-- Every value below is invented. There is no real salon, figure or period here.
--
-- Steps marked MUST FAIL are expected to print an error: they are the point of
-- the file. A MUST FAIL step that succeeds is a regression in the schema.

\set ON_ERROR_STOP off
\pset pager off

-- seed sanity
select 'metrics seeded' as check, count(*)::text as result from public.report_metrics
union all select 'pct-change linked', count(*)::text from public.report_metrics where comparison_of is not null
union all select 'sources seeded', count(*)::text from public.report_sources
union all select 'bucket private', (public::text) from storage.buckets where id='reporting-sources';

-- fixtures
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id, 'fixture/a.xlsx','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,
       repeat('a',64), 'MSG-1' from public.report_sources where code='comp_report_email';

insert into public.report_periods (grain, period_end, period_start, fiscal_year, label_raw)
values ('mtd','2026-08-30','2026-08-01',2026,'MTD 08/30/2026');

insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'comp_sales_mtd_vs_2024', 1, 'succeeded', p.id, repeat('b',64), now()
from public.report_files f, public.report_periods p;

insert into public.salons (salon_number, store_name) values ('0468','Fictional Store One');

\echo '--- T1 zero-padded salon number survives'
select 'T1' as t, salon_number, (salon_number='0468')::text as pass from public.salons;

\echo '--- T2 fact requiring a basis year, with none  -> MUST FAIL'
insert into public.comp_sales_facts (ingestion_id,salon_id,period_id,metric_id,metric_basis_year_required,basis_year,value,source_sheet,source_column)
select i.id,s.id,p.id,m.id,true,null,100,'CompReport(MTD) vs 2024','U'
from public.report_ingestions i, public.salons s, public.report_periods p, public.report_metrics m where m.code='otc_revenue';

\echo '--- T3 flag disagreeing with the catalogue -> MUST FAIL'
insert into public.comp_sales_facts (ingestion_id,salon_id,period_id,metric_id,metric_basis_year_required,basis_year,value,source_sheet,source_column)
select i.id,s.id,p.id,m.id,false,null,100,'CompReport(MTD) vs 2024','U'
from public.report_ingestions i, public.salons s, public.report_periods p, public.report_metrics m where m.code='otc_revenue';

\echo '--- T4 valid fact -> MUST SUCCEED'
insert into public.comp_sales_facts (ingestion_id,salon_id,period_id,metric_id,metric_basis_year_required,basis_year,value,source_sheet,source_column)
select i.id,s.id,p.id,m.id,true,2026,11469.87,'CompReport(MTD) vs 2024','U'
from public.report_ingestions i, public.salons s, public.report_periods p, public.report_metrics m where m.code='otc_revenue';

\echo '--- T5 duplicate live fact, same salon/period/metric/year -> MUST FAIL'
insert into public.comp_sales_facts (ingestion_id,salon_id,period_id,metric_id,metric_basis_year_required,basis_year,value,source_sheet,source_column)
select i.id,s.id,p.id,m.id,true,2026,99999,'CompReport(MTD) vs 2024','U'
from public.report_ingestions i, public.salons s, public.report_periods p, public.report_metrics m where m.code='otc_revenue';

\echo '--- T6 same metric, DIFFERENT basis year -> MUST SUCCEED'
insert into public.comp_sales_facts (ingestion_id,salon_id,period_id,metric_id,metric_basis_year_required,basis_year,value,source_sheet,source_column)
select i.id,s.id,p.id,m.id,true,2024,10820.55,'CompReport(MTD) vs 2024','V'
from public.report_ingestions i, public.salons s, public.report_periods p, public.report_metrics m where m.code='otc_revenue';

\echo '--- T7 supersede, then re-insert the same key -> MUST SUCCEED'
update public.comp_sales_facts set superseded_by_ingestion_id = (select id from public.report_ingestions)
 where basis_year = 2026;
insert into public.comp_sales_facts (ingestion_id,salon_id,period_id,metric_id,metric_basis_year_required,basis_year,value,source_sheet,source_column)
select i.id,s.id,p.id,m.id,true,2026,11500.00,'CompReport(MTD) vs 2024','U'
from public.report_ingestions i, public.salons s, public.report_periods p, public.report_metrics m where m.code='otc_revenue';
select 'T7' as t, count(*) filter (where superseded_by_ingestion_id is null) as live,
       count(*) filter (where superseded_by_ingestion_id is not null) as superseded,
       count(*) as total from public.comp_sales_facts;

\echo '--- T8 the view hides superseded rows and keeps history in the table'
select 'T8' as t, (select count(*) from public.comp_sales_current_facts) as view_rows,
       (select count(*) from public.comp_sales_facts) as table_rows;

\echo '--- T9 duplicate file sha256 -> MUST FAIL'
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256)
select id,'fixture/b.xlsx','b.xlsx','application/vnd.ms-excel',10,repeat('a',64) from public.report_sources;

\echo '--- T10 same file + parser + version twice -> MUST FAIL'
insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, fingerprint)
select f.id, f.source_id,'comp_sales_mtd_vs_2024',1,repeat('c',64) from public.report_files f limit 1;

\echo '--- T11 same file, NEWER parser version -> MUST SUCCEED'
insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, fingerprint)
select f.id, f.source_id,'comp_sales_mtd_vs_2024',2,repeat('d',64) from public.report_files f limit 1;

\echo '--- T12 succeeded without a period -> MUST FAIL'
insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, fingerprint, finished_at)
select f.id, f.source_id,'comp_sales_mtd_vs_2024',3,'succeeded',repeat('e',64),now() from public.report_files f limit 1;

\echo '--- T13 two files with NULL external_message_id -> MUST SUCCEED (partial unique)'
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256)
select id,'fixture/c.xlsx','c.xlsx','text/csv',10,repeat('1',64) from public.report_sources;
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256)
select id,'fixture/d.xlsx','d.xlsx','text/csv',10,repeat('2',64) from public.report_sources;

\echo '--- T14 duplicate external_message_id on the same source -> MUST FAIL'
insert into public.report_files (source_id, storage_path, original_filename, mime_type, size_bytes, file_sha256, external_message_id)
select id,'fixture/e.xlsx','e.xlsx','text/csv',10,repeat('3',64),'MSG-1' from public.report_sources;

\echo '--- T15 integer-coerced salon number is a DIFFERENT salon (the hazard)'
insert into public.salons (salon_number, store_name) values ('468','Fictional Store One');
select 'T15' as t, count(*) as salon_rows, 'both 0468 and 468 exist -> parser must keep text' as note from public.salons;
