-- Ask Sunny — company knowledge base schema.
--
-- Field names map onto the existing KnowledgeDocument / KnowledgeChunk types in
-- src/types/index.ts. Where the TypeScript name is camelCase the column is the
-- snake_case equivalent; the mapping lives in src/lib/knowledge/mappers.ts and
-- nowhere else.
--
-- EMBEDDING DIMENSION: vector(1024) below is NOT a guess. It is the output
-- dimension of the embedding model selected in src/lib/config/models.ts
-- (voyage-4-lite, output_dimension 1024). Changing the embedding model to one
-- with a different width requires a NEW migration that alters this column and
-- re-embeds every chunk — see supabase/README.md. The application refuses to
-- run retrieval when the two disagree rather than returning empty results.

-- Processing lifecycle. Maps to the DocumentStatus union the UI already
-- renders: uploading + processing -> "processing", indexed -> "ready" with
-- indexed = true, failed -> "failed".
create type public.knowledge_document_status as enum (
  'uploading',
  'processing',
  'indexed',
  'failed'
);

create type public.knowledge_document_source as enum (
  'upload',
  'sharepoint',
  'woven',
  'system'
);

create table public.knowledge_documents (
  id                uuid primary key default extensions.gen_random_uuid(),

  -- Brand corpus this document belongs to (BrandConfig.knowledgeScopeId).
  knowledge_scope_id text not null,

  title             text not null,
  description       text not null default '',
  category          text not null default 'other',
  tags              text[] not null default '{}',

  original_filename text not null,
  mime_type         text not null,
  file_type         text not null,
  -- Object key inside the private Storage bucket. Server-generated; never
  -- supplied by a client. See src/lib/ingestion/paths.ts.
  storage_path      text not null,
  size_bytes        bigint not null check (size_bytes >= 0),
  character_count   integer not null default 0,

  source            public.knowledge_document_source not null default 'upload',
  status            public.knowledge_document_status not null default 'uploading',
  -- Mirrors KnowledgeDocument.indexed. Set true ONLY by the ingestion
  -- transaction, after every chunk for the current version is persisted.
  indexed           boolean not null default false,
  -- User-facing reason a failed document failed. Never contains document text.
  failure_reason    text,

  version           integer not null default 1 check (version >= 1),
  -- Version history as [{version, uploadedAt, uploadedBy, sizeBytes, note}],
  -- matching the DocumentVersion type the details view already renders.
  previous_versions jsonb not null default '[]'::jsonb,

  -- Digest of the extracted text for the current version. Lets re-ingestion
  -- skip embedding work when the content has not actually changed.
  content_hash      text,

  -- auth.users id once authentication exists. Nullable until then; the display
  -- name is kept separately so the library listing works before auth ships.
  uploaded_by       uuid references auth.users (id) on delete set null,
  uploaded_by_name  text not null default 'Unknown',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  indexed_at        timestamptz,

  constraint knowledge_documents_scope_storage_path_key
    unique (knowledge_scope_id, storage_path),
  -- A document cannot claim to be indexed without a completed run.
  constraint knowledge_documents_indexed_requires_status
    check (indexed = false or (status = 'indexed' and indexed_at is not null))
);

create index knowledge_documents_scope_idx
  on public.knowledge_documents (knowledge_scope_id, updated_at desc);
create index knowledge_documents_status_idx
  on public.knowledge_documents (status)
  where status in ('uploading', 'processing', 'failed');

create table public.knowledge_chunks (
  id           uuid primary key default extensions.gen_random_uuid(),
  document_id  uuid not null
    references public.knowledge_documents (id) on delete cascade,

  -- Denormalised so retrieval can filter by scope without a join.
  knowledge_scope_id text not null,

  -- 0-based position within the document version. Deterministic: the chunker
  -- produces the same indexes for the same input every time.
  chunk_index  integer not null check (chunk_index >= 0),
  -- The document version these chunks were produced from. Chunks for an
  -- outdated version are deleted when a new version finishes indexing.
  version      integer not null default 1 check (version >= 1),

  content      text not null,
  -- Citation label rendered on the source card, e.g. 'Page 14'.
  locator      text not null,
  page         integer,
  section      text,

  -- Free-form ingestion metadata (token estimate, char count, extractor).
  metadata     jsonb not null default '{}'::jsonb,

  -- Recorded per row so a model change is detectable rather than silent.
  embedding_model text not null,
  embedding    extensions.vector(1024) not null,

  created_at   timestamptz not null default now(),

  constraint knowledge_chunks_document_version_index_key
    unique (document_id, version, chunk_index)
);

create index knowledge_chunks_document_idx
  on public.knowledge_chunks (document_id, version, chunk_index);
create index knowledge_chunks_scope_idx
  on public.knowledge_chunks (knowledge_scope_id);

-- HNSW over cosine distance. Chosen over IVFFlat because it needs no training
-- pass and stays accurate as the corpus grows from ~56 documents upward.
create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- Keep updated_at honest without application code having to remember.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger knowledge_documents_touch_updated_at
  before update on public.knowledge_documents
  for each row execute function public.touch_updated_at();
