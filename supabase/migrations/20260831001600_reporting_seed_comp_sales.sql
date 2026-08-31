-- Ask Sunny — reference data for the Comp Sales family.
--
-- REFERENCE DATA, NOT BUSINESS DATA. This seeds the controlled vocabulary a
-- parser resolves against; it contains no salon, no figure and nothing from any
-- real report. Every statement is idempotent.
--
-- SCOPE: the metric set of `CompReport(MTD) vs 2024`, the approved first parser
-- target. That sheet is the cleanest in the workbook — 68 columns, no abandoned
-- template block, no formulas in the data band. The month-to-date and
-- year-to-date sheets carry roughly 150 further measures; those are added by
-- later migrations once the business has confirmed which ones are decided on,
-- rather than seeding 150 codes nobody has agreed the meaning of.

insert into public.report_sources (code, name, kind, report_family, notes)
values (
  'comp_report_email',
  'Comp Report (emailed workbook)',
  'email_attachment',
  'comp_sales',
  'Recurring Excel workbook of comparable-store salon performance. Arrives as an Outlook attachment; a recipient copy may be filtered to a subset of salons, so an ingestion must never be treated as company-wide.'
)
on conflict (code) do nothing;

-- Base measures. Each is reported for several baseline years on the same sheet
-- (2026 and 2024 in the first block, 2024 and 2019 in the second), which is why
-- the year lives on the fact rather than in the metric code.
insert into public.report_metrics (code, label, family, unit, higher_is_better, basis_year_required, description)
values
  ('otc_revenue',    'OTC Revenue',    'revenue', 'currency', true, true,
   'Over-the-counter revenue: in-salon, online and customer-service combined.'),
  ('eft_revenue',    'EFT Revenue',    'revenue', 'currency', true, true,
   'Recurring electronic funds transfer (membership draft) revenue.'),
  ('total_revenue',  'Total Revenue',  'revenue', 'currency', true, true,
   'Total salon revenue for the period.'),
  ('uv_tans',        'UV Tans',        'volume',  'count',    true, true,
   'UV tanning sessions.'),
  ('sunless_tans',   'Sunless Tans',   'volume',  'count',    true, true,
   'Sunless (spray) tanning sessions.'),
  ('spa_sessions',   'Spa Sessions',   'volume',  'count',    true, true,
   'Spa equipment sessions.'),
  ('unique_tanners', 'Unique Tanners', 'volume',  'count',    true, true,
   'Distinct clients with at least one session in the period.'),
  ('total_tans',     'Total Tans',     'volume',  'count',    true, true,
   'All sessions: UV, sunless and spa.')
on conflict (code) do nothing;

-- Percentage-change measures, each linked to the metric it is a change in.
--
-- basis_year on a fact for one of these records the year being compared
-- AGAINST: 2024 for "TY vs. 2024 % Change", 2019 for "TY vs. 2019 % Change".
-- Values are stored as fractions, so -0.0299 means -2.99%.
--
-- These are stored rather than recomputed. The workbook computes them from
-- figures it has and this copy may not — trailing windows and chain-wide
-- baselines among them — so recomputing from the two columns present would
-- silently produce a different number from the one the recipient read.
insert into public.report_metrics (code, label, family, unit, higher_is_better, basis_year_required, comparison_of, description)
select
  base.code || '_pct_change',
  base.label || ' % Change',
  base.family,
  'percent'::public.report_metric_unit,
  base.higher_is_better,
  true,
  base.id,
  'Change in ' || base.label || ' against the baseline year named by basis_year, as reported. Stored as a fraction.'
from public.report_metrics base
where base.code in (
  'otc_revenue', 'eft_revenue', 'total_revenue',
  'uv_tans', 'sunless_tans', 'spa_sessions', 'unique_tanners', 'total_tans'
)
on conflict (code) do nothing;
