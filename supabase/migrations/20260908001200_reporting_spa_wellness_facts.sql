-- ---------------------------------------------------------------------------
-- SPA WELLNESS TRACKING FACTS.
--
-- THE RULE THIS SCHEMA EXISTS TO MAKE UNBREAKABLE: A ZERO OR BLANK EQUIPMENT
-- CELL MEANS THE EQUIPMENT IS NOT INSTALLED.
--
-- It is expressed structurally rather than as a convention:
--
--   * `spa_wellness_equipment_facts.sessions` is `not null` AND `check
--     (sessions > 0)`. There is no way to store a zero-session row, so no
--     `avg()` written later can include one, and no chart can render an
--     installed-but-idle machine that does not exist. In the August 2026 file
--     86% of the equipment cells are blank; a rule applied to 86% of the data
--     is not a detail.
--
--   * The peer benchmark is a SEPARATE TABLE with its own salon COUNTS, so a
--     peer average is a stored figure over installed peers rather than
--     something a query derives by dividing by however many salons exist.
--
-- THREE WINDOWS PER DELIVERY, THREE PERIODS. The workbook's MTD, YTD and LTM
-- sheets all end on the same day and cover 1x, 8x and 12x the sessions. They
-- are three rows in `report_periods` under the (grain, period_end) key, and
-- every fact names its period — so nothing can average across them and the
-- Spa Conversion Rate join cannot pair a year's sessions with a month's tans.
--
-- EQUIPMENT TYPES ARE UPSERTED, NOT ENUMERATED. See
-- `20260908001000_reporting_bed_spa_dimensions.sql`.
-- ---------------------------------------------------------------------------

create table public.spa_wellness_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),

  -- `mtd` / `ytd` / `ltm`, matching the sheet this window came from. Stored
  -- alongside the period so a snapshot names its own sheet without a join.
  window_code text not null,
  -- The sheet name exactly as the workbook titled it.
  source_sheet text not null,

  company text not null,
  source_salon_count integer,

  -- THE PERIOD STRING THIS DELIVERY ITSELF CARRIED. Distinct from
  -- `report_periods.label_raw`, which is shared between every report covering
  -- the same window and is refreshed by whichever landed last. The shared label
  -- describes the WINDOW; this one describes THIS FILE, which is what a
  -- provenance line must show.
  source_period_label text,

  salon_count          integer not null,
  equipment_type_count integer not null,
  equipment_use_count  integer not null,
  -- Equipment cells that were blank or zero, and therefore produced no fact.
  -- Recorded because "no row" and "not looked at" are different facts, and the
  -- source and quality panel must be able to tell them apart.
  not_installed_cell_count integer,

  warnings text[] not null default '{}',

  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_wellness_snapshots_window_known
    check (window_code in ('mtd', 'ytd', 'ltm')),
  constraint spa_wellness_snapshots_counts_sane
    check (salon_count > 0 and equipment_type_count > 0),
  constraint spa_wellness_snapshots_company_not_blank check (btrim(company) <> '')
);

create unique index spa_wellness_snapshots_live_key
  on public.spa_wellness_snapshots (period_id, company)
  where superseded_by_ingestion_id is null;

comment on table public.spa_wellness_snapshots is
  'One window of one ingested SPA Wellness delivery. The workbook carries three windows in one file and each becomes its own period, so nothing can aggregate a year''s sessions with a month''s.';

-- ------------------------------------------------------------ salon grain ---

