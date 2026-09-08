-- ---------------------------------------------------------------------------
-- `comp_sales_report_scope` MUST RETURN ONLY THE COMP REPORT'S INGESTIONS.
--
-- THE REGRESSION THIS FIXES. Salon Performance showed "This period holds no
-- comparisons yet" for a period whose Comp Report had been displaying
-- correctly. No Comp data changed: `mtd 2026-08-31` still holds 922 live facts
-- across 40 metrics.
--
-- The page resolves its period with, in effect,
--
--     select * from comp_sales_report_scope
--     order by period_end desc, ingested_at desc limit 1
--
-- and this view — named for the Comp Report, and the only thing that decides
-- which period the Comp tab opens on — filtered on nothing but
-- `i.status = 'succeeded'`. It returned EVERY family's successful ingestion.
--
-- So when the Spa Engagement report was ingested for 1 September 2026, that
-- became the newest row, the page selected it as the Comp Report's scope, and
-- `getMetricCatalogue` found no Comp metrics for it. No metrics means no
-- comparison windows, and no comparison windows is exactly the message the
-- screen showed.
--
-- WHY IT WAS INVISIBLE UNTIL NOW, which is the part worth recording. The view
-- has been mis-scoped since it was written, but Sales Totals — the only other
-- family — records `period_id = NULL` on its ingestions (0 of 6), so the
-- INNER JOIN to `report_periods` silently excluded it. The Bed Usage and Spa
-- reports are the first non-Comp family to record a period, and therefore the
-- first ever to enter this view. A latent defect, exposed rather than created
-- by them.
--
-- THE PREDICATE IS ON THE SOURCE'S DECLARED FAMILY, not on a parser-key
-- prefix. `report_sources.report_family` is the dimension that already answers
-- "which report is this", and `DEFAULT_SOURCE_CODE` — what an unlisted
-- workbook is filed under when the digest allowlist is not enforcing — is
-- `comp_report_email`, whose family is `comp_sales`. So no Comp delivery can
-- be filed outside the filter.
--
-- NOTHING ELSE CHANGES. Same columns in the same order, same
-- `security_invoker = true`, same grants. No fact row, ingestion row, period
-- row or file row is read, written, moved or deleted. Periods stay SHARED
-- across families, which is what Spa Conversion Rate depends on — what changes
-- is only that a period is offered to the Comp tab when the COMP REPORT has
-- data there.
-- ---------------------------------------------------------------------------

create or replace view public.comp_sales_report_scope
with (security_invoker = true) as
select
  i.id           as ingestion_id,
  i.period_id,
  p.grain,
  p.period_start,
  p.period_end,
  p.label_raw    as period_label,
  p.fiscal_year,
  i.parser_key,
  i.parser_version,
  i.started_at,
  i.finished_at  as ingested_at,
  i.warnings,
  coalesce(array_length(i.warnings, 1), 0) as warning_count,
  i.source_sheet_names,
  i.fact_count   as recorded_fact_count,
  i.salon_count  as recorded_salon_count,
  (select count(distinct c.salon_id) from public.comp_sales_facts c
     where c.period_id = p.id and c.superseded_by_ingestion_id is null) as live_salon_count,
  (select count(*) from public.comp_sales_facts c
     where c.period_id = p.id and c.superseded_by_ingestion_id is null) as live_fact_count,
  (select count(distinct c.metric_id) from public.comp_sales_facts c
     where c.period_id = p.id and c.superseded_by_ingestion_id is null) as live_metric_count,
  f.id           as file_id,
  f.original_filename,
  f.file_sha256,
  f.storage_bucket,
  f.storage_path,
  f.size_bytes,
  f.received_at,
  s.code         as source_code,
  s.name         as source_name,
  s.kind         as source_kind,
  s.report_family
from public.report_ingestions i
join public.report_periods p on p.id = i.period_id
join public.report_files f   on f.id = i.file_id
join public.report_sources s on s.id = i.source_id
where i.status = 'succeeded'::public.report_ingestion_status
  -- THE COMP REPORT'S OWN INGESTIONS, AND NOTHING ELSE. See the header: without
  -- this, another family's period becomes the period the Comp tab opens on.
  and s.report_family = 'comp_sales';

comment on view public.comp_sales_report_scope is
  'One row per SUCCEEDED COMP REPORT ingestion, with its period, lineage and live fact counts. Scoped to report_family = comp_sales: report_periods rows are shared between families, and without the filter another family''s newest ingestion becomes the period the Salon Performance tab opens on.';

grant select on public.comp_sales_report_scope to authenticated;
