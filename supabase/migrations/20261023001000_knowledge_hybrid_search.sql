-- Ask Sunny — additive hybrid retrieval.
--
-- Adds a generated tsvector, a GIN index, and match_knowledge_chunks_hybrid.
-- Does not alter or replace the existing similarity function, the embedding
-- column, or any existing index. Chat keeps using the existing function until
-- HYBRID_SEARCH_ENABLED is turned on.
--
-- The new function argument is an unconstrained vector. The column width is
-- already the gte-small width; a mismatched query vector fails the distance
-- operator rather than matching the wrong rows.

alter table public.knowledge_chunks
  add column if not exists content_tsv tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(section, '') || ' ' || coalesce(locator, '') || ' ' || coalesce(content, '')
    )
  ) stored;

create index if not exists knowledge_chunks_content_tsv_idx
  on public.knowledge_chunks
  using gin (content_tsv);

comment on column public.knowledge_chunks.content_tsv is
  'English tsvector of section, locator, and content for hybrid keyword retrieval. Generated; not written by the app.';

create or replace function public.match_knowledge_chunks_hybrid(
  query_embedding extensions.vector,
  query_text text,
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
  similarity double precision,
  vector_rank integer,
  keyword_rank integer,
  section_exact boolean
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with visible as (
    select
      c.id,
      c.document_id,
      d.title as document_title,
      d.category,
      c.locator,
      c.page,
      c.section,
      c.content,
      c.embedding,
      c.content_tsv
    from public.knowledge_chunks c
    join public.knowledge_documents d
      on d.id = c.document_id
    where c.knowledge_scope_id = scope_id
      and d.indexed = true
      and d.status = 'indexed'
      and c.version = d.version
      and (filter_categories is null or d.category = any (filter_categories))
  ),
  vector_hits as (
    select
      nearest.id,
      nearest.similarity,
      row_number() over (order by nearest.similarity desc) as vector_rank
    from (
      select
        c.id,
        1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
      from visible c
      where 1 - (c.embedding operator(extensions.<=>) query_embedding) >= min_similarity
      order by c.embedding operator(extensions.<=>) query_embedding
      limit greatest(1, least(match_count, 50))
    ) nearest
  ),
  keyword_hits as (
    select ranked.id, ranked.keyword_rank
    from (
      select
        c.id,
        row_number() over (
          order by ts_rank_cd(c.content_tsv, plainto_tsquery('english', query_text)) desc
        ) as keyword_rank
      from visible c
      where char_length(btrim(query_text)) > 0
        and c.content_tsv @@ plainto_tsquery('english', query_text)
    ) ranked
    where ranked.keyword_rank <= greatest(1, least(match_count, 50))
  ),
  section_hits as (
    select c.id
    from visible c
    where c.section is not null
      and char_length(btrim(c.section)) >= 4
      and strpos(lower(query_text), lower(btrim(c.section))) > 0
  )
  select
    c.id as chunk_id,
    c.document_id,
    c.document_title,
    c.category,
    c.locator,
    c.page,
    c.section,
    c.content,
    coalesce(
      v.similarity,
      1 - (c.embedding operator(extensions.<=>) query_embedding)
    ) as similarity,
    v.vector_rank,
    k.keyword_rank,
    (s.id is not null) as section_exact
  from visible c
  left join vector_hits v on v.id = c.id
  left join keyword_hits k on k.id = c.id
  left join section_hits s on s.id = c.id
  where v.id is not null or k.id is not null or s.id is not null;
$$;

comment on function public.match_knowledge_chunks_hybrid is
  'Keyword and vector candidates for one scope, plus an exact section-title hit. The app fuses the ranks. Does not replace the existing similarity function.';

revoke execute on function public.match_knowledge_chunks_hybrid(
  extensions.vector, text, text, integer, double precision, text[]
) from public, anon;

grant execute on function public.match_knowledge_chunks_hybrid(
  extensions.vector, text, text, integer, double precision, text[]
) to authenticated, service_role;
