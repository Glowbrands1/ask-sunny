-- ---------------------------------------------------------------------------
-- KNOWLEDGE DOCUMENTS: CURRENT / SUPERSEDED / RETIRED
--
-- A hand-uploaded document that a current Woven-synced copy replaces is
-- SUPERSEDED: kept (row, chunks, stored file) for audit, and never retrieved,
-- cited or used to ground a form.
--
-- NOTHING ELSE IS NEEDED FOR THAT. Every retrieval path already requires
-- `indexed = true and status = 'indexed'` (`match_knowledge_chunks`, the
-- official-manual and role-document reads), and the existing
-- `knowledge_documents_indexed_requires_status` check keeps a superseded row
-- from claiming it is indexed. So a superseded document does not score lower
-- — it is not a candidate at all.
--
-- WHAT THIS ADDS:
--   * `superseded` on `knowledge_document_status`;
--   * `superseded_by` — the CURRENT document that replaced this one (null
--     again if that document is ever deleted) — and `superseded_at`;
--   * a check that only a superseded row names a successor.
--
-- `ALTER TYPE ... ADD VALUE` may run in a transaction on PostgreSQL 12+; the
-- value is compared as text below, which is not a use of the new literal.
--
-- WHAT THIS DOES NOT CHANGE: retrieval functions, read policies, grants, the
-- `retired` state, and any existing row (every current row satisfies the
-- check, since `superseded_by` starts null).
--
-- REVERSIBLE PER DOCUMENT: restoring a superseded upload is
--   update knowledge_documents set status = 'indexed', indexed = true,
--     superseded_by = null, superseded_at = null where id = '<id>';
-- (its chunks were never removed).
-- ---------------------------------------------------------------------------

alter type public.knowledge_document_status add value if not exists 'superseded';

alter table public.knowledge_documents
  add column if not exists superseded_by uuid references public.knowledge_documents (id) on delete set null,
  add column if not exists superseded_at timestamptz;

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_successor_only_when_superseded;
alter table public.knowledge_documents
  add constraint knowledge_documents_successor_only_when_superseded
  check (superseded_by is null or status::text = 'superseded');

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_not_its_own_successor;
alter table public.knowledge_documents
  add constraint knowledge_documents_not_its_own_successor
  check (superseded_by is null or superseded_by <> id);

create index if not exists knowledge_documents_superseded_by_idx
  on public.knowledge_documents (superseded_by)
  where superseded_by is not null;

comment on column public.knowledge_documents.superseded_by is
  'The current document that replaced this one (a Woven-synced copy of a hand upload). Set only while status is superseded.';