create table public.spa_wellness_salon_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.spa_wellness_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),
  salon_id     uuid not null references public.salons (id),

  -- The source's own `Total SPA Sessions (Active Beds)`.
  total_sessions numeric(18, 4),
  -- Installed spa UNITS, from `Count of SPA Equipment`. Larger than the number
  -- of TYPES wherever a salon has two of something — MO Kansas City Liberty
  -- reports seven units across five types.
  equipment_pieces integer,
  -- Distinct types with non-zero use in this window.
  equipment_types_used integer not null default 0,

  -- Manager personal names in the source. Descriptive history for the period,
  -- never promoted to an identifier.
  district_label text,
  region_label   text,

  -- Earliest first use of any spa equipment at this salon, and the most recent
  -- FIRST use — when the newest piece came online. Surfaced so recently
  -- deployed equipment can be READ correctly; no ramp threshold is stored,
  -- because no approved rule defines one.
  first_use_date        date,
  newest_first_use_date date,

  is_comp_salon boolean,

  source_row integer,
  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_wellness_salon_facts_sessions_not_negative
    check (total_sessions is null or total_sessions >= 0),
  constraint spa_wellness_salon_facts_pieces_not_negative
    check (equipment_pieces is null or equipment_pieces >= 0),
  constraint spa_wellness_salon_facts_use_order
    check (
      first_use_date is null
      or newest_first_use_date is null
      or first_use_date <= newest_first_use_date
    )
);

create unique index spa_wellness_salon_facts_live_key
  on public.spa_wellness_salon_facts (period_id, salon_id)
  where superseded_by_ingestion_id is null;

comment on table public.spa_wellness_salon_facts is
  'One row per salon per window. `equipment_pieces` is installed UNITS and `equipment_types_used` is distinct types with non-zero use; conflating them understates the estate''s installed capital.';

-- -------------------------------------------------------- equipment grain ---

create table public.spa_wellness_equipment_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.spa_wellness_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),
  salon_id     uuid not null references public.salons (id),
  equipment_type_id uuid not null references public.spa_equipment_types (id),

  -- NOT NULL AND STRICTLY POSITIVE. This is the business rule as a constraint:
  -- a row exists only where the equipment is installed and was used, so no
  -- average computed later can admit a zero, and a "0 sessions" bar cannot be
  -- rendered for a machine that is not there.
  sessions numeric(18, 4) not null,

  -- Per-equipment dates from the workbook's two date sheets, where present.
  first_use_date date,
  last_use_date  date,

  source_row integer,
  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_wellness_equipment_facts_sessions_positive check (sessions > 0),
  constraint spa_wellness_equipment_facts_use_order
    check (first_use_date is null or last_use_date is null or first_use_date <= last_use_date)
);

create unique index spa_wellness_equipment_facts_live_key
  on public.spa_wellness_equipment_facts (period_id, salon_id, equipment_type_id)
  where superseded_by_ingestion_id is null;

create index spa_wellness_equipment_facts_type_idx
  on public.spa_wellness_equipment_facts (period_id, equipment_type_id)
  where superseded_by_ingestion_id is null;

comment on table public.spa_wellness_equipment_facts is
  'One row per salon per equipment type per window, ONLY where the equipment is installed and was used. `sessions > 0` is enforced: a zero in this source means the equipment is not installed, and storing one would let every later average count an absence as a failure.';

-- ---------------------------------------------------------- the benchmark ---

create table public.spa_equipment_benchmarks (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions (id) on delete cascade,
  snapshot_id  uuid not null references public.spa_wellness_snapshots (id) on delete cascade,
  period_id    uuid not null references public.report_periods (id),
  equipment_type_id uuid not null references public.spa_equipment_types (id),

  -- Salons across the WHOLE CHAIN that used this equipment in this window, and
  -- their average. This is what the workbook's own `Filtered Average` row
  -- reports.
  chain_salon_count       integer not null,
  chain_average_sessions  numeric(18, 6),

  -- Salons OUTSIDE the authorized company that used it, and their average.
  -- The like-for-like comparison the report exists for: "ours against other
  -- people's", not "ours against a pool we are inside".
  peer_salon_count       integer not null,
  peer_average_sessions  numeric(18, 6),

  superseded_by_ingestion_id uuid references public.report_ingestions (id),
  created_at timestamptz not null default now(),

  constraint spa_equipment_benchmarks_counts_not_negative
    check (chain_salon_count >= 0 and peer_salon_count >= 0),
  -- A peer count of zero must carry a NULL average, never a zero: nobody to
  -- compare with is not a comparison of nothing.
  constraint spa_equipment_benchmarks_empty_peer_has_no_average
    check (peer_salon_count > 0 or peer_average_sessions is null),
  constraint spa_equipment_benchmarks_empty_chain_has_no_average
    check (chain_salon_count > 0 or chain_average_sessions is null)
);

