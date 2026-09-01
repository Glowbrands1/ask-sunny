-- Ask Sunny — the dashboard read surface.
--
-- Three views, all `security_invoker`, so row level security applies to the
-- CALLER rather than to the migration role that owns them. The reasoning is the
-- same as for comp_sales_current_facts and it is load-bearing: the owner holds
-- BYPASSRLS on Supabase, so a non-invoker view here would read every row
-- beneath it and hand the result to anyone who could select from the view.
--
-- WHY VIEWS AND NOT QUERIES IN THE APPLICATION.
--
-- Each one answers a question the dashboard asks on every page load, and each
-- encodes a rule that must not be restated in TypeScript and allowed to drift:
--
--   * the scope sentence's numbers are COUNTED FROM THE FACTS, not read from a
--     summary column, so the banner cannot claim 15 salons while the charts
--     show 14;
--   * filter options are the values actually present in the period, so a filter
--     can never offer a district that would return nothing;
--   * a metric's available basis years are derived from the facts, so
--     `spa_sessions` simply has no 2019 entry rather than needing a special
--     case in the UI.
--
-- DEFAULT PRIVILEGES. Supabase ships `alter default privileges ... grant all on
-- tables to anon, authenticated`, and a VIEW is a table for that purpose. This
-- project has already been bitten twice by it, so every view below is REVOKED
-- from both browser roles before anything is granted back.

-- ---------------------------------------------------------------------------
-- 1. Scope and provenance for one ingested report.
--
-- Drives the scope banner and the "Data source & quality" panel. One row per
-- SUCCEEDED ingestion; a period re-ingested later yields a second row, so a
-- caller wanting "the current report" orders by ingested_at desc and takes one.

create or replace view public.comp_sales_report_scope
with (security_invoker = true) as
select
  i.id                        as ingestion_id,
  i.period_id,
  p.grain,
  p.period_start,
  p.period_end,
  p.label_raw                 as period_label,
  p.fiscal_year,
  i.parser_key,
  i.parser_version,
  i.started_at,
  i.finished_at               as ingested_at,
  i.warnings,
  coalesce(array_length(i.warnings, 1), 0) as warning_count,
  i.source_sheet_names,
  -- Counts recorded by the ingestion itself.
  i.fact_count                as recorded_fact_count,
  i.salon_count               as recorded_salon_count,
  -- Counts derived from the LIVE facts. The banner uses these, so its sentence
  -- is a measurement rather than a claim.
  (select count(distinct c.salon_id)
     from public.comp_sales_facts c
    where c.period_id = p.id and c.superseded_by_ingestion_id is null) as live_salon_count,
  (select count(*)
     from public.comp_sales_facts c
    where c.period_id = p.id and c.superseded_by_ingestion_id is null) as live_fact_count,
  (select count(distinct c.metric_id)
     from public.comp_sales_facts c
    where c.period_id = p.id and c.superseded_by_ingestion_id is null) as live_metric_count,
  -- Lineage. The bucket and path are recorded, never a public URL: downloads
  -- are short-lived signed URLs minted server-side.
  f.id                        as file_id,
  f.original_filename,
  f.file_sha256,
  f.storage_bucket,
  f.storage_path,
  f.size_bytes,
  f.received_at,
  s.code                      as source_code,
  s.name                      as source_name,
  s.kind                      as source_kind,
  s.report_family
from public.report_ingestions i
join public.report_periods p on p.id = i.period_id
join public.report_files   f on f.id = i.file_id
join public.report_sources s on s.id = i.source_id
where i.status = 'succeeded';

comment on view public.comp_sales_report_scope is
  'Scope, freshness and lineage for each succeeded comp sales ingestion. Salon/fact/metric counts are derived from the live facts so the scope banner cannot drift from what the charts show.';

-- ---------------------------------------------------------------------------
-- 2. Filter options, as a facet table.
--
-- One row per (period, facet, value) with the number of salons behind it. Only
-- values PRESENT in the period appear, so a filter cannot offer an option that
-- returns nothing.
--
-- `district` and `region` hold a MANAGER'S PERSONAL NAME in this source. They
-- are period-scoped descriptive labels and never an identity, which is why the
-- facet is keyed on the label itself and carries no id.

create or replace view public.comp_sales_filter_options
with (security_invoker = true) as
with live as (
  select a.*
  from public.salon_period_attributes a
  where a.superseded_by_ingestion_id is null
)
select period_id, 'district'::text as facet, district_label as value, count(*)::bigint as salon_count
  from live where district_label is not null group by period_id, district_label
union all
select period_id, 'region', region_label, count(*)::bigint
  from live where region_label is not null group by period_id, region_label
union all
select period_id, 'company', company, count(*)::bigint
  from live where company is not null group by period_id, company
union all
select period_id, 'ownership_group', ownership_group, count(*)::bigint
  from live where ownership_group is not null group by period_id, ownership_group
union all
select period_id, 'dma', dma, count(*)::bigint
  from live where dma is not null group by period_id, dma
union all
select period_id, 'quintile_group', quintile_group, count(*)::bigint
  from live where quintile_group is not null group by period_id, quintile_group
union all
select period_id, 'pricing_plan', pricing_plan, count(*)::bigint
  from live where pricing_plan is not null group by period_id, pricing_plan
union all
select period_id, 'market_consolidation', market_consolidation, count(*)::bigint
  from live where market_consolidation is not null group by period_id, market_consolidation
union all
select period_id, 'comp_salon', case when is_comp_salon then 'true' else 'false' end, count(*)::bigint
  from live where is_comp_salon is not null group by period_id, is_comp_salon;

comment on view public.comp_sales_filter_options is
  'Facet values actually present in each period, with salon counts. District and region are manager names as reported - descriptive labels, never identities.';

-- ---------------------------------------------------------------------------
-- 3. The metric catalogue, as the dashboard needs it.
--
-- The reviewed vocabulary joined to what the period actually contains. A metric
-- with no facts in a period does not appear; `available_basis_years` is why the
-- UI needs no special case for spa sessions having no 2019 baseline.

create or replace view public.comp_sales_metric_catalogue
with (security_invoker = true) as
select
  c.period_id,
  m.id                  as metric_id,
  m.code,
  m.label,
  m.family,
  m.unit,
  m.higher_is_better,
  m.basis_year_required,
  m.comparison_of,
  cm.code               as comparison_of_code,
  m.description,
  array_agg(distinct c.basis_year order by c.basis_year) as available_basis_years,
  count(*)::bigint      as fact_count,
  count(distinct c.salon_id)::bigint as salon_count
from public.report_metrics m
join public.comp_sales_facts c
  on c.metric_id = m.id and c.superseded_by_ingestion_id is null
left join public.report_metrics cm on cm.id = m.comparison_of
group by c.period_id, m.id, m.code, m.label, m.family, m.unit, m.higher_is_better,
         m.basis_year_required, m.comparison_of, cm.code, m.description;

comment on view public.comp_sales_metric_catalogue is
  'Supported metrics joined to what each period actually holds, including the basis years available. higher_is_better may be null, and a null must not be coloured as good or bad.';

-- ---------------------------------------------------------------------------
-- PRIVILEGES. Revoke the default grants first, then hand back read-only.

revoke all on public.comp_sales_report_scope     from anon, authenticated;
revoke all on public.comp_sales_filter_options   from anon, authenticated;
revoke all on public.comp_sales_metric_catalogue from anon, authenticated;

grant select on public.comp_sales_report_scope     to authenticated;
grant select on public.comp_sales_filter_options   to authenticated;
grant select on public.comp_sales_metric_catalogue to authenticated;
