-- ---------------------------------------------------------------------------
-- SPA ENGAGEMENT FACTS — `Spa Sessions per Unique Tanner per Spa Bed`.
--
-- THE SCHEMA'S JOB HERE IS TO KEEP TWO SIMILARLY-NAMED METRICS APART.
--
--   Spa Per Unique %                            sessions / unique tanners
--   Spa Sessions per Unique Tanner per Spa Bed  sessions / unique / beds
--
-- The first is the store-execution measure Madeline supplied; the second is the
-- workbook's own bed-normalized figure and what the file is named after. For
-- NE Grand Island on 1 September 2026 they are 44.6% and 0.1115 — a factor of
-- four apart, because the salon has four beds. Storing one under the other's
-- name changes an approved business definition.
--
-- SO NEITHER IS STORED AS A DERIVED COLUMN. Only the four RAW counts are:
-- sessions, unique tanners, unique spa tanners and beds. Every ratio is
-- computed from them at read time, from a named function whose name is the
-- metric's name. A stored `spa_per_unique` column would be a place for the
-- wrong numerator to end up, and a stored ratio cannot be re-aggregated: fifteen
-- salons' Spa Per Unique % must be recomputed from the sums, not averaged.
--
-- THE RANKS ARE THE SOURCE'S OWN, OVER THE WHOLE CHAIN, AND ARE STORED AS
-- PUBLISHED. Rank 7 of 248 is what a manager is being measured on, so it is a
-- fact about them rather than something to recompute over the fifteen salons in
-- view. The weights and the population size are stored beside them, because a
-- rank without its population is not a rank. The parser reproduces the ranking
-- from the source's own weights and asserts agreement — see
-- `spa-engagement/metric-map.ts` for the derivation.
-- ---------------------------------------------------------------------------

create table public.spa_engagement_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),

  company text not null,

  -- THE RANKING POPULATION. "Rank 7" means nothing without it, and it is a
  -- count that names nobody.
  rank_population integer not null,
  -- The weights read off the sheet, as `{rank_metric_code: weight}`. Stored so
  -- a disputed Overall Rank can be recomputed from the same weights the
  -- delivery carried, even after the source changes them.
  rank_weights jsonb not null,

  source_salon_count integer,
  salon_count        integer not null,
  -- Salons the summary listed that the roster did not name. Surfaced as an
  -- ingestion warning rather than silently discarded.
  unrostered_salons  text[] not null default '{}',

  -- The daily series' coverage, when the delivery carried one.
  daily_range_start date,
  daily_range_end   date,

  warnings text[] not null default '{}',

  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_engagement_snapshots_population_positive check (rank_population > 0),
  constraint spa_engagement_snapshots_salons_positive check (salon_count > 0),
  constraint spa_engagement_snapshots_weights_object
    check (jsonb_typeof(rank_weights) = 'object'),
  constraint spa_engagement_snapshots_company_not_blank check (btrim(company) <> ''),
  constraint spa_engagement_snapshots_daily_range
    check (daily_range_start is null or daily_range_end is null
           or daily_range_start <= daily_range_end)
);

create unique index spa_engagement_snapshots_live_key
  on public.spa_engagement_snapshots (period_id, company)
  where superseded_by_ingestion_id is null;

comment on table public.spa_engagement_snapshots is
  'One ingested Spa Engagement delivery. `rank_population` and `rank_weights` are stored because a rank without its population is not a rank, and an Overall Rank cannot be re-derived without the weights the delivery carried.';

-- ------------------------------------------------------------ salon grain ---

create table public.spa_engagement_salon_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.spa_engagement_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),
  salon_id     uuid not null references public.salons (id),

  -- THE FOUR RAW COUNTS. Every ratio is computed from these at read time; none
  -- is stored, so there is nowhere for the wrong numerator to be written and
  -- nothing that cannot be re-aggregated from the parts.
  spa_sessions         numeric(18, 4),
  total_unique_tanners numeric(18, 4),
  unique_spa_tanners   numeric(18, 4),
  spa_beds             integer,

  -- `Corp` / `Fran` as the summary reports it. A FRANCHISE FLAG, not a company
  -- — the company comes from the roster and lives on the snapshot.
  ownership text,
  district_label text,
  region_label   text,

  -- The source's own published values, kept so a printed report can be
  -- reconciled against the dashboard without recomputation.
  reported_spa_sessions_per_bed            numeric(18, 8),
  reported_spa_sessions_per_unique_per_bed numeric(18, 10),
  reported_unique_spa_tanner_pct           numeric(12, 10),

  -- Chain-wide ranks as published, keyed by rank-metric code.
  reported_ranks jsonb not null default '{}'::jsonb,
  reported_overall_rank integer,
  -- The weighted score behind the Overall Rank, recomputed by the parser from
  -- the delivery's own weights. Kept so a disputed rank can be explained.
  computed_weighted_score numeric(18, 6),

  source_row integer,
  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_engagement_salon_facts_counts_not_negative check (
    (spa_sessions is null or spa_sessions >= 0)
    and (total_unique_tanners is null or total_unique_tanners >= 0)
    and (unique_spa_tanners is null or unique_spa_tanners >= 0)
    and (spa_beds is null or spa_beds >= 0)
  ),
  -- A salon cannot have more spa customers than customers.
  constraint spa_engagement_salon_facts_spa_within_total check (
    unique_spa_tanners is null
    or total_unique_tanners is null
    or unique_spa_tanners <= total_unique_tanners
  ),
  constraint spa_engagement_salon_facts_rank_positive
    check (reported_overall_rank is null or reported_overall_rank > 0),
  constraint spa_engagement_salon_facts_ranks_object
    check (jsonb_typeof(reported_ranks) = 'object')
);

