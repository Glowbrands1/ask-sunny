-- Ask Sunny — rolling-window measures, and the source-view catalogue.
--
-- REFERENCE DATA AND ONE VIEW. No salon, no figure, nothing from any real
-- report. Every statement is idempotent.
--
-- WHY THESE METRICS EXIST SEPARATELY FROM THE YEAR-COMPARISON ONES.
--
-- The workbook's `CompReport(MTD)` sheet carries trailing-window comparisons the
-- SOURCE calculated: "Current Yr Last 3 mos. Revenue", "Prior Yr Last 3 mos.
-- Revenue", "Last 3 Months % Change", and the same for 6, 9 and 12 months, for
-- Revenue and for Total Tans.
--
-- A trailing window is NOT a basis year, so these carry
-- `basis_year_required = false` and the window lives in the metric code —
-- exactly the case report_metrics documents ("relative measures whose window is
-- part of the code itself"). A fact for `total_revenue_last_3m_current` has
-- basis_year null, and the database's own check constraint enforces that.
--
-- AND A TRAILING WINDOW IS NOT A HISTORY. "Last 12 Months % Change" is one
-- number per salon that the source computed. It is not twelve stored monthly
-- reports, it cannot be plotted as a path, and nothing here may be used to
-- imply one. That distinction is carried through the read layer in
-- `read/windows.ts` and is the reason this file does not create period rows.
--
-- WHY `Revenue` HERE MEANS TOTAL REVENUE.
--
-- The source headers say plain "Revenue", which is ambiguous — OTC, EFT and
-- Total are all revenue on that sheet. The workbook is a values-only export
-- with no formulas to read, so the mapping was settled structurally instead,
-- against the Total Tans columns as a control (their headers name the measure
-- explicitly):
--
--   rolling / MTD figure      last 3 mo      last 12 mo
--   Total Tans (control)          3.80          15.39
--   Revenue vs Total Revenue      4.01          14.67
--   Revenue vs OTC Revenue       10.42          36.88
--   Revenue vs EFT Revenue        6.38          22.98
--
-- The revenue ratios match the labelled control's shape; OTC and EFT are three
-- to four times out. The reported change also reconciles exactly with its own
-- pair — |(current / prior - 1) - reported| is 8e-17 across all fifteen salons —
-- so the triple is internally consistent. Hence `total_revenue_last_*`.

-- ---------------------------------------------------------------------------
-- 1. The rolling measures.
--
-- Generated from a cross join rather than written out 24 times: the naming
-- convention is mechanical, and the read layer resolves codes by building the
-- same strings (`<measure>_last_<n>m_<side>`). Two places composing one
-- convention by hand is how they drift.

insert into public.report_metrics (code, label, family, unit, higher_is_better, basis_year_required, description)
select
  format('%s_last_%sm_%s', measure.code, win.months, side.suffix),
  format('%s, %s last %s months', measure.label, side.label, win.months),
  measure.family,
  measure.unit,
  true,
  -- The window IS the period. A basis year here would be meaningless.
  false,
  format(
    '%s over the trailing %s months as reported by the source, for the %s. Not derived from stored periods.',
    measure.label, win.months, side.label
  )
from (values
  ('total_revenue', 'Total Revenue', 'revenue', 'currency'::public.report_metric_unit),
  ('total_tans',    'Total Tans',    'volume',  'count'::public.report_metric_unit)
) as measure (code, label, family, unit)
cross join (values (3), (6), (9), (12)) as win (months)
cross join (values
  ('current', 'current year'),
  ('prior',   'prior year')
) as side (suffix, label)
on conflict (code) do nothing;

-- The change measure for each window, linked to the base measure it changes.
--
-- Stored, never recomputed here: the source states it, and its own pair
-- reconciles with it exactly, so recomputing would only introduce a way for the
-- two to disagree.
insert into public.report_metrics (code, label, family, unit, higher_is_better, basis_year_required, comparison_of, description)
select
  format('%s_last_%sm_pct_change', measure.code, win.months),
  format('Last %s Months %% Change, %s', win.months, measure.label),
  measure.family,
  'percent',
  true,
  false,
  base.id,
  format(
    'Change in %s over the trailing %s months against the same window a year earlier, as reported by the source. A fraction: -0.0299 is -2.99%%.',
    measure.label, win.months
  )
from (values
  ('total_revenue', 'Total Revenue', 'revenue'),
  ('total_tans',    'Total Tans',    'volume')
) as measure (code, label, family)
cross join (values (3), (6), (9), (12)) as win (months)
join public.report_metrics base on base.code = measure.code
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The source-view catalogue.
--
-- Drives the manager-facing "View" selector, and it is derived rather than
-- declared: a view is offered because facts in the database came from that
-- sheet. One row per (period, grain, source sheet) that carries live facts.
--
-- This is what stops the selector from being a list of intentions. The workbook
-- has three sheets; only the ones actually ingested can be selected, and the day
-- another is ingested it appears with no code change.
--
-- `security_invoker = true` for the same load-bearing reason as every other view
-- here: the owner holds BYPASSRLS on Supabase, so a non-invoker view would read
-- every row beneath it and hand the result to anyone who could select from it.

create or replace view public.comp_sales_source_views
with (security_invoker = true) as
select
  f.period_id,
  p.grain,
  p.period_end,
  f.source_sheet,
  i.parser_key,
  max(i.parser_version)              as parser_version,
  count(*)::bigint                   as fact_count,
  count(distinct f.salon_id)::bigint as salon_count,
  count(distinct f.metric_id)::bigint as metric_count,
  max(i.finished_at)                 as ingested_at
from public.comp_sales_facts f
join public.report_periods p    on p.id = f.period_id
join public.report_ingestions i on i.id = f.ingestion_id
where f.superseded_by_ingestion_id is null
group by f.period_id, p.grain, p.period_end, f.source_sheet, i.parser_key;

comment on view public.comp_sales_source_views is
  'Which source sheet each period''s live facts came from, with counts. Drives the manager-facing View selector: a view can only be offered if facts from that sheet exist.';

-- ---------------------------------------------------------------------------
-- PRIVILEGES. Supabase ships `alter default privileges ... grant all on tables
-- to anon, authenticated`, and a VIEW counts as a table for that purpose. This
-- project has been bitten by it before, so revoke first, then grant read-only.

revoke all on public.comp_sales_source_views from anon, authenticated;
grant select on public.comp_sales_source_views to authenticated;
