-- ---------------------------------------------------------------------------
-- SALES TOTALS — the daily report, stored as daily SNAPSHOTS.
--
-- Curt receives one of these each morning and each carries two windows: the
-- previous day, and month to date through that day. So a delivery is not a
-- correction of yesterday's — it is a new historical record, and both stay
-- true of the day they were run.
--
-- THE RULE THIS SCHEMA EXISTS TO ENFORCE: MTD IS NEVER SUMMED ACROSS REPORT
-- DATES. Verified against the real samples — All Salons, Tans: Sep 1 daily 115,
-- Sep 2 daily 124, Sep 2 MTD 239 = 115 + 124. MTD is already cumulative, so
-- adding Sep 2 MTD to Sep 3 MTD double-counts Sep 1 and Sep 2 and means
-- nothing. `window` is a first-class dimension precisely so a query cannot
-- accidentally aggregate the two together, and the read view never sums across
-- report_date.
--
-- TWO POPULATIONS, NOT ONE. The report's summary block covers all 249 salons;
-- its salon block is the recipient's 15. The summary is NOT derivable from the
-- rows and the rows do not add up to it. They are stored as different scopes —
-- a fact belongs to a summary scope OR to a salon, never both — so no query can
-- flatten one into the other.
--
-- AND THE SUMMARY FIGURES ARE AVERAGES. The report's own header says
-- "Averages | Salon Counts", and the arithmetic confirms it:
--     (98 x 734.50 + 151 x 872.94) / 249 = 818.45, the All Salons figure.
-- `summary_is_average` on the metric and `salon_count` on the fact carry that
-- forward, so a card cannot present a per-salon average as an estate total.
--
-- Nothing in this migration touches the Comp Report domain. Separate tables,
-- separate facts, separate supersession — the two families share only the
-- `salons` dimension, `report_files` and `report_ingestions`.
-- ---------------------------------------------------------------------------

-- The two windows a single report carries. An enum rather than a boolean so a
-- third window (week to date, say) is an additive change.
create type public.sales_totals_window as enum (
  'daily',  -- the single day the report covers
  'mtd'     -- first of the month through that day, already cumulative
);

-- Whether a fact describes a reporting scope or an individual salon.
create type public.sales_totals_scope_kind as enum (
  'summary',  -- All Salons, STC Consolidated, STC Franchisees
  'salon'
);

-- ------------------------------------------------------------ dimensions ---

