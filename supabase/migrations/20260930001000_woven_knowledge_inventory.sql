-- ---------------------------------------------------------------------------
-- Woven knowledge sync: the dry run's inventory, and record titles.
-- ---------------------------------------------------------------------------
--
-- WHY. A dry run ("Run Initial Scan") deliberately writes nothing to the
-- manifest, so before the initial sync the admin screen had only aggregate
-- counts. It said "29 wait for an audience choice" and had nothing to render
-- those choices from, and it could not list what Woven actually holds.
--
--   knowledge_sync_preview_items   the LATEST dry run's inventory, replaced by
--                                  each dry run: one row per source item part,
--                                  display metadata only.
--   knowledge_sync_items.record_title
--                                  the source record's own title (a policy's
--                                  name), shared by its parts, so the screen can
--                                  show one row per Woven item.
--
-- NOTHING SECRET OR BULKY IS STORABLE. The inventory has no locator, no
-- fingerprint, no content hash and no document text: titles, the source's
-- status and audience labels, version, dates and the classification. The
-- same check the manifest applies to its locator is applied to file names.
--
-- ACCESS: RLS enabled AND forced with no policies, and every privilege
-- revoked from `anon` and `authenticated`, like every knowledge_sync_* table.
-- Only the server, under the secret key, reads or writes it.
--
-- ADDITIVE ONLY: one new table and one new nullable column. Nothing existing
-- is changed or dropped; re-running it is a no-op.
-- ---------------------------------------------------------------------------

alter table public.knowledge_sync_items
  add column if not exists record_title text
    check (record_title is null or length(record_title) <= 500);

create table if not exists public.knowledge_sync_preview_items (
  source text not null check (source in ('woven')),
  /* The dry run that produced this row. */
  run_id uuid not null references public.knowledge_sync_runs (id) on delete cascade,
  content_type text not null check (content_type in (
    'policy', 'handbook', 'procedure', 'file_library', 'knowledge_element', 'course'
  )),
  entity_id text not null check (length(entity_id) between 1 and 200),
  part_key text not null check (length(part_key) between 1 and 240),

  record_title text check (record_title is null or length(record_title) <= 500),
  title text not null default '' check (length(title) <= 500),
  status text check (status is null or length(status) <= 120),
  audience text[],
  version text check (version is null or length(version) <= 120),
  source_updated_at text check (source_updated_at is null or length(source_updated_at) <= 40),
  file_name text
    check (file_name is null or (length(file_name) <= 300
      and file_name !~* '(https?:|sig=|[?&]se=|blob\.core\.windows\.net)')),

  state text not null check (state in (
    'NEW', 'UPDATED', 'UNCHANGED', 'PERMISSION_CHANGED', 'UNPUBLISHED',
    'REMOVED', 'BLOCKED', 'ERROR', 'NEEDS_REVIEW', 'EXCLUDED'
  )),
  reason text check (reason is null or reason ~ '^[a-z][a-z0-9_:]{0,79}$'),
  pending_action text not null default 'none' check (pending_action in ('none', 'ingest', 'retire')),

  first_seen_at timestamptz not null,
  observed_at timestamptz not null,

  primary key (source, content_type, entity_id, part_key)
);

create index if not exists knowledge_sync_preview_items_run
  on public.knowledge_sync_preview_items (run_id);

alter table public.knowledge_sync_preview_items enable row level security;
alter table public.knowledge_sync_preview_items force row level security;
revoke all on public.knowledge_sync_preview_items from anon, authenticated;
