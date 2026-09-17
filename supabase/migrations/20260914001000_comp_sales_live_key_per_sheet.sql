-- ============================================================================
-- THE LIVE FACT KEY BECOMES PER-SHEET, AS SUPERSESSION ALREADY IS
-- ============================================================================
--
-- WHY. The 14 September review: "The comparison is set to vs. 2024, not 2025."
--
-- The source publishes that comparison on `CompReport(MTD)` — `Est. 2026 Total
-- Revenue` / `2025 Total Revenue` / `TY vs. 2025 % Change` — while the sheet the
-- dashboard's year comparisons came from, `CompReport(MTD) vs 2024`, carries no
-- 2025 column at all. Reading the 2025 block therefore means one workbook's two
-- month-to-date sheets both reporting Total Revenue for 2026, for the same salon
-- and the same period, from two different columns.
--
-- The live key forbade that:
--
--   (salon_id, period_id, metric_id, coalesce(basis_year, -1))
--
-- WHAT THAT KEY WAS PROTECTING, and what it over-reached on. Its note reads: "At
-- most one LIVE fact per salon, period, metric and baseline year. A second report
-- for a period already loaded therefore cannot silently double the numbers."
-- That is the right guarantee for a RE-INGESTION, and it is still enforced —
-- re-loading a sheet still has to supersede its own previous rows first.
--
-- But the key was written before sheets were independent slices, and
-- `20260831002000_reporting_supersession_scope.sql` made them so:
--
--     -- ...AND, FOR FACTS, TO THE SHEETS THIS REPORT READ.
--     -- Without this clause, ingesting one sheet of a workbook retires every
--     -- fact another sheet of the same workbook contributed for the same
--     -- salons and period.
--
-- So since that migration, supersession says "a sheet is a slice and other
-- sheets are none of its business" while this index said "one fact per metric
-- and year across every sheet". The two only avoided contradicting each other
-- because the sheets' metric sets happened to be disjoint — a coincidence the
-- ingest suite asserts as if it were a design, and which the 2025 comparison is
-- the first thing to break. An ingestion would have failed on a unique
-- violation, which is a loud failure and still the wrong one: nothing is
-- actually ambiguous about two sheets each reporting their own figure.
--
-- WHAT STAYS TRUE AFTERWARDS. At most one live fact per salon, period, metric,
-- baseline year AND SHEET. Every read is already scoped to one sheet — the
-- dashboard passes the selected window's sheet to `getFactRows`, the salon
-- drill-down filters to `activeSheet` before indexing, and the window
-- comparison section filters to each window's own sheet — so no surface can see
-- two rows where it expects one. `comp_sales_metric_catalogue` already groups
-- by `source_sheet`, so the View control keeps advertising only what its own
-- sheet holds.
--
-- coalesce() on both nullable members, because a unique index treats nulls as
-- distinct and two rows with no baseline year are the same fact, not two.
-- `source_sheet` is `not null` with a not-blank check, so it needs no coalesce.

drop index if exists public.comp_sales_facts_live_key;

create unique index comp_sales_facts_live_key
  on public.comp_sales_facts
     (salon_id, period_id, metric_id, coalesce(basis_year, -1), source_sheet)
  where superseded_by_ingestion_id is null;

comment on index public.comp_sales_facts_live_key is
  'One live fact per salon, period, metric, baseline year and source sheet. '
  'Sheet is part of the key because supersession is scoped to the sheets a '
  'report read, so two sheets of one workbook are independent slices that may '
  'each report the same measure.';

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
--
-- Index work only, so the reverse is index work only — no row is touched in
-- either direction and no data has to be recovered.
--
--   drop index if exists public.comp_sales_facts_live_key;
--
--   create unique index comp_sales_facts_live_key
--     on public.comp_sales_facts
--        (salon_id, period_id, metric_id, coalesce(basis_year, -1))
--     where superseded_by_ingestion_id is null;
--
-- ONE PRECONDITION, and it is the whole risk of rolling back. The narrower key
-- cannot be rebuilt once two sheets hold the same measure for one salon, period
-- and baseline year — which is exactly what this migration exists to allow, and
-- what re-ingesting `CompReport(MTD)` will create. Check before rolling back:
--
--   select salon_id, period_id, metric_id, coalesce(basis_year, -1) as by_key,
--          count(*) as rows, array_agg(source_sheet) as sheets
--     from public.comp_sales_facts
--    where superseded_by_ingestion_id is null
--    group by 1, 2, 3, 4
--   having count(*) > 1;
--
-- Any row returned names a collision the old key forbids. Supersede one side
-- (stamp `superseded_by_ingestion_id`) rather than deleting it — this schema
-- never deletes a fact — and the old index will then build.
