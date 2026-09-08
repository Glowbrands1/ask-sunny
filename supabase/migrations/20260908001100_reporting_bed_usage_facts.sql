-- ---------------------------------------------------------------------------
-- BED USAGE FACTS.
--
-- TWO GRAINS, STORED SEPARATELY, BECAUSE THE SOURCE REPORTS BOTH AND THEY ARE
-- NOT DERIVABLE FROM EACH OTHER SAFELY.
--
--   `bed_usage_salon_facts`      one row per salon per period: the salon's own
--                                Total Tans and Bed Count.
--   `bed_usage_equipment_facts`  one row per salon per equipment row.
--
-- The source writes `Salon Tans` and `Bed Count` again on EVERY equipment row
-- of a salon — nine to twelve times each — and marks the salon's first row with
-- `Ref` = 1 so its own summary block can count salons with SUM(A:A). Summing
-- the column therefore overstates a salon by an order of magnitude. Storing the
-- salon grain separately means no query can make that mistake: there is exactly
-- one salon row to read, and the equipment table has no salon-total column at
-- all.
--
-- The two DO reconcile — a salon's Total Tans equals the sum of its equipment
-- rows' client tans, verified to the unit for all fifteen authorized salons in
-- August 2026 — and that is a validation the application asserts, not a
-- shortcut the schema takes.
--
-- `v Chain` IS STORED AS A PERCENTAGE, CONVERTED ONCE. The workbook states it
-- as a MULTIPLE of the chain average (2.0258 for a salon at twice the chain,
-- 0.9648 for one just below it). Stored raw and classified as a percentage,
-- 2.0258 reads as "+2%, outperforming" about a salon running at 103% above the
-- chain. The raw ratio is kept alongside for provenance.
--
-- THE CHAIN BENCHMARK IS A BENCHMARK AND NOT A SALON. One row per equipment
-- level per period: the chain's average tans per bed and its bed count. No
-- salon, no company, no store name — so it explains what a `v Chain` figure was
-- measured against while disclosing nothing about another company's salons.
-- ---------------------------------------------------------------------------

create table public.bed_usage_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),

  -- The company this delivery was narrowed to. Recorded so a period's scope is
  -- a stored fact rather than an assumption about how the parser was called.
  company text not null,

  -- THE PERIOD STRING THIS DELIVERY ITSELF CARRIED.
  --
  -- Distinct from `report_periods.label_raw`, which is shared: three reports
  -- covering August all resolve to one period row, and its label is refreshed
  -- by whichever delivery landed last. So the shared label describes the
  -- WINDOW, and this one describes THIS FILE — which is what a provenance line
  -- must show, because attributing another report's title to this one is how a
  -- correct figure comes to look wrong.
  source_period_label text,

  -- What the SOURCE delivery covered, before scoping. Counts only — the
  -- coverage banner needs to be able to say the file was wider than the slice.
  source_salon_count   integer,
  source_company_count integer,

  salon_count     integer not null,
  equipment_count integer not null,
  warnings        text[] not null default '{}',

  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint bed_usage_snapshots_counts_sane
    check (salon_count > 0 and equipment_count > 0),
  constraint bed_usage_snapshots_company_not_blank check (btrim(company) <> '')
);

-- AT MOST ONE LIVE SNAPSHOT PER PERIOD AND COMPANY. A corrected report for the
-- same month supersedes the earlier one inside a single transaction; a report
-- for a different month supersedes nothing, which is what lets a backfill land
-- in the Period control rather than displacing the latest month.
create unique index bed_usage_snapshots_live_key
  on public.bed_usage_snapshots (period_id, company)
  where superseded_by_ingestion_id is null;

comment on table public.bed_usage_snapshots is
  'One ingested Bed Usage delivery, scoped to one company and one period. A report for a different period never supersedes another.';

-- ------------------------------------------------------------ salon grain ---

create table public.bed_usage_salon_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.bed_usage_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),
  salon_id     uuid not null references public.salons (id),

  -- The source's `Salon Tans`, read from the Ref = 1 row and nowhere else.
  -- NULL means the source left it blank; it is never zero as a stand-in.
  total_tans numeric(18, 4),
  bed_count  integer,

  source_row integer,
  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint bed_usage_salon_facts_tans_not_negative
    check (total_tans is null or total_tans >= 0),
  constraint bed_usage_salon_facts_beds_not_negative
    check (bed_count is null or bed_count >= 0)
);

