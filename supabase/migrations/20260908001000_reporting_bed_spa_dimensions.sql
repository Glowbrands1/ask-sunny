-- ---------------------------------------------------------------------------
-- BED USAGE + SPA REPORTING, PART 1: the shared vocabularies.
--
-- Three new report families arrive together — Bed Usage, SPA Wellness
-- Tracking, and Spa Sessions per Unique Tanner per Spa Bed — and they share
-- three things that belong here rather than in any one of them:
--
--   * a THIRD PERIOD GRAIN. The SPA Wellness workbook carries an `LTM` sheet
--     (last twelve months). Modelling it as a grain rather than as a flag keeps
--     `report_periods`' natural key doing its job: (grain, period_end) already
--     distinguishes month-to-date-through-31-August from
--     year-to-date-through-31-August, and last-twelve-months-through-31-August
--     is a third period ending on the same day.
--
--   * the EQUIPMENT LEVEL vocabulary the Bed Usage report groups by.
--
--   * the SPA EQUIPMENT TYPE catalogue, which is DATA RATHER THAN AN ENUM. The
--     August 2026 workbook lists thirty-one equipment columns and the set moves
--     as the estate does — four of them sit after the alphabetical run, which
--     is what a recently-added column looks like. So types are discovered from
--     the header row and upserted at ingestion, and a new spa product needs no
--     deployment. An enum would need a migration for every purchase.
--
-- WHY A FULL CALENDAR MONTH IS STORED AS `mtd`. The Bed Usage report covers
-- 1-31 August, which is month-to-date through the month's last day. Introducing
-- a fourth `monthly` grain would put the SPA Wellness MTD sheet and the Bed
-- Usage report — the same month, the same salons, the two halves of Spa
-- Conversion Rate — into two different periods that could never be joined. The
-- grain says what window accumulated, not how the file was titled.
-- ---------------------------------------------------------------------------

-- The third grain. Additive: no existing value changes and nothing that reads
-- `mtd` or `ytd` is affected.
alter type public.report_period_grain add value if not exists 'ltm';

comment on type public.report_period_grain is
  'The accumulation window a set of facts covers. `ltm` is the SPA Wellness workbook''s last-twelve-months sheet, which ends on the same day as that month''s MTD and YTD and is therefore a separate period under the (grain, period_end) key.';

-- ---------------------------------------------------------------------------
-- Equipment levels, from the Bed Usage report's own grouping.
--
-- `advisory_only` is the FAST rule, in the schema rather than only in code.
-- FAST removals are intentional: a falling FAST footprint is the intended
-- result of a decision already taken, so its shortfall against the chain is a
-- FIGURE and never a KPI. Storing the flag next to the level means a query
-- written later cannot rediscover FAST as the estate's worst performer.
-- ---------------------------------------------------------------------------

create table public.bed_equipment_levels (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique,
  label text not null,

  -- True where a shortfall against the chain must not be raised as a finding.
  advisory_only boolean not null default false,

  -- True for the premium levels FAST demand is expected to migrate into.
  is_premium boolean not null default false,

  note text not null default '',
  display_order integer not null,
  created_at timestamptz not null default now(),

  constraint bed_equipment_levels_code_shape check (code ~ '^[A-Z][A-Z0-9_]*$')
);

comment on table public.bed_equipment_levels is
  'The equipment levels the Bed Usage report groups by. `advisory_only` marks FAST, whose reduction is intentional and is never a performance KPI.';

insert into public.bed_equipment_levels
  (code, label, advisory_only, is_premium, note, display_order)
values
  ('FAST', 'Fast', true, false,
   'Being removed on purpose. Tracked for capacity and volume migration — whether FASTER, FASTEST and INSTANT absorb the demand it carried — and never as a performance shortfall.', 1),
  ('FASTER', 'Faster', false, true,
   'A premium level FAST demand is expected to migrate into.', 2),
  ('FASTEST', 'Fastest', false, true,
   'A premium level FAST demand is expected to migrate into.', 3),
  ('INSTANT', 'Instant', false, true,
   'The highest tanning level, and a premium destination for former FAST demand.', 4),
  ('SUNLESS', 'Sunless', false, false,
   'Spray and sunless equipment. Neither a FAST substitute nor a spa service.', 5),
  ('SPA', 'Spa', false, false,
   'Spa and wellness equipment as the Bed Usage report counts it. Its tans are the same volume the SPA Wellness report counts as sessions — verified equal for all fifteen authorized salons in August 2026 — so the two reports reconcile.', 6)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- SPA equipment types — an OPEN catalogue, upserted at ingestion.
