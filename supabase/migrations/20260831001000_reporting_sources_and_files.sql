-- Ask Sunny — reporting lineage, part 1: where reports come from, and the raw
-- artifacts themselves.
--
-- Every number a dashboard ever shows must be traceable back to a file a person
-- can open:
--
--   dashboard value -> comp_sales_facts -> report_ingestions
--                   -> report_files -> the original workbook in private Storage
--
-- These two tables are the far end of that chain.

create table public.report_sources (
  id uuid primary key default extensions.gen_random_uuid(),

  -- Stable machine name used by parsers and the ingest endpoint.
  code text not null,
  name text not null,
  kind public.report_source_kind not null,

  -- Which fact model this source feeds. One controlled fact table per family;
  -- 'comp_sales' is the only one that exists today. KPI, Personal Bonus and
  -- Salon Bonus each become a new family with a new fact table, reusing every
  -- dimension and every lineage table below unchanged.
  report_family text not null,

  -- A source that has been retired stops accepting ingestions but keeps its
  -- history. Rows are never deleted.
  active boolean not null default true,

  notes text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint report_sources_code_key unique (code),
  constraint report_sources_code_format
    check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint report_sources_family_format
    check (report_family ~ '^[a-z][a-z0-9_]{2,63}$')
);

create trigger report_sources_touch_updated_at
  before update on public.report_sources
  for each row execute function public.touch_updated_at();

comment on table public.report_sources is
  'Upstream systems that deliver reports. One row per producer, not per file.';

-- ---------------------------------------------------------------------------

create table public.report_files (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id uuid not null references public.report_sources (id),

  -- Object key inside the private reporting bucket. Server-generated; never
  -- supplied by a client, exactly as for knowledge documents.
  storage_bucket text not null default 'reporting-sources',
  storage_path   text not null,

  original_filename text not null,
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes >= 0),

  -- IDEMPOTENCY LAYER 1 — content identity.
  --
  -- Lowercase hex SHA-256 of the bytes as received, computed before anything is
  -- written. The same file arriving twice — a resent email, a Power Automate
  -- retry, an administrator uploading a copy — collides here and the ingest
  -- endpoint returns the existing record instead of doing any work.
  file_sha256 text not null,

  -- IDEMPOTENCY LAYER 2 — delivery identity.
  --
  -- The upstream message identifier (an Outlook message id, a Power BI export
  -- id). Catches a retry that re-encodes the file so the bytes, and therefore
  -- the hash, differ. Null when the producer has no stable id; the uniqueness
  -- below is partial so nulls do not collide with each other.
  external_message_id text,

  -- Where the raw artifact was archived upstream (a SharePoint URL). RECORDED
  -- FOR LINEAGE, NEVER FETCHED: Ask Sunny does not follow this link, so a
  -- compromised or rewritten value cannot cause a server-side request.
  external_archive_url text,

  received_at timestamptz not null default now(),
  -- auth.users id once authentication exists. Null for machine deliveries.
  received_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),

  constraint report_files_sha256_key unique (file_sha256),
  constraint report_files_storage_object_key unique (storage_bucket, storage_path),
  constraint report_files_sha256_format check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint report_files_storage_path_not_blank check (btrim(storage_path) <> '')
);

-- Partial, so many files may have no upstream id without colliding.
create unique index report_files_source_message_key
  on public.report_files (source_id, external_message_id)
  where external_message_id is not null;

create index report_files_received_idx
  on public.report_files (received_at desc);

create index report_files_source_idx
  on public.report_files (source_id, received_at desc);

comment on table public.report_files is
  'One row per raw artifact received. Separate from report_ingestions because having the bytes and having understood them are different facts: a file can be received and fail to parse, or be re-parsed later by an improved parser without being re-received.';
comment on column public.report_files.file_sha256 is
  'Idempotency layer 1. Lowercase hex SHA-256 of the bytes as received.';
comment on column public.report_files.external_archive_url is
  'Lineage only. Never fetched by the server.';
