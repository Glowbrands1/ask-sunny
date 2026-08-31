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

\echo '--- T10 a second ATTEMPT on the same file/parser/version -> MUST SUCCEED'
-- Attempts are unconstrained on purpose; only SUCCESS is unique. A blanket
-- unique here would make a failed parse permanently unretryable except by
-- deleting or overwriting the record of why it failed. See T20/T21.
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

-- ===========================================================================
-- VIEW SECURITY REGRESSION
--
-- The hazard: a PostgreSQL view runs with its OWNER's privileges and RLS
-- context unless `security_invoker = true` is set. The migration role holds
-- BYPASSRLS on Supabase, so a non-invoker view would read every row beneath it
-- and hand the result to anyone who could select from the view — defeating row
-- level security on all eight tables at once.
--
-- The probe below is granted SELECT on the view AND on every base table, and is
-- named by no policy. Under security_invoker it must read ZERO rows. Remove the
-- setting from the migration and it reads everything, which is the regression
-- this check exists to catch.
-- ===========================================================================

\echo '--- T16 a role with grants but no policy reads nothing through the view'
do $$ begin if not exists (select 1 from pg_roles where rolname='rls_probe')
  then create role rls_probe nologin; end if; end $$;

grant select on public.comp_sales_current_facts to rls_probe;
grant select on public.comp_sales_facts        to rls_probe;
grant select on public.salons                  to rls_probe;
grant select on public.report_periods          to rls_probe;
grant select on public.report_metrics          to rls_probe;
grant select on public.salon_period_attributes to rls_probe;

set role rls_probe;
select 'T16 view'  as t, count(*) as rows_visible, 'MUST be 0' as expected
  from public.comp_sales_current_facts;
select 'T16 table' as t, count(*) as rows_visible, 'MUST be 0' as expected
  from public.comp_sales_facts;
reset role;

-- And the control: the same query as a role that IS named by a policy.
set role authenticated;
select 'T17 authenticated' as t, count(*) as rows_visible, 'MUST be > 0' as expected
  from public.comp_sales_current_facts;
reset role;

\echo '--- T18 the view exposes no column the base tables do not'
select 'T18' as t, count(*) as writable_columns, 'MUST be 0' as expected
from information_schema.column_privileges
where table_name = 'comp_sales_current_facts'
  and privilege_type in ('INSERT','UPDATE','DELETE')
  and grantee in ('anon','authenticated','rls_probe');

\echo '--- T19 no storage.objects policy was created by these migrations'
select 'T19' as t, count(*) as storage_policies, 'MUST be 0' as expected
from pg_policies where schemaname = 'storage' and tablename = 'objects';

\echo '--- T20 failed parse can be retried; at most one attempt may succeed'
-- A second FAILED attempt on the same file/parser/version -> MUST SUCCEED
insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, fingerprint, failure_reason, finished_at)
select f.id, f.source_id, 'comp_sales_mtd_vs_2024', 9, 'failed', repeat('7',64), 'fictional parse failure', now()
from public.report_files f limit 1;
insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, fingerprint, failure_reason, finished_at)
select f.id, f.source_id, 'comp_sales_mtd_vs_2024', 9, 'failed', repeat('8',64), 'fictional parse failure, second attempt', now()
from public.report_files f limit 1;
-- Then a SUCCESS on the same file/parser/version -> MUST SUCCEED
insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'comp_sales_mtd_vs_2024', 9, 'succeeded', p.id, repeat('9',64), now()
from public.report_files f, public.report_periods p limit 1;
select 'T20' as t,
       count(*) filter (where status='failed')    as failed_attempts_kept,
       count(*) filter (where status='succeeded') as successes
from public.report_ingestions where parser_version = 9;

\echo '--- T21 a SECOND success on the same file/parser/version -> MUST FAIL'
insert into public.report_ingestions (file_id, source_id, parser_key, parser_version, status, period_id, fingerprint, finished_at)
select f.id, f.source_id, 'comp_sales_mtd_vs_2024', 9, 'succeeded', p.id, repeat('0',64), now()
from public.report_files f, public.report_periods p limit 1;

\echo '--- T22 PROOF that T16 is not vacuous: drop security_invoker and re-probe'
--
-- Recreates the view WITHOUT security_invoker, so it runs with its owner's
-- privileges and RLS context. The probe role should then see rows through the
-- view that it cannot see through the table underneath — which is precisely the
-- bypass security_invoker exists to prevent.
--
-- Observed: 2 rows via the view, 0 rows via the table. Restored immediately
-- afterwards; this step mutates only the throwaway local database.
drop view public.comp_sales_current_facts;
create view public.comp_sales_current_facts as
select f.id as fact_id, s.salon_number, f.value
from public.comp_sales_facts f join public.salons s on s.id = f.salon_id
where f.superseded_by_ingestion_id is null;
grant select on public.comp_sales_current_facts to rls_probe;

set role rls_probe;
select 'T22 view (no invoker)'  as t, count(*) as rows_visible, 'demonstrates the bypass' as note
  from public.comp_sales_current_facts;
select 'T22 table'              as t, count(*) as rows_visible, 'MUST be 0'               as note
  from public.comp_sales_facts;
reset role;

\echo '--- T22 the same view WITH security_invoker -> probe must see nothing again'
drop view public.comp_sales_current_facts;
create view public.comp_sales_current_facts with (security_invoker = true) as
select f.id as fact_id, s.salon_number, f.value
from public.comp_sales_facts f join public.salons s on s.id = f.salon_id
where f.superseded_by_ingestion_id is null;
grant select on public.comp_sales_current_facts to rls_probe;

set role rls_probe;
select 'T22 view (invoker restored)' as t, count(*) as rows_visible, 'MUST be 0' as note
  from public.comp_sales_current_facts;
reset role;

-- NOTE: this database is now disposable. T22 replaced the real view with a
-- three-column stand-in to isolate the security setting. Drop the database and
-- re-apply the migrations before running any further checks against it.
