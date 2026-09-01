-- Ask Sunny — scope the metric catalogue to the source sheet, and stop a null
-- basis year reaching the window picker.
--
-- TWO DEFECTS THAT WOULD BOTH HAVE APPEARED THE MOMENT A SECOND SHEET LANDED.
--
-- 1. THE CATALOGUE HAD NO SHEET DIMENSION. It grouped by period, and both MTD
--    sheets describe the same period. So after ingesting the rolling sheet, the
--    `MTD vs 2024` view would have offered `Last 3 Months` in its window picker
--    and the `MTD Rolling` view would have offered `vs 2019` — each view
--    advertising comparisons that belong to the other sheet. Every figure would
--    then read "Unavailable", which is honest but useless: the control should
--    not offer it at all.
--
-- 2. `available_basis_years` COLLECTED NULLS. A trailing-window metric carries
--    `basis_year is null` by design, and `array_agg(distinct null)` yields
--    `{NULL}` rather than an empty array. The read layer iterates that array to
--    discover year comparisons, so a null would have produced a window whose id
--    was literally "null" — an option in the dropdown that could never resolve.
--    `array_remove` is the fix, and the empty array is then the correct answer:
--    a rolling metric has no basis years.
--
-- Both are caught before any rolling fact exists, which is the only comfortable
-- time to fix this kind of thing.

create or replace view public.comp_sales_metric_catalogue
with (security_invoker = true) as
-- `source_sheet` is APPENDED rather than slotted in beside `period_id`, where it
-- belongs logically. `create or replace view` may only add columns at the END of
-- the list; inserting one in the middle is refused, and dropping the view to
-- reorder would drop its grants with it and briefly leave the dashboard reading
-- a view that does not exist. Column order in a view nobody selects by position
-- is not worth that.
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
  -- Nulls removed: a trailing-window metric has NO basis year, and `{}` says
  -- that where `{NULL}` would invent an unusable option.
  coalesce(array_remove(array_agg(distinct c.basis_year), null), '{}') as available_basis_years,
  count(*)::bigint      as fact_count,
  count(distinct c.salon_id)::bigint as salon_count,
  -- The sheet a metric's facts came from, so a view offers only its own
  -- measures. Lineage the ingestion wrote, not a classification invented here.
  c.source_sheet
from public.report_metrics m
join public.comp_sales_facts c
  on c.metric_id = m.id and c.superseded_by_ingestion_id is null
left join public.report_metrics cm on cm.id = m.comparison_of
group by c.period_id, c.source_sheet, m.id, m.code, m.label, m.family, m.unit,
         m.higher_is_better, m.basis_year_required, m.comparison_of, cm.code,
         m.description;

comment on view public.comp_sales_metric_catalogue is
  'Supported metrics joined to what each period AND SOURCE SHEET actually holds, including the basis years available. A trailing-window metric has an empty basis-year array, not a null one. higher_is_better may be null, and a null must not be coloured as good or bad.';

revoke all on public.comp_sales_metric_catalogue from anon, authenticated;
grant select on public.comp_sales_metric_catalogue to authenticated;