create table public.sales_totals_metrics (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique,
  label text not null,
  unit public.report_metric_unit not null,

  -- 'sum' may be added across salons; 'average' may never be, at any scope.
  -- PPTA is money per transaction, so an average of averages is not the
  -- average.
  aggregation text not null,

  -- True where the SUMMARY block reports a per-salon average rather than a
  -- total for the scope. True for every measure in this report; kept per metric
  -- so a future report that totals some of them can say so.
  summary_is_average boolean not null default true,

  note text not null default '',
  display_order integer not null,

  created_at timestamptz not null default now(),

  constraint sales_totals_metrics_aggregation_known
    check (aggregation in ('sum', 'average')),
  constraint sales_totals_metrics_code_shape
    check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.sales_totals_metrics is
  'The six Sales Totals measures. `summary_is_average` records that the report''s summary block holds per-salon averages, not totals.';

create table public.sales_totals_scopes (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique,
  label text not null,
  display_order integer not null,
  created_at timestamptz not null default now(),

  constraint sales_totals_scopes_code_shape check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.sales_totals_scopes is
  'The report''s summary groupings. These cover the whole estate and are a different population from the salon rows beneath them.';

-- ------------------------------------------------------------- snapshots ---

-- One row per ingested report. `report_date` is the day the report covers,
-- taken from its own body — never from the filename and never from the
-- delivery time.
create table public.sales_totals_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions(id) on delete cascade,

  report_date date not null,
  -- Where the MTD window opens: the first of report_date's month.
  month_start date not null,
  -- The date exactly as the report wrote it, e.g. '09-02-2026'. Kept so a
  -- disputed date can be checked without reopening the file.
  report_date_raw text not null,

  summary_row_count integer not null,
  salon_row_count integer not null,
  value_count integer not null,
  warnings text[] not null default '{}',

  -- A CORRECTED REPORT FOR THE SAME DATE supersedes the earlier snapshot
  -- rather than overwriting it. History is kept; only the live row changes.
  superseded_by_ingestion_id uuid references public.report_ingestions(id),

  created_at timestamptz not null default now(),

  constraint sales_totals_snapshots_month_start_is_first
    check (month_start = date_trunc('month', report_date)::date),
  constraint sales_totals_snapshots_counts_sane
    check (summary_row_count > 0 and salon_row_count > 0 and value_count > 0)
);

-- AT MOST ONE LIVE SNAPSHOT PER REPORT DATE. A re-delivery of identical bytes
-- never reaches here (the file digest stops it upstream); a genuine correction
-- supersedes the previous one inside one transaction.
create unique index sales_totals_snapshots_live_date_key
  on public.sales_totals_snapshots (report_date)
  where superseded_by_ingestion_id is null;

create index sales_totals_snapshots_date_idx
  on public.sales_totals_snapshots (report_date desc);

comment on table public.sales_totals_snapshots is
  'One ingested Sales Totals report. Each is a historical snapshot of its report_date; a later report for a NEW date never replaces an earlier one.';

-- ----------------------------------------------------------------- facts ---

create table public.sales_totals_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  ingestion_id uuid not null references public.report_ingestions(id) on delete cascade,
  snapshot_id uuid not null references public.sales_totals_snapshots(id) on delete cascade,

  -- Denormalised from the snapshot so the read view never has to join to
  -- filter by date, and so the live business key below can include it.
  report_date date not null,

  scope_kind public.sales_totals_scope_kind not null,
  -- Exactly one of these is set — see the check below.
  scope_id uuid references public.sales_totals_scopes(id),
  salon_id uuid references public.salons(id),

  metric_id uuid not null references public.sales_totals_metrics(id),

  -- Named `report_window` rather than `window`, which PostgreSQL reserves for
  -- window functions. Quoting it at every use site would be a permanent tax on
  -- readability for the sake of one word.
  report_window public.sales_totals_window not null,

  -- NULL means the source left the cell blank. It is NOT zero: a salon that
  -- reported nothing and a salon that took nothing are different facts.
  value numeric(18, 4),

  -- How many salons a summary row averages over. NULL on a salon fact.
  salon_count integer,

  -- Which row of the source this came from, for lineage.
  source_row integer,

  superseded_by_ingestion_id uuid references public.report_ingestions(id),

  created_at timestamptz not null default now(),

  -- A fact describes a scope OR a salon. Never both, never neither — that is
  -- what keeps "All Salons" out of a salon ranking.
  constraint sales_totals_facts_one_subject check (
    (scope_kind = 'summary' and scope_id is not null and salon_id is null)
    or
    (scope_kind = 'salon' and salon_id is not null and scope_id is null)
  ),
  -- A salon count belongs only to a summary row.
  constraint sales_totals_facts_count_only_on_summary check (
    (scope_kind = 'summary') or (salon_count is null)
  ),
  constraint sales_totals_facts_count_positive check (
    salon_count is null or salon_count > 0
  )
);

-- THE LIVE BUSINESS KEY. One value per report date, subject, metric and window
-- among rows that have not been superseded. `coalesce` gives the two subject
-- kinds a single comparable key without needing two partial indexes.
create unique index sales_totals_facts_live_key
  on public.sales_totals_facts (
    report_date,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(salon_id, '00000000-0000-0000-0000-000000000000'::uuid),
    metric_id,
    report_window
  )
  where superseded_by_ingestion_id is null;

create index sales_totals_facts_live_lookup_idx
  on public.sales_totals_facts (report_date desc, report_window, metric_id)
  where superseded_by_ingestion_id is null;

create index sales_totals_facts_salon_idx
  on public.sales_totals_facts (salon_id)
  where superseded_by_ingestion_id is null;

comment on table public.sales_totals_facts is
  'One measure, one window, one subject, one report date. `report_window` is a dimension so daily and MTD can never be aggregated together; MTD is already cumulative and is never summed across report dates.';

-- ------------------------------------------------------------- read view ---

-- Everything a dashboard needs for one report date, already joined and with
-- the semantics attached. `security_invoker` so row level security applies to
-- whoever selects, not to the view's owner.
create or replace view public.sales_totals_current_facts
with (security_invoker = true) as
select
  f.report_date,
  s.report_date_raw,
  s.month_start,
  f.report_window,
  f.scope_kind,
  coalesce(sc.code, 'salon')            as scope_code,
  coalesce(sc.label, sa.store_name)     as subject_label,
  sc.display_order                      as scope_order,
  sa.salon_number,
  sa.store_name,
  m.code                                as metric_code,
  m.label                               as metric_label,
  m.unit                                as metric_unit,
  m.aggregation                         as metric_aggregation,
  m.summary_is_average,
  m.note                                as metric_note,
  m.display_order                       as metric_order,
  f.value,
  f.salon_count,
  f.source_row,
  f.ingestion_id,
  i.parser_key,
  i.parser_version,
  -- `report_ingestions` records completion as `finished_at`; exposed under the
  -- name a reader of this view expects.
  i.finished_at as ingested_at