create unique index spa_equipment_benchmarks_live_key
  on public.spa_equipment_benchmarks (period_id, equipment_type_id)
  where superseded_by_ingestion_id is null;

comment on table public.spa_equipment_benchmarks is
  'Per-equipment averages over the salons that USED that equipment, with their counts. A BENCHMARK: no salon, company or store name. The peer figures exclude the authorized company, so the comparison is with other operators rather than with a pool the company is inside.';

-- ------------------------------------------------------------- read views ---

create or replace view public.spa_wellness_current_salon_facts
with (security_invoker = true) as
select
  p.id          as period_id,
  p.grain,
  p.period_start,
  p.period_end,
  p.label_raw   as period_label,
  s.source_period_label,
  s.window_code,
  s.source_sheet,
  s.company,
  s.source_salon_count,
  s.not_installed_cell_count,
  sa.salon_number,
  sa.store_name,
  f.district_label,
  f.region_label,
  f.total_sessions,
  f.equipment_pieces,
  f.equipment_types_used,
  case
    when f.equipment_pieces > 0 then f.total_sessions / f.equipment_pieces
  end as sessions_per_piece,
  f.first_use_date,
  f.newest_first_use_date,
  f.is_comp_salon,
  f.ingestion_id,
  i.parser_key,
  i.parser_version,
  i.finished_at as ingested_at,
  rf.original_filename
from public.spa_wellness_salon_facts f
join public.spa_wellness_snapshots s on s.id = f.snapshot_id
join public.report_periods p         on p.id = f.period_id
join public.salons sa                on sa.id = f.salon_id
join public.report_ingestions i      on i.id = f.ingestion_id
join public.report_files rf          on rf.id = i.file_id
where f.superseded_by_ingestion_id is null
  and s.superseded_by_ingestion_id is null;

comment on view public.spa_wellness_current_salon_facts is
  'Live SPA Wellness salon facts for every window, with lineage. `window_code` is a dimension so MTD, YTD and LTM can never be aggregated together.';

create or replace view public.spa_wellness_current_equipment_facts
with (security_invoker = true) as
select
  p.id           as period_id,
  p.grain,
  p.period_start,
  p.period_end,
  s.window_code,
  s.company,
  sa.salon_number,
  sa.store_name,
  t.code         as equipment_code,
  t.label        as equipment_label,
  t.short_label  as equipment_short_label,
  t.is_comparable,
  t.display_order,
  f.sessions,
  f.first_use_date,
  f.last_use_date,
  b.chain_salon_count,
  b.chain_average_sessions,
  b.peer_salon_count,
  b.peer_average_sessions,
  f.ingestion_id
from public.spa_wellness_equipment_facts f
join public.spa_wellness_snapshots s   on s.id = f.snapshot_id
join public.report_periods p           on p.id = f.period_id
join public.salons sa                  on sa.id = f.salon_id
join public.spa_equipment_types t      on t.id = f.equipment_type_id
left join public.spa_equipment_benchmarks b
       on b.period_id = f.period_id
      and b.equipment_type_id = f.equipment_type_id
      and b.superseded_by_ingestion_id is null
where f.superseded_by_ingestion_id is null
  and s.superseded_by_ingestion_id is null;

comment on view public.spa_wellness_current_equipment_facts is
  'Live SPA Wellness equipment facts with their peer benchmark attached. Every row is installed-and-used equipment; there are no zero-session rows to filter out.';
