-- Ask Sunny — shared reporting dimensions.
--
-- These are deliberately SHARED across report families. A salon is a salon
-- whether the numbers came from the Comp Report, a KPI export or a bonus
-- report; only the fact tables are per-family.

create table public.report_metrics (
  id uuid primary key default extensions.gen_random_uuid(),

  -- THE CONTROLLED VOCABULARY. A parser may not invent a metric: it resolves a
  -- workbook column to a code that already exists here, and an unresolved
  -- column becomes a warning rather than a silently mislabelled fact. Adding a
  -- metric is a reviewed migration with a unit and a direction attached.
  code text not null,
  label text not null,
  family text not null,          -- 'revenue', 'volume', 'membership', 'labour', ...

  unit public.report_metric_unit not null,

  -- Null where "better" is genuinely not defined. A club freeze is neither good
  -- nor bad without context, and a dashboard that colours it green or red is
  -- asserting something the business has not said.
  higher_is_better boolean,

  -- Whether a fact for this metric must name the calendar year its figure
  -- describes. True for anything the workbook reports per year ("2026 OTC
  -- Revenue", "2024 OTC Revenue"). False for relative measures whose window is
  -- part of the code itself ("revenue_trailing_3m_current").
  --
  -- Enforced in the database, not merely documented: see the composite foreign
  -- key on comp_sales_facts.
  basis_year_required boolean not null default true,

  -- For a "% change" metric, the metric it is a change IN. Lets the UI and the
  -- AI query layer follow a percentage back to the figures behind it.
  comparison_of uuid references public.report_metrics (id),

  description text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint report_metrics_code_key unique (code),
  constraint report_metrics_code_format check (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint report_metrics_family_format check (family ~ '^[a-z][a-z0-9_]{2,63}$'),
  -- A metric cannot be a comparison of itself.
  constraint report_metrics_comparison_not_self check (comparison_of is distinct from id),
  -- Only a percentage can be a comparison of something.
  constraint report_metrics_comparison_is_percent
    check (comparison_of is null or unit = 'percent'),

  -- Required so comp_sales_facts can point a composite foreign key at
  -- (id, basis_year_required). Redundant with the primary key by itself; its
  -- job is to make that reference legal.
  constraint report_metrics_id_basis_year_key unique (id, basis_year_required)
);

create trigger report_metrics_touch_updated_at
  before update on public.report_metrics
  for each row execute function public.touch_updated_at();

create index report_metrics_family_idx on public.report_metrics (family, code);

comment on table public.report_metrics is
  'Controlled metric vocabulary. Facts reference it by foreign key, so a metric name cannot be invented by a parser.';

-- ---------------------------------------------------------------------------

create table public.salons (
  id uuid primary key default extensions.gen_random_uuid(),

  -- THE BUSINESS KEY, AND IT IS TEXT.
  --
  -- Salon numbers in the source workbook are zero-padded, e.g. '0468'. Reading
  -- one as an integer drops the leading zero, and the next report that reads it
  -- correctly creates a SECOND salon for the same store, silently splitting its
  -- history. The column is text, the check below refuses surrounding
  -- whitespace, and a regression test asserts a leading zero survives a full
  -- round trip.
  salon_number text not null,

  store_name text not null,

  -- 'Ref: Owner' and 'Ref: UID' from the workbook — an alternate composite key
  -- carried for reconciliation against upstream systems. Not used for matching:
  -- salon_number is.
  owner_ref text,
  owner_uid text,

  opened_at date,

  -- Lineage for the dimension itself: which ingestion first introduced this
  -- salon, and which most recently confirmed it still exists.
  first_seen_ingestion_id uuid references public.report_ingestions (id),
  last_seen_ingestion_id  uuid references public.report_ingestions (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint salons_salon_number_key unique (salon_number),
  constraint salons_salon_number_format
    check (salon_number ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  constraint salons_store_name_not_blank check (btrim(store_name) <> '')
);

create trigger salons_touch_updated_at
  before update on public.salons
  for each row execute function public.touch_updated_at();

comment on table public.salons is
  'One row per salon, keyed on the zero-padded text salon number. Shared by every report family.';
comment on column public.salons.salon_number is
  'Text, never integer: source values are zero-padded (e.g. 0468) and numeric coercion would split a salon''s history in two.';

-- ---------------------------------------------------------------------------

create table public.salon_period_attributes (
  id uuid primary key default extensions.gen_random_uuid(),

  salon_id  uuid not null references public.salons (id) on delete cascade,
  period_id uuid not null references public.report_periods (id) on delete cascade,
  ingestion_id uuid not null references public.report_ingestions (id),

  -- ORGANISATIONAL POSITION AS REPORTED, AND NOTHING MORE.
  --
  -- In the audited workbook the District and Region columns contain a MANAGER'S
  -- PERSONAL NAME, not a district code. Managers get reassigned, so these are
  -- stored per period as historical descriptive attributes and are never used
  -- as a join key or an identity. When stable district and region codes become
  -- available they arrive as new columns beside these, and these keep saying
  -- what each report actually said at the time.
  district_label text,
  region_label   text,
  company        text,
  ownership_group text,
  dma            text,
  pricing_plan   text,

  -- Comparability and equipment, as reported for this period.
  is_comp_salon boolean,
  spa_pieces    integer check (spa_pieces is null or spa_pieces >= 0),
  spa_install_date date,

  -- Derived in the source workbook against the WHOLE chain, not against the
  -- salons present in any one recipient's file. Stored as reported and never
  -- recomputed locally, because a partial file cannot reproduce it.
  quintile_group text,
  revenue_rank   integer check (revenue_rank is null or revenue_rank >= 1),

  salon_age_years numeric(7,3) check (salon_age_years is null or salon_age_years >= 0),
  avg_client_age  numeric(6,3) check (avg_client_age is null or avg_client_age >= 0),

  market_consolidation text,
  nearest_competitor_distance numeric(10,3),

  -- Correction handling, identical in spirit to comp_sales_facts. A restated
  -- report supersedes; it never overwrites.
  superseded_by_ingestion_id uuid references public.report_ingestions (id),

  created_at timestamptz not null default now()
);

-- One live attribute row per salon per period. Superseded rows are exempt, so
-- corrections accumulate alongside rather than replacing.
create unique index salon_period_attributes_live_key
  on public.salon_period_attributes (salon_id, period_id)
  where superseded_by_ingestion_id is null;

create index salon_period_attributes_period_idx
  on public.salon_period_attributes (period_id)
  where superseded_by_ingestion_id is null;

-- Filtering a dashboard by district or region is the common read, and both are
-- nullable free text, so the indexes are partial on live rows only.
create index salon_period_attributes_district_idx
  on public.salon_period_attributes (period_id, district_label)
  where superseded_by_ingestion_id is null;

create index salon_period_attributes_region_idx
  on public.salon_period_attributes (period_id, region_label)
  where superseded_by_ingestion_id is null;

create index salon_period_attributes_ingestion_idx
  on public.salon_period_attributes (ingestion_id);

comment on table public.salon_period_attributes is
  'Salon characteristics as reported for one period. Period-scoped because quintile group, revenue rank and the district/region manager all change between reports; storing them on salons would silently re-render last month''s dashboard with this month''s org chart.';
comment on column public.salon_period_attributes.district_label is
  'Manager name as reported. Descriptive history, never an identifier or a join key.';
