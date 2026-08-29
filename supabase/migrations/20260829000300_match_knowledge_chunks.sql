-- Ask Sunny — vector retrieval RPC.
--
-- Retrieval is a database function rather than a query assembled in the
-- application so that:
--   * the similarity threshold and scope filter are enforced server-side,
--   * the client never sends SQL,
--   * the function runs under `security invoker`, so RLS applies to the caller
--     exactly as it would to a direct select.
--
-- Returns cosine SIMILARITY in [0, 1] (1 - cosine distance), which is what
-- SourceCitation.relevance renders. Only indexed documents are searchable: a
-- document mid-processing must not be cited.

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1024),
  scope_id text,
  match_count integer default 8,
  min_similarity double precision default 0.0,
  filter_categories text[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  category text,
  locator text,
  page integer,
  section text,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.id            as chunk_id,
    d.id            as document_id,
    d.title         as document_title,
    d.category      as category,
    c.locator       as locator,
    c.page          as page,
    c.section       as section,
    c.content       as content,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.knowledge_chunks c
  join public.knowledge_documents d
    on d.id = c.document_id
  where c.knowledge_scope_id = scope_id
    and d.indexed = true
    and d.status = 'indexed'
    -- Only chunks belonging to the document's CURRENT version are eligible, so
    -- a superseded policy can never be cited as if it were live.
    and c.version = d.version
    and (filter_categories is null or d.category = any (filter_categories))
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by c.embedding operator(extensions.<=>) query_embedding
  limit greatest(1, least(match_count, 50));
$$;

comment on function public.match_knowledge_chunks is
  'Cosine similarity search over indexed knowledge chunks, scoped to one brand corpus. Runs security invoker so row level security applies to the calling role.';
