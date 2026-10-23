-- Additive fuzzy section-title match for RETRIEVAL_RECALL_ENABLED.
-- Adds pg_trgm, a GIN index on headings, and match_knowledge_sections_fuzzy.
-- Does not alter the existing similarity function or its embedding column.

create extension if not exists pg_trgm with schema extensions;

create index if not exists knowledge_chunks_section_trgm_idx
  on public.knowledge_chunks
  using gin (section extensions.gin_trgm_ops);

create or replace function public.match_knowledge_sections_fuzzy(
  query_text text,
  scope_id text,
  match_count integer default 8,
  min_similarity double precision default 0.3
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
  section_similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.id as chunk_id,
    c.document_id,
    d.title as document_title,
    d.category,
    c.locator,
    c.page,
    c.section,
    c.content,
    word_similarity(query_text, c.section) as section_similarity
  from public.knowledge_chunks c
  join public.knowledge_documents d
    on d.id = c.document_id
  where c.knowledge_scope_id = scope_id
    and d.indexed = true
    and d.status = 'indexed'
    and c.version = d.version
    and c.section is not null
    and char_length(btrim(query_text)) > 0
    and word_similarity(query_text, c.section) >= min_similarity
  order by word_similarity(query_text, c.section) desc
  limit greatest(1, least(match_count, 50));
$$;

comment on function public.match_knowledge_sections_fuzzy is
  'Fuzzy heading matches for one scope, using trigram similarity. Does not replace the existing similarity function.';

revoke execute on function public.match_knowledge_sections_fuzzy(text, text, integer, double precision)
  from public, anon;

grant execute on function public.match_knowledge_sections_fuzzy(text, text, integer, double precision)
  to authenticated, service_role;