create unique index spa_engagement_salon_facts_live_key
  on public.spa_engagement_salon_facts (period_id, salon_id)
  where superseded_by_ingestion_id is null;

create index spa_engagement_salon_facts_rank_idx
  on public.spa_engagement_salon_facts (period_id, reported_overall_rank)
  where superseded_by_ingestion_id is null;

comment on table public.spa_engagement_salon_facts is
  'One row per salon per period, holding only the FOUR RAW COUNTS. Spa Per Unique % and Spa Sessions per Unique Tanner per Spa Bed are both computed from them at read time by separately named functions, so the two can never be stored under one another''s name.';

-- ----------------------------------------------------- district managers ---

create table public.spa_engagement_manager_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.spa_engagement_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),

  -- Districts are MANAGER NAMES in this source, which change. Stored as the
  -- descriptive label it is, never promoted to a key.
  district_label text not null,
  region_label   text,

  spa_sessions         numeric(18, 4),
  total_unique_tanners numeric(18, 4),
  unique_spa_tanners   numeric(18, 4),
  spa_beds             integer,
  reported_overall_rank integer,

  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_engagement_manager_facts_district_not_blank
    check (btrim(district_label) <> '')
);

create unique index spa_engagement_manager_facts_live_key
  on public.spa_engagement_manager_facts (period_id, district_label)
  where superseded_by_ingestion_id is null;

comment on table public.spa_engagement_manager_facts is
  'The district-manager ranking, for the managers who run the authorized company''s salons. Their rank is a chain-wide fact about them, so it is stored as published.';

-- --------------------------------------------------------- the inventory ---

create table public.spa_bed_inventory (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.spa_engagement_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),
  salon_id     uuid not null references public.salons (id),

  -- The inventory's own naming, which is MORE SPECIFIC than the SPA Wellness
  -- report's column headers: `SPA Hydromassage 440 G3 (15)` here against
  -- `SPA Hydromassage` there. Kept verbatim rather than mapped, because the
  -- mapping is the source's business and guessing at it would merge two models.
  type_description text not null,
  units integer not null,
  category text,

  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_bed_inventory_units_positive check (units > 0),
  constraint spa_bed_inventory_type_not_blank check (btrim(type_description) <> '')
);

create unique index spa_bed_inventory_live_key
  on public.spa_bed_inventory (period_id, salon_id, type_description)
  where superseded_by_ingestion_id is null;

comment on table public.spa_bed_inventory is
  'Installed spa units per salon per model, from the delivery''s Equipment Counts sheet. Its type names are more specific than the SPA Wellness report''s column headers and are kept verbatim rather than mapped.';

-- ------------------------------------------------------- the daily series ---

create table public.spa_engagement_daily_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.spa_engagement_snapshots (id) on delete cascade,
  salon_id     uuid not null references public.salons (id),

  -- NO `period_id`. These rows are DAYS, not periods: the delivery carries a
  -- rolling 28-day window that overlaps the previous delivery's, and attaching
  -- them to the report's period would make them look summable with it. A day is
  -- keyed by its date and nothing else.
  activity_date date not null,

  unique_tanners     numeric(18, 4),
  unique_spa_tanners numeric(18, 4),
  total_visits       numeric(18, 4),
  spa_visits         numeric(18, 4),

  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_engagement_daily_facts_spa_within_total check (
    unique_spa_tanners is null
    or unique_tanners is null
    or unique_spa_tanners <= unique_tanners
  )
);

-- ONE LIVE ROW PER SALON PER DAY, whichever delivery brought it. Consecutive
-- deliveries overlap by 27 of 28 days and agree about them; a later delivery
-- supersedes the earlier row for a day it re-reports, so the series stays one
-- row per day rather than accumulating duplicates.
create unique index spa_engagement_daily_facts_live_key
  on public.spa_engagement_daily_facts (salon_id, activity_date)
  where superseded_by_ingestion_id is null;

create index spa_engagement_daily_facts_date_idx
  on public.spa_engagement_daily_facts (activity_date desc)
  where superseded_by_ingestion_id is null;

