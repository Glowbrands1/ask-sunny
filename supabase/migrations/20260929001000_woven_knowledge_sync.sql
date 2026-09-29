-- ---------------------------------------------------------------------------
-- WOVEN → ASK SUNNY KNOWLEDGE SYNC — the manifest, the run ledger, the audit log
--
-- NOT APPLIED. Prepared with the connector and applied only with explicit
-- approval, verbatim, in one transaction, to Ask Sunny Dev
-- (`rbkylaavthsjepsczccv`) — which Production also reads, so applying it IS a
-- production schema change. Run `npm run verify:woven-knowledge-migration`
-- first, and the Supabase advisors after.
--
-- WHAT THIS CREATES:
--
--   knowledge_sync_settings            one row per source: the automatic-sync
--                                      switch an administrator controls, the
--                                      interval (30 days), and when the initial
--                                      sync, the last full scan and the last
--                                      success happened
--   knowledge_sync_runs                one row per attempt; the run lock
--   knowledge_sync_items               THE MANIFEST — one row per source item
--                                      part, keyed on the source's own ids
--   knowledge_sync_events              per-item audit log of what each run did
--   knowledge_sync_audience_decisions  an administrator's answer, per source
--                                      audience label, to "may everyone in Ask
--                                      Sunny see this?"
--
-- AND ONE ADDITION TO AN EXISTING TYPE: `knowledge_document_status` gains
-- `retired`. A document the source unpublished or removed is RETIRED, not
-- deleted: its row, chunks and stored file stay, and it stops being findable
-- because every retrieval path already requires `status = 'indexed'`
-- (`match_knowledge_chunks`, and both role-document reads), and the read
-- policies below hide it from the `authenticated` role. Retrieval itself is
-- not changed by this file. Re-publishing in the source re-indexes the same
-- document id, so nothing is ever duplicated.
--
-- `ALTER TYPE ... ADD VALUE` may run inside a transaction on PostgreSQL 12+;
-- the new value is simply not USED anywhere in this file, which is the one
-- restriction that applies.
--
-- WHAT THIS CHANGES ON EXISTING OBJECTS: the enum value above, and the two
-- `authenticated` read policies on `knowledge_documents` / `knowledge_chunks`,
-- which now exclude retired documents (see "`retired`, enforced in the DB").
--
-- WHAT THIS DOES NOT CHANGE: `knowledge_documents` and `knowledge_chunks`
-- columns and grants; `match_knowledge_chunks`; `app_users`; the Woven
-- employee directory tables.
--
-- ACCESS: every new table has RLS enabled AND forced with no policies, and
-- every privilege revoked from `anon` and `authenticated`. Only the server,
-- under the secret key, reads or writes any of it.
--
-- NOTHING SECRET IS STORABLE. There is no column for a password, cookie,
-- session id or anti-forgery token, and `locator` — the non-secret ids used to
-- fetch a file again — is refused if it looks like it carries a URL or an Azure
-- SAS signature.
-- ---------------------------------------------------------------------------

alter type public.knowledge_document_status add value if not exists 'retired';

-- ------------------------------------------ `retired`, enforced in the DB ---
--
-- RETIRED IS A PERSISTED LIFECYCLE STATE, enforced here and not only by the
-- application:
--
--   * RETRIEVAL. `match_knowledge_chunks` and both role-document reads require
--     `status = 'indexed'`, so a retired document is never matched.
--   * NEVER INDEXED. The existing `knowledge_documents_indexed_requires_status`
--     check (`indexed = false or status = 'indexed'`) already makes a retired
--     row unable to claim it is indexed.
--   * NOT READABLE BY A SIGNED-IN BROWSER. The two read policies below replace
--     the originals (`using (true)` and "the parent row exists") so that the
--     `authenticated` role cannot select a retired document or its chunks.
--
-- The comparisons cast to text (`status::text <> 'retired'`) on purpose: the
-- enum value added above may not be referenced as an enum literal in the same
-- transaction that adds it, and a text comparison is not such a reference.

drop policy if exists knowledge_documents_read_authenticated on public.knowledge_documents;
create policy knowledge_documents_read_authenticated
  on public.knowledge_documents
  for select
  to authenticated
  using (status::text <> 'retired');