create unique index bed_usage_salon_facts_live_key
  on public.bed_usage_salon_facts (period_id, salon_id)
  where superseded_by_ingestion_id is null;

create index bed_usage_salon_facts_lookup_idx
  on public.bed_usage_salon_facts (period_id, salon_id)
  where superseded_by_ingestion_id is null;

comment on table public.bed_usage_salon_facts is
  'One row per salon per period. The salon''s own Total Tans and Bed Count, which the source repeats on every equipment row and which must be read once — summing the repeated column overstates a salon tenfold.';

-- -------------------------------------------------------- equipment grain ---

create table public.bed_usage_equipment_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.bed_usage_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),
  salon_id     uuid not null references public.salons (id),

  -- TEXT rather than a foreign key to `bed_equipment_levels`, on purpose. A
  -- seventh level appearing upstream is a business change, and refusing the
  -- rows would understate the salon by everything that level carries. The
  -- application reports the unknown level as a warning; the level table
  -- supplies labels and the FAST rule for the ones we know.
  level text not null,
  -- The bed MODEL, e.g. `Ergoline 800 Affinity Hybrid`.
  bed_type text not null,

  qty integer,
  -- Excludes employee tans. The source's own per-bed numerator.
  client_tans numeric(18, 4),
  -- Includes employee tans. Reconciliation against the Usage Detail sheet only.
  total_tans_with_employee numeric(18, 4),
  per_bed numeric(18, 6),

  -- A PERCENTAGE difference against the chain for this LEVEL.
  v_chain_percent numeric(18, 6),
  -- The multiple exactly as the workbook stated it, for provenance.
  v_chain_ratio numeric(18, 8),
  -- The same comparison against this exact bed MODEL. Narrower and noisier.
  v_bed_type_percent numeric(18, 6),

  -- Fractions, as the source writes them: 0.15 is 15%.
  share_of_salon_tans numeric(12, 8),
  share_of_salon_beds numeric(12, 8),

  source_row integer,
  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint bed_usage_equipment_facts_level_shape check (btrim(level) <> ''),
  constraint bed_usage_equipment_facts_qty_positive check (qty is null or qty > 0),
  constraint bed_usage_equipment_facts_tans_not_negative
    check (client_tans is null or client_tans >= 0)
);

-- THE LIVE BUSINESS KEY: one row per salon, period, level and bed model. A
-- salon can hold two different models at the same level (INSTANT CLASSIC
-- Ergoline 1050 and SIGNATURE KBL 8000 HybridSun both report as INSTANT), so
-- the model is part of the key and a key on (salon, period, level) would reject
-- half of them.
create unique index bed_usage_equipment_facts_live_key
  on public.bed_usage_equipment_facts (period_id, salon_id, level, bed_type)
  where superseded_by_ingestion_id is null;

create index bed_usage_equipment_facts_level_idx
  on public.bed_usage_equipment_facts (period_id, level)
  where superseded_by_ingestion_id is null;

create index bed_usage_equipment_facts_salon_idx
  on public.bed_usage_equipment_facts (salon_id)
  where superseded_by_ingestion_id is null;

comment on table public.bed_usage_equipment_facts is
  'One row per salon per equipment model per period. `v_chain_percent` is a PERCENTAGE difference; the workbook states it as a multiple and `v_chain_ratio` keeps that original. Holds no salon-total column, so no query can sum the repeated `Salon Tans`.';

-- ---------------------------------------------------------- the benchmark ---

create table public.bed_usage_chain_benchmarks (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.bed_usage_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),

  level text not null,
  -- The chain's average tans per bed at this level, from the report's own
  -- `All Salons` block. NOT from its `Filtered Data` block, whose SUBTOTAL
  -- formulas depend on the autofilter state the sender left in the file.
  tans_per_bed numeric(18, 6),
  total_beds integer,
  -- The level's share of chain tans, as a fraction.
  share_of_chain_tans numeric(12, 8),

  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint bed_usage_chain_benchmarks_level_shape check (btrim(level) <> '')
);