comment on table public.spa_engagement_daily_facts is
  'One row per salon per day from the delivery''s rolling 28-day series. Deliberately NOT keyed to a report period: consecutive deliveries overlap by 27 days, and a day is a day.';

-- ------------------------------------------------------------- read views ---

create or replace view public.spa_engagement_current_salon_facts
with (security_invoker = true) as
select
  p.id          as period_id,
  p.grain,
  p.period_start,
  p.period_end,
  p.label_raw   as period_label,
  s.company,
  s.rank_population,
  s.rank_weights,
  s.source_salon_count,
  sa.salon_number,
  sa.store_name,
  f.district_label,
  f.region_label,
  f.ownership,
  f.spa_sessions,
  f.total_unique_tanners,
  f.unique_spa_tanners,
  f.spa_beds,
  /*
   * THE FOUR RATIOS, COMPUTED HERE AND NAMED SEPARATELY.
   *
   * `spa_per_unique_pct` is sessions over unique tanners.
   * `spa_sessions_per_unique_per_bed` divides that again by beds.
   * They differ by a factor of the bed count and are DIFFERENT METRICS.
   *
   * Every one is null rather than zero where its denominator is missing or
   * zero: a salon with no spa beds has no sessions-per-bed figure, and a zero
   * would put it at the bottom of a ranking of stores that do have beds.
   */
  case
    when f.total_unique_tanners > 0 then f.spa_sessions / f.total_unique_tanners
  end as spa_per_unique_pct,
  case
    when f.spa_beds > 0 then f.spa_sessions / f.spa_beds
  end as spa_sessions_per_bed,
  case
    when f.total_unique_tanners > 0 and f.spa_beds > 0
      then f.spa_sessions / f.total_unique_tanners / f.spa_beds
  end as spa_sessions_per_unique_per_bed,
  case
    when f.total_unique_tanners > 0 then f.unique_spa_tanners / f.total_unique_tanners
  end as unique_spa_tanner_pct,
  f.reported_spa_sessions_per_bed,
  f.reported_spa_sessions_per_unique_per_bed,
  f.reported_unique_spa_tanner_pct,
  f.reported_ranks,
  f.reported_overall_rank,
  f.ingestion_id,
  i.parser_key,
  i.parser_version,
  i.finished_at as ingested_at,
  rf.original_filename
from public.spa_engagement_salon_facts f
join public.spa_engagement_snapshots s on s.id = f.snapshot_id
join public.report_periods p           on p.id = f.period_id
join public.salons sa                  on sa.id = f.salon_id
join public.report_ingestions i        on i.id = f.ingestion_id
join public.report_files rf            on rf.id = i.file_id
where f.superseded_by_ingestion_id is null
  and s.superseded_by_ingestion_id is null;

comment on view public.spa_engagement_current_salon_facts is
  'Live Spa Engagement facts with all four ratios computed and separately named. `spa_per_unique_pct` and `spa_sessions_per_unique_per_bed` are DIFFERENT metrics — the second divides by bed count — and must never be labelled as one another.';

-- ---------------------------------------------------------------------------
-- SPA CONVERSION RATE — the join, as a view that refuses to guess.
--
-- Bed Usage traffic over SPA Wellness sessions, matched on the canonical salon
-- AND on the period. The period join is on `period_id`, which means grain and
-- dates together: month-to-date through 31 August and year-to-date through
-- 31 August end on the same day and cover eight times the traffic, so a join
-- on the date alone would pass exactly the comparison that is most wrong.
--
-- The view is an INNER join on period and salon, so a row only exists where a
-- conversion rate is legitimate. It deliberately does not emit a row with a
-- reason — the reasons are per-salon and belong to the application, which shows
-- `N/A` plus the reason. What the view guarantees is that anything it DOES emit
-- is a valid conversion rate.
-- ---------------------------------------------------------------------------

create or replace view public.spa_conversion_current
with (security_invoker = true) as
select
  bed.period_id,
  bed.grain,
  bed.period_start,
  bed.period_end,
  bed.salon_number,
  bed.store_name,
  bed.district_label,
  bed.region_label,
  bed.total_tans,
  spa.total_sessions as spa_sessions,
  spa.equipment_pieces,
  -- Guarded, so a salon that reported no traffic yields NULL rather than an
  -- infinity rendered as a percentage.
  case
    when bed.total_tans > 0 then spa.total_sessions / bed.total_tans
  end as spa_conversion_rate,
  bed.per_bed as per_bed_usage
from public.bed_usage_current_salon_facts bed
join public.spa_wellness_current_salon_facts spa
  -- The SAME period row, which carries grain and dates together.
  on spa.period_id = bed.period_id
 and spa.salon_number = bed.salon_number
 and spa.company = bed.company;

comment on view public.spa_conversion_current is
  'Spa Conversion Rate = spa sessions / Total Tans, joined on the canonical salon AND the same period row. Emits a row only where the rate is legitimate; the application reports N/A with a reason for the rest.';