drop policy if exists knowledge_chunks_read_authenticated on public.knowledge_chunks;
create policy knowledge_chunks_read_authenticated
  on public.knowledge_chunks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.knowledge_documents d
      where d.id = knowledge_chunks.document_id
        and d.status::text <> 'retired'
    )
  );

-- --------------------------------------------------------------- settings ---

create table if not exists public.knowledge_sync_settings (
  source text primary key check (source in ('woven')),

  /* Off until an administrator turns it on after the initial sync. */
  auto_sync_enabled boolean not null default false,
  interval_days integer not null default 30 check (interval_days between 7 and 90),

  initial_sync_completed_at timestamptz,
  last_full_scan_at timestamptz,
  last_success_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists knowledge_sync_settings_touch_updated_at on public.knowledge_sync_settings;
create trigger knowledge_sync_settings_touch_updated_at
  before update on public.knowledge_sync_settings
  for each row execute function public.touch_updated_at();

insert into public.knowledge_sync_settings (source) values ('woven')
  on conflict (source) do nothing;

-- ------------------------------------------------------------------- runs ---

create table if not exists public.knowledge_sync_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  source text not null check (source in ('woven')),

  mode text not null check (mode in ('preview', 'sync', 'continue')),
  trigger text not null check (trigger in ('schedule', 'manual')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'succeeded_with_warnings', 'failed')),

  /* `schedule`, or `admin:<email>` from a verified session. Never a secret. */
  requested_by text not null
    check (length(btrim(requested_by)) > 0 and length(requested_by) <= 120),

  /* Counts, per-type summaries and plain-language attention items. No record text, no URL. */
  report jsonb check (report is null or jsonb_typeof(report) = 'object'),

  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  error_detail text check (error_detail is null or length(error_detail) <= 500),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint knowledge_sync_runs_finished_after_start
    check (finished_at is null or finished_at >= started_at),
  constraint knowledge_sync_runs_finished_when_done
    check ((status = 'running') = (finished_at is null))
);

/* THE RUN LOCK: at most one live run per source. */
create unique index if not exists knowledge_sync_runs_one_live
  on public.knowledge_sync_runs (source)
  where status = 'running';

create index if not exists knowledge_sync_runs_recent
  on public.knowledge_sync_runs (source, started_at desc);

-- --------------------------------------------------------------- manifest ---

create table if not exists public.knowledge_sync_items (
  id uuid primary key default extensions.gen_random_uuid(),

  source text not null check (source in ('woven')),
  content_type text not null check (content_type in (
    'policy', 'handbook', 'procedure', 'file_library', 'knowledge_element', 'course'
  )),
  /* The source's stable id. Never a filename. */
  entity_id text not null check (length(entity_id) between 1 and 200),
  /* Which part of the record: `attachment:<id>`, `current-version`, `file`, `content`. */
  part_key text not null check (length(part_key) between 1 and 240),

  title text not null default '' check (length(title) <= 500),
  status text check (status is null or length(status) <= 120),
  audience text[],
  version text check (version is null or length(version) <= 120),
  version_id text check (version_id is null or length(version_id) <= 200),
  source_updated_at text check (source_updated_at is null or length(source_updated_at) <= 40),
  document_id text check (document_id is null or length(document_id) <= 200),
  attachment_ids text[] not null default '{}',
  locator jsonb
    check (locator is null or (jsonb_typeof(locator) = 'object'
      and locator::text !~* '(https?:|sig=|[?&]se=|blob\.core\.windows\.net)')),
  mime_type text check (mime_type is null or length(mime_type) <= 200),
  file_name text check (file_name is null or length(file_name) <= 300),

  observed_fingerprint text not null check (observed_fingerprint ~ '^[0-9a-f]{64}$'),
  synced_fingerprint text check (synced_fingerprint is null or synced_fingerprint ~ '^[0-9a-f]{64}$'),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),

  /*
   * The Ask Sunny document this item owns. `on delete set null`: if an
   * administrator deletes the document by hand, the manifest forgets it and the
   * next sync treats the item as not yet in Ask Sunny.
   */
  knowledge_document_id uuid references public.knowledge_documents (id) on delete set null,
  in_ask_sunny boolean not null default false,

  state text not null check (state in (
    'NEW', 'UPDATED', 'UNCHANGED', 'PERMISSION_CHANGED', 'UNPUBLISHED',
    'REMOVED', 'BLOCKED', 'ERROR', 'NEEDS_REVIEW', 'EXCLUDED'
  )),
  previous_state text check (previous_state is null or previous_state in (
    'NEW', 'UPDATED', 'UNCHANGED', 'PERMISSION_CHANGED', 'UNPUBLISHED',
    'REMOVED', 'BLOCKED', 'ERROR', 'NEEDS_REVIEW', 'EXCLUDED'
  )),
  pending_action text not null default 'none' check (pending_action in ('none', 'ingest', 'retire')),
  reason text check (reason is null or reason ~ '^[a-z][a-z0-9_:]{0,79}$'),

  last_error text check (last_error is null or length(last_error) <= 300),
  error_category text check (error_category is null or error_category ~ '^[a-z][a-z0-9_]{0,63}$'),
  retry_count integer not null default 0 check (retry_count >= 0),
  next_retry_at timestamptz,

  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* IDEMPOTENCY: one row per source item part, whatever a retry does. */
  constraint knowledge_sync_items_identity unique (source, content_type, entity_id, part_key)
);

