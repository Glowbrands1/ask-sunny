-- Ask Sunny — reporting lineage, part 2: the reporting calendar and the parse
-- attempts that populate it.

create table public.report_periods (
  id uuid primary key default extensions.gen_random_uuid(),

  grain public.report_period_grain not null,

  -- The LAST DAY COVERED, not the last day of the month. The audited workbook's
  -- month-to-date sheets are as-of a mid-month date, so period_end is that date
  -- (e.g. the 30th). Year-to-date sheets name a month, and period_end is that
  -- month's final day.
  period_end   date not null,
  period_start date not null,

  fiscal_year integer not null,

  -- The period string exactly as it appeared in the workbook, e.g. the contents
  -- of cell F1. Kept verbatim so a disputed period can be checked against the
  -- source without reopening the file, and so a future format change is visible
  -- in the data rather than only in a parser diff.
  label_raw text not null,

  created_at timestamptz not null default now(),

  constraint report_periods_grain_end_key unique (grain, period_end),
  constraint report_periods_range check (period_start <= period_end),
  constraint report_periods_fiscal_year_matches
    check (fiscal_year = extract(year from period_end)),
  constraint report_periods_label_not_blank check (btrim(label_raw) <> '')
);

create index report_periods_end_idx on public.report_periods (period_end desc);

comment on table public.report_periods is
  'The reporting calendar. Uniqueness on (grain, period_end) is what makes Aug 16, Aug 23 and Aug 30 independently queryable rather than overwriting one another.';
comment on column public.report_periods.period_end is
  'Last day covered. For month-to-date sheets this is the as-of date, not month end.';

-- ---------------------------------------------------------------------------

create table public.report_ingestions (
  id uuid primary key default extensions.gen_random_uuid(),

  file_id   uuid not null references public.report_files (id),
  source_id uuid not null references public.report_sources (id),

  -- Which parser read the file, and which revision of it. The version is part
  -- of the identity of an ingestion: re-reading the same bytes with an improved
  -- parser is legitimate work, and must be allowed to produce a new ingestion
  -- while an accidental duplicate of the same file under the SAME parser is
  -- refused. That is exactly what the unique constraint below expresses.
  parser_key     text not null,
  parser_version integer not null check (parser_version >= 1),

  status public.report_ingestion_status not null default 'received',

  -- Null until the period has been parsed out of the file. A successful
  -- ingestion must have one — see the check at the end.
  period_id uuid references public.report_periods (id),

  -- Diagnostic correlation value, recorded but NOT unique. The real constraint
  -- is the natural key below; a hash is a digest of it, and enforcing
  -- uniqueness on a digest turns a bug in how it is computed into a spurious
  -- rejection. Defined as:
  --   sha256(source_code || '|' || file_sha256 || '|' || parser_key || '|' || parser_version)
  fingerprint text not null,

  -- Which sheets of the workbook were actually read. The audited file carries a
  -- large block of abandoned template columns that must never be ingested, so
  -- recording what was read is part of being able to answer "where did this
  -- number come from".
  source_sheet_names text[] not null default '{}',

  fact_count  integer not null default 0 check (fact_count >= 0),
  salon_count integer not null default 0 check (salon_count >= 0),

  -- Non-fatal parse observations: an unmatched header, a column that resolved
  -- by position rather than by label. Surfaced in the admin view so template
  -- drift is noticed before it becomes wrong data. Never contains file content.
  warnings text[] not null default '{}',

  -- User-safe reason a failed ingestion failed. Never contains report content.
  failure_reason text,

  started_at  timestamptz not null default now(),
  finished_at timestamptz,

  created_at timestamptz not null default now(),

  -- IDEMPOTENCY LAYER 1 + parser version, enforced on the natural key rather
  -- than on a hash of it.
  constraint report_ingestions_file_parser_key
    unique (file_id, parser_key, parser_version),

  constraint report_ingestions_parser_key_format
    check (parser_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint report_ingestions_fingerprint_format
    check (fingerprint ~ '^[0-9a-f]{64}$'),

  -- An ingestion cannot claim success without a period and a completion time.
  -- Same shape as knowledge_documents_indexed_requires_status: a status is a
  -- claim, and the schema refuses claims that are not backed by the data.
  constraint report_ingestions_succeeded_requires_period
    check (
      status <> 'succeeded'
      or (period_id is not null and finished_at is not null)
    ),
  constraint report_ingestions_failed_requires_reason
    check (status <> 'failed' or failure_reason is not null)
);

create index report_ingestions_file_idx    on public.report_ingestions (file_id);
create index report_ingestions_period_idx  on public.report_ingestions (period_id);
create index report_ingestions_fingerprint_idx on public.report_ingestions (fingerprint);
-- Small partial index over the states an operator actually goes looking for.
create index report_ingestions_open_idx
  on public.report_ingestions (started_at desc)
  where status in ('received', 'parsing', 'failed');

comment on table public.report_ingestions is
  'One row per parse attempt. Unique on (file_id, parser_key, parser_version) so the same bytes cannot be ingested twice by the same parser, while a re-parse under a newer parser version is permitted.';