create unique index bed_usage_chain_benchmarks_live_key
  on public.bed_usage_chain_benchmarks (period_id, level)
  where superseded_by_ingestion_id is null;

comment on table public.bed_usage_chain_benchmarks is
  'The chain''s per-bed usage by equipment level, per period. A BENCHMARK: an average and a bed count, naming no salon, company or store — which is what lets a dashboard explain a v Chain figure without disclosing another company''s data.';

-- ------------------------------------------------------------- read views ---

create or replace view public.bed_usage_current_salon_facts
with (security_invoker = true) as
select
  p.id             as period_id,
  p.grain,
  p.period_start,
  p.period_end,
  p.label_raw      as period_label,
  s.source_period_label,
  s.company,
  s.source_salon_count,
  sa.salon_number,
  sa.store_name,
  spa.district_label,
  spa.region_label,
  f.total_tans,
  f.bed_count,
  -- RECOMPUTED PER SALON, and null rather than infinite where there are no
  -- beds: a salon with no beds has no per-bed usage, which is not zero.
  case when f.bed_count > 0 then f.total_tans / f.bed_count end as per_bed,
  f.source_row,
  f.ingestion_id,
  i.parser_key,
  i.parser_version,
  i.finished_at    as ingested_at,
  rf.original_filename
from public.bed_usage_salon_facts f
join public.bed_usage_snapshots s on s.id = f.snapshot_id
join public.report_periods p      on p.id = f.period_id
join public.salons sa             on sa.id = f.salon_id
join public.report_ingestions i   on i.id = f.ingestion_id
join public.report_files rf       on rf.id = i.file_id
-- The district and region a salon reported under FOR THIS PERIOD, where the
-- Comp Report has also loaded that period. Left-joined: the Bed Usage report
-- carries no district of its own, and a salon with no Comp Report row is still
-- a salon.
left join public.salon_period_attributes spa
       on spa.salon_id = f.salon_id and spa.period_id = f.period_id
where f.superseded_by_ingestion_id is null
  and s.superseded_by_ingestion_id is null;

comment on view public.bed_usage_current_salon_facts is
  'Live Bed Usage salon facts with their period, lineage and — where the Comp Report has loaded the same period — the district and region the salon reported under.';

create or replace view public.bed_usage_current_equipment_facts
with (security_invoker = true) as
select
  p.id          as period_id,
  p.grain,
  p.period_start,
  p.period_end,
  s.company,
  sa.salon_number,
  sa.store_name,
  spa.district_label,
  spa.region_label,
  f.level,
  l.label       as level_label,
  -- The FAST rule, carried into the read surface so a query written later
  -- cannot rediscover FAST as the estate's worst performer.
  coalesce(l.advisory_only, false) as level_advisory_only,
  coalesce(l.is_premium, false)    as level_is_premium,
  f.bed_type,
  f.qty,
  f.client_tans,
  f.total_tans_with_employee,
  f.per_bed,
  f.v_chain_percent,
  f.v_chain_ratio,
  f.v_bed_type_percent,
  f.share_of_salon_tans,
  f.share_of_salon_beds,
  b.tans_per_bed as chain_tans_per_bed,
  f.source_row,
  f.ingestion_id
from public.bed_usage_equipment_facts f
join public.bed_usage_snapshots s on s.id = f.snapshot_id
join public.report_periods p      on p.id = f.period_id
join public.salons sa             on sa.id = f.salon_id
left join public.bed_equipment_levels l on l.code = f.level
left join public.bed_usage_chain_benchmarks b
       on b.period_id = f.period_id
      and b.level = f.level
      and b.superseded_by_ingestion_id is null
left join public.salon_period_attributes spa
       on spa.salon_id = f.salon_id and spa.period_id = f.period_id
where f.superseded_by_ingestion_id is null
  and s.superseded_by_ingestion_id is null;

comment on view public.bed_usage_current_equipment_facts is
  'Live Bed Usage equipment facts with the chain benchmark for their level and the FAST advisory flag attached.';