/* NO DUPLICATES IN ASK SUNNY: a knowledge document has at most one owner. */
create unique index if not exists knowledge_sync_items_one_owner
  on public.knowledge_sync_items (knowledge_document_id)
  where knowledge_document_id is not null;

create index if not exists knowledge_sync_items_pending
  on public.knowledge_sync_items (source, pending_action, next_retry_at)
  where pending_action <> 'none';

create index if not exists knowledge_sync_items_state
  on public.knowledge_sync_items (source, state);

drop trigger if exists knowledge_sync_items_touch_updated_at on public.knowledge_sync_items;
create trigger knowledge_sync_items_touch_updated_at
  before update on public.knowledge_sync_items
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------- audit log ---

create table if not exists public.knowledge_sync_events (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.knowledge_sync_runs (id) on delete cascade,
  content_type text not null check (content_type in (
    'policy', 'handbook', 'procedure', 'file_library', 'knowledge_element', 'course'
  )),
  entity_id text not null check (length(entity_id) between 1 and 200),
  part_key text not null check (length(part_key) between 1 and 240),
  action text not null check (action in ('ingest', 'update', 'metadata_only', 'retire', 'skip')),
  result text not null check (result in ('ok', 'error')),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error_category text check (error_category is null or error_category ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_sync_events_run
  on public.knowledge_sync_events (run_id);
create index if not exists knowledge_sync_events_item
  on public.knowledge_sync_events (content_type, entity_id, created_at desc);

-- ------------------------------------------------------ audience decisions ---

create table if not exists public.knowledge_sync_audience_decisions (
  source text not null check (source in ('woven')),
  audience_key text not null check (length(audience_key) between 1 and 500),
  decision text not null check (decision in ('company_wide', 'excluded')),
  decided_by text not null check (length(btrim(decided_by)) > 0 and length(decided_by) <= 120),
  decided_at timestamptz not null default now(),
  primary key (source, audience_key)
);

-- ----------------------------------------------------------------- access ---

alter table public.knowledge_sync_settings           enable row level security;
alter table public.knowledge_sync_runs               enable row level security;
alter table public.knowledge_sync_items              enable row level security;
alter table public.knowledge_sync_events             enable row level security;
alter table public.knowledge_sync_audience_decisions enable row level security;

alter table public.knowledge_sync_settings           force row level security;
alter table public.knowledge_sync_runs               force row level security;
alter table public.knowledge_sync_items              force row level security;
alter table public.knowledge_sync_events             force row level security;
alter table public.knowledge_sync_audience_decisions force row level security;

revoke all on public.knowledge_sync_settings           from anon, authenticated;
revoke all on public.knowledge_sync_runs               from anon, authenticated;
revoke all on public.knowledge_sync_items              from anon, authenticated;
revoke all on public.knowledge_sync_events             from anon, authenticated;
revoke all on public.knowledge_sync_audience_decisions from anon, authenticated;

comment on table public.knowledge_sync_items is
  'Manifest of source knowledge items (Woven) and the Ask Sunny document each owns. Server-only.';
comment on table public.knowledge_sync_runs is
  'One row per knowledge sync attempt; the partial unique index is the run lock. Server-only.';
comment on table public.knowledge_sync_events is
  'Per-item audit log of knowledge sync actions. Codes and hashes only. Server-only.';
