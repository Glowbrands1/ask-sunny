-- Ask Sunny — the Comp Sales fact model.
--
-- ONE CONTROLLED FACT TABLE PER REPORT FAMILY. This is the Comp Report's.
-- KPI, Personal Bonus and Salon Bonus each get their own, reusing salons,
-- salon_period_attributes, report_periods, report_metrics and the whole lineage
-- chain unchanged. There is deliberately no single generic facts table shared
-- by every report type: it would have no way to say what a row means and no
-- place to put family-specific columns.
--
-- Why narrow (metric-per-row) rather than a wide column-per-measure table:
--
--   * The source carries roughly 150 measures, and its column headers roll
--     forward every January ("2026 / 2025" becomes "2027 / 2026"). A wide table
--     needs a migration and a rename every year, and again for every new report
--     type.
--   * Measures come and go between template revisions. A missing measure is an
--     absent row here; in a wide table it is a null that cannot be told apart
--     from a genuine zero.
--
-- What stops that becoming an unstructured bag: metric_id is a FOREIGN KEY into
-- a reviewed vocabulary, not free text, and the composite key below means the
-- database itself refuses a fact whose year is missing when the metric needs
-- one.

create table public.comp_sales_facts (
  id uuid primary key default extensions.gen_random_uuid(),

  ingestion_id uuid not null references public.report_ingestions (id),
  salon_id     uuid not null references public.salons (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id) on delete cascade,

  metric_id uuid not null,

  -- Denormalised copy of report_metrics.basis_year_required, carried ONLY so
  -- the composite foreign key and the check below can enforce, declaratively,
  -- that a metric requiring a year always has one. It cannot drift: the foreign
  -- key targets (id, basis_year_required) together, so a row whose flag
  -- disagrees with the catalogue has no parent to point at.
  metric_basis_year_required boolean not null,

  -- The calendar year this figure describes. For a "% change" metric it is the
  -- year being compared AGAINST — 2024 for "TY vs. 2024 % Change" — so a single
  -- metric code covers every baseline the report offers without inventing a
  -- metric per year.
  basis_year integer,

  -- numeric, never double precision. These are money and counts that get summed
  -- and compared for equality; binary floating point is the wrong type for both.
  -- Percentages are stored as FRACTIONS: -0.0299 means -2.99%, matching the
  -- source and avoiding a scale convention that has to be remembered.
  value numeric not null,

  -- Cell-level lineage. Which sheet and which spreadsheet column this figure
  -- was read from, so "where did this number come from" resolves all the way to
  -- a cell rather than only to a file.
  source_sheet  text not null,
  source_column text not null,

  -- CORRECTIONS SUPERSEDE, THEY NEVER OVERWRITE.
  --
  -- When a restated report arrives for a period already loaded, existing rows
  -- are stamped with the new ingestion's id and the new rows are inserted
  -- beside them. Nothing is updated in place and nothing is deleted, so an
  -- audit can still ask what the report said when it FIRST arrived and what
  -- changed afterwards. Reads filter on this being null.
  superseded_by_ingestion_id uuid references public.report_ingestions (id),

  created_at timestamptz not null default now(),

  constraint comp_sales_facts_metric_fkey
    foreign key (metric_id, metric_basis_year_required)
    references public.report_metrics (id, basis_year_required),

  constraint comp_sales_facts_basis_year_matches_metric
    check (metric_basis_year_required = (basis_year is not null)),
  constraint comp_sales_facts_basis_year_plausible
    check (basis_year is null or basis_year between 1990 and 2100),
  constraint comp_sales_facts_source_sheet_not_blank
    check (btrim(source_sheet) <> ''),
  constraint comp_sales_facts_source_column_format
    check (source_column ~ '^[A-Z]{1,3}$')
);

-- THE BUSINESS KEY — idempotency layer 3.
--
-- At most one LIVE fact per salon, period, metric and baseline year. A second
-- report for a period already loaded therefore cannot silently double the
-- numbers: the repository must supersede the existing rows first, which is
-- precisely the behaviour this index forces.
--
-- coalesce() because a unique index treats nulls as distinct, and two rows with
-- no baseline year are the same fact, not two.
create unique index comp_sales_facts_live_key
  on public.comp_sales_facts (salon_id, period_id, metric_id, coalesce(basis_year, -1))
  where superseded_by_ingestion_id is null;

-- "This metric across every salon in a period" — the ranking and movers reads.
create index comp_sales_facts_period_metric_idx
  on public.comp_sales_facts (period_id, metric_id, basis_year)
  where superseded_by_ingestion_id is null;

-- "Everything about this salon in this period" — the drill-down read.
create index comp_sales_facts_salon_period_idx
  on public.comp_sales_facts (salon_id, period_id)
  where superseded_by_ingestion_id is null;

-- Supersession and rollback both work by ingestion.
create index comp_sales_facts_ingestion_idx
  on public.comp_sales_facts (ingestion_id);

create index comp_sales_facts_superseded_idx
  on public.comp_sales_facts (superseded_by_ingestion_id)
  where superseded_by_ingestion_id is not null;

comment on table public.comp_sales_facts is
  'Comparable-store sales facts: one row per salon, period, metric and baseline year. Not compensation or payroll.';
comment on column public.comp_sales_facts.value is
  'numeric. Percentages are fractions: -0.0299 is -2.99%.';
comment on column public.comp_sales_facts.superseded_by_ingestion_id is
  'Null for live rows. Set when a later ingestion restates this period; the original row is kept.';

-- ---------------------------------------------------------------------------
-- The read surface.
--
-- A view rather than a materialized projection: at the observed data volume a
-- join across four small tables is cheap, and a view cannot go stale or need a
-- rebuild step after every ingestion. `security_invoker` makes row level
-- security apply to the CALLER rather than to the view's owner — the same
-- reason match_knowledge_chunks is declared `security invoker`.
--
-- Deliberately not a hand-picked list of "headline" metrics: which measures
-- matter to the business is still an open question, and baking an unconfirmed
-- answer into the schema would be the wrong kind of commitment.

create view public.comp_sales_current_facts
with (security_invoker = true) as
select
  f.id                as fact_id,
  f.ingestion_id,
  s.id                as salon_id,
  s.salon_number,
  s.store_name,
  p.id                as period_id,
  p.grain,
  p.period_start,
  p.period_end,
  p.label_raw         as period_label,
  m.code              as metric_code,
  m.label             as metric_label,
  m.family            as metric_family,
  m.unit              as metric_unit,
  m.higher_is_better,
  f.basis_year,
  f.value,
  f.source_sheet,
  f.source_column,
  a.district_label,
  a.region_label,
  a.ownership_group,
  a.dma,
  a.quintile_group,
  a.is_comp_salon
from public.comp_sales_facts f
join public.salons          s on s.id = f.salon_id
join public.report_periods  p on p.id = f.period_id
join public.report_metrics  m on m.id = f.metric_id
left join public.salon_period_attributes a
  on a.salon_id = f.salon_id
 and a.period_id = f.period_id
 and a.superseded_by_ingestion_id is null
where f.superseded_by_ingestion_id is null;

comment on view public.comp_sales_current_facts is
  'Live comp sales facts joined to salon, period, metric and the period''s reported attributes. Superseded rows are excluded. security_invoker, so row level security applies to the caller.';
