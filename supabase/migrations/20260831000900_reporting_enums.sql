-- Ask Sunny — Salon Performance / Comp Sales reporting: controlled vocabularies.
--
-- DOMAIN NOTE, because the name is genuinely ambiguous outside this company.
-- "Comp Report" here means COMPARABLE-STORE (same-store) salon performance. It
-- is not compensation, payroll, salary or bonus. The audited workbook contains
-- no employee dimension at all; its grain is one row per salon per reporting
-- period. If a real compensation report arrives later it is a SEPARATE report
-- family with its own parser and its own fact table — it does not belong here.
--
-- SCHEMA PLACEMENT. These objects live in `public` rather than a `reporting`
-- schema on purpose. PostgREST only serves schemas named in a project-level
-- API setting, and the application reaches Supabase exclusively through
-- supabase-js. Putting reporting in an unexposed schema would make every table
-- below unreachable until someone changed a dashboard setting by hand — the
-- kind of undocumented manual step this project has been avoiding. Separation
-- from the RAG domain is enforced by naming, ownership and privileges instead:
-- nothing here references knowledge_documents or knowledge_chunks, and nothing
-- there references these.

-- How a report reached us. Determines which ingestion path produced a file and
-- what identity, if any, can be trusted on it.
create type public.report_source_kind as enum (
  'email_attachment',   -- Outlook -> Power Automate -> SharePoint -> ingest
  'manual_upload',      -- an administrator uploading through Ask Sunny
  'power_bi',           -- a Power BI export or dataset query
  'api'                 -- any other server-to-server producer
);

-- The accumulation window a set of facts covers.
--
-- Deliberately only two values. The audited workbook's third sheet
-- ("MTD vs 2024") is NOT a third grain: it is month-to-date figures compared
-- against a different baseline year. The baseline belongs to the metric, not
-- to the period — see report_metrics.basis_year_required and
-- comp_sales_facts.basis_year. Modelling it as a grain would split one
-- reporting period into two, and month-to-date totals would stop reconciling.
create type public.report_period_grain as enum (
  'mtd',   -- month to date, as of report_periods.period_end
  'ytd'    -- year to date, as of report_periods.period_end
);

-- Lifecycle of a single parse attempt.
create type public.report_ingestion_status as enum (
  'received',           -- bytes stored, not yet parsed
  'parsing',
  'succeeded',
  'failed',             -- parsed and rejected; failure_reason says why
  'rejected_duplicate'  -- an idempotency layer matched an earlier ingestion
);

-- What a metric's numbers mean. Drives formatting, aggregation and the
-- direction of "better" — a dashboard must never sum a ratio or celebrate a
-- rising cancellation count.
create type public.report_metric_unit as enum (
  'currency',   -- money, in the reporting currency. Sums.
  'count',      -- whole things: tans, clubs, clients. Sums.
  'hours',      -- labour hours. Sums.
  'ratio',      -- per-unit averages such as PTA or revenue per bed. Does NOT sum.
  'percent',    -- stored as a FRACTION: -0.0299 means -2.99%. Does NOT sum.
  'rank',       -- ordinal position. Does NOT sum or average.
  'years'       -- durations such as salon age. Does NOT sum.
);