--
-- `code` is derived from the workbook's own header text by a stable
-- transformation (lowercase, non-alphanumeric runs to single underscores), so
-- the same column always produces the same code and a type first seen in a
-- delivery is stored rather than dropped.
--
-- `is_comparable` is false for the `Other` bucket, which aggregates whatever
-- did not map to a named type. One salon's "Other" and another's are not the
-- same machine, so it is counted in totals and excluded from peer comparison.
-- ---------------------------------------------------------------------------

create table public.spa_equipment_types (
  id uuid primary key default extensions.gen_random_uuid(),

  code text not null unique,
  -- The header exactly as the workbook wrote it.
  label text not null,
  -- The header without its `SPA ` prefix, for a chart axis.
  short_label text not null,

  is_comparable boolean not null default true,

  -- Position within the equipment block on the delivery that introduced it.
  -- Display order only; not an identity.
  display_order integer not null default 0,

  -- Lineage: which ingestion first saw this type, and which most recently
  -- confirmed it is still in the report.
  first_seen_ingestion_id uuid references public.report_ingestions (id),
  last_seen_ingestion_id  uuid references public.report_ingestions (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint spa_equipment_types_code_shape check (code ~ '^[a-z][a-z0-9_]{0,79}$'),
  constraint spa_equipment_types_label_not_blank check (btrim(label) <> '')
);

create trigger spa_equipment_types_touch_updated_at
  before update on public.spa_equipment_types
  for each row execute function public.touch_updated_at();

comment on table public.spa_equipment_types is
  'The spa equipment vocabulary. DELIBERATELY OPEN: types are discovered from the workbook''s header row and upserted at ingestion, so a new spa product needs no deployment. `is_comparable` is false for the `Other` catch-all, which is not the same machine between salons.';

-- ---------------------------------------------------------------------------
-- The two new report sources. Separate rows because they are different reports
-- from different senders on different schedules.
-- ---------------------------------------------------------------------------

insert into public.report_sources (code, name, kind, report_family, notes)
values
  (
    'bed_usage_email',
    'Bed Usage Report (monthly emailed report)',
    'email_attachment',
    'bed_usage',
    'Monthly, chain-wide. Its `Summary` sheet carries a two-row header, a `Filtered Data` block computed with SUBTOTAL over VISIBLE rows (ignored — its value depends on the autofilter state the sender left in the file) and an `All Salons` block that is the chain benchmark. `Salon Tans` and `Bed Count` repeat on every equipment row of a salon and are read once, from the row flagged Ref = 1. `v Chain` is a RATIO of the row''s per-bed usage to the chain''s for that level, not a percentage.'
  ),
  (
    'spa_wellness_email',
    'STC SPA Wellness Tracking (monthly emailed report)',
    'email_attachment',
    'spa_wellness',
    'Monthly, chain-wide, three windows in one file (MTD / YTD / LTM). Equipment columns are dynamic and are found between the named descriptor columns and `Total SPA Sessions (Active Beds)`; everything past that column is retail revenue in dollars. A ZERO OR BLANK EQUIPMENT CELL MEANS THE EQUIPMENT IS NOT INSTALLED, so it produces no fact and joins no average — 86% of the equipment cells in the August 2026 file are blank.'
  ),
  (
    'spa_engagement_email',
    'Spa Sessions per Unique Tanner per Spa Bed (emailed report)',
    'email_attachment',
    'spa_engagement',
    'Chain-wide, with a ranked salon summary, a district-manager ranking, a spa equipment inventory, a 28-day daily series and a `Roster`. The roster is the ONLY place a salon number appears in any of the three new reports, and its `Corp` column is the operating company while `Corp/Fran` is the franchise flag. The report title carries no year (`9/1 - 9/1`), so the year is resolved from the daily sheet''s real date cells and a delivery whose year cannot be established is refused.'
  )
on conflict (code) do nothing;