from public.sales_totals_facts f
join public.sales_totals_snapshots s on s.id = f.snapshot_id
join public.sales_totals_metrics m on m.id = f.metric_id
join public.report_ingestions i on i.id = f.ingestion_id
left join public.sales_totals_scopes sc on sc.id = f.scope_id
left join public.salons sa on sa.id = f.salon_id
where f.superseded_by_ingestion_id is null
  and s.superseded_by_ingestion_id is null;

comment on view public.sales_totals_current_facts is
  'Live Sales Totals facts with their scope, salon, metric semantics and lineage. Never aggregates across report_date — pick a date, never add snapshots.';

-- ------------------------------------------------------------------- RLS ---
--
-- Same posture as the rest of the reporting domain: Supabase grants anon and
-- authenticated full table privileges at creation time, so every object is
-- revoked from first and granted afterwards. Views count as tables for those
-- default privileges, which is the easy one to forget.

alter table public.sales_totals_metrics   enable row level security;
alter table public.sales_totals_scopes    enable row level security;
alter table public.sales_totals_snapshots enable row level security;
alter table public.sales_totals_facts     enable row level security;

-- Forced, so the policies apply to the table owner too and a later migration
-- running as owner cannot quietly read around them.
alter table public.sales_totals_metrics   force row level security;
alter table public.sales_totals_scopes    force row level security;
alter table public.sales_totals_snapshots force row level security;
alter table public.sales_totals_facts     force row level security;

revoke all on public.sales_totals_metrics          from anon, authenticated;
revoke all on public.sales_totals_scopes           from anon, authenticated;
revoke all on public.sales_totals_snapshots        from anon, authenticated;
revoke all on public.sales_totals_facts            from anon, authenticated;
revoke all on public.sales_totals_current_facts    from anon, authenticated;

-- No policies are created, so with RLS enabled and forced nobody but the
-- secret key (service_role, which bypasses RLS by design) reads or writes
-- these. Narrowing by district needs stable district codes from the source,
-- which this report does not carry — see architecture-constraints.md.

-- -------------------------------------------------------------- the seed ---

insert into public.sales_totals_metrics
  (code, label, unit, aggregation, summary_is_average, note, display_order)
values
  ('grand_total', 'Grand Total', 'currency', 'sum', true,
   'Total sales. At salon level this is that salon''s own takings; in the summary block it is the average per salon.', 1),
  ('ppta', 'PPTA', 'currency', 'average', true,
   'Per-person tanning average — money per transaction. An average at every scope, so it is never summed.', 2),
  ('tans', 'Tans', 'count', 'sum', true,
   'Tanning sessions. In the summary block, the average per salon.', 3),
  ('efts', 'EFTs', 'count', 'sum', true,
   'Electronic funds transfer memberships taken. In the summary block, the average per salon.', 4),
  ('new_customers', 'New Customers', 'count', 'sum', true,
   'First-time customers. In the summary block, the average per salon.', 5),
  ('sunless_sessions', 'Sunless Sessions', 'count', 'sum', true,
   'Spray/sunless sessions. The source counts a session only where the equipment description contains one of "Versa", "Myst", "Norvell", "SunStyle", "Airbrush", "Pura" or "Xpression".', 6)
on conflict (code) do nothing;

insert into public.sales_totals_scopes (code, label, display_order)
values
  ('all_salons',       'All Salons',       1),
  ('stc_consolidated', 'STC Consolidated', 2),
  ('stc_franchisees',  'STC Franchisees',  3)
on conflict (code) do nothing;

-- The source. A separate row from the Comp Report's, because it is a different
-- report family arriving from a different sender on a different schedule.
insert into public.report_sources (code, name, kind, report_family, notes)
values (
  'sales_totals_email',
  'Sales Totals (daily emailed report)',
  'email_attachment',
  'sales_totals',
  'Daily report, received each morning. Named .xls but is an HTML document. Carries two windows per delivery: the previous day and month to date. Every delivery is a historical snapshot — MTD is already cumulative and is never summed across report dates. Its summary block reports per-salon AVERAGES over all salons, while the salon block is the recipient''s subset, so the two are different populations.'
)
on conflict (code) do nothing;
