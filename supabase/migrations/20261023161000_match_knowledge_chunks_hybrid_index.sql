-- Ask Sunny — faster hybrid retrieval.
--
-- Replaces the body of match_knowledge_chunks_hybrid. Same arguments, same
-- columns. Does not edit 20261023001000 (already applied) and does not change
-- match_knowledge_chunks, the embedding column, or the indexes.
--
-- The previous body materialized every visible chunk, then ranked that copy.
-- A materialized CTE has no HNSW index and no GIN index, so both legs scanned
-- the whole scope (about 4.5s, sometimes the 8s statement_timeout).
--
-- This body asks the base table for a small candidate set:
--   * vector: ORDER BY embedding <=> query LIMIT k, visibility in WHERE,
--     so the HNSW index can return the nearest rows. hnsw.iterative_scan
--     lets that index apply the visibility filter instead of sorting the scope;
--   * keyword: content_tsv @@ an OR tsquery of the significant words
--     (websearch_to_tsquery, words joined by OR), so the GIN index is used
--     and a glossary line appended to the question is optional, not required;
--   * the final select joins only those candidate ids.
--
-- statement_timeout is 6s on the function. The app gives up sooner and uses
-- match_knowledge_chunks.

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
set statement_timeout = '6s'
set hnsw.iterative_scan = 'strict_order'
as $$
  with keyword_query as (
    select case
      when coalesce(btrim(words), '') = '' then null::tsquery
      else nullif(websearch_to_tsquery('english', words), ''::tsquery)
    end as tsq
    from (
      select string_agg(word, ' OR ' order by word) as words
      from (
        select distinct word
        from regexp_split_to_table(lower(coalesce(query_text, '')), '[^a-z0-9]+') as word
        where char_length(word) >= 3
          and word !~ '^[0-9]+$'
      ) significant
    ) joined
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
      from public.knowledge_chunks c
      where c.knowledge_scope_id = scope_id
        and exists (
          select 1
          from public.knowledge_documents d
          where d.id = c.document_id
            and d.indexed = true
            and d.status = 'indexed'
            and d.version = c.version
            and (filter_categories is null or d.category = any (filter_categories))
        )
      order by c.embedding operator(extensions.<=>) query_embedding
      limit greatest(1, least(match_count, 50))
    ) nearest
    where nearest.similarity >= min_similarity
  ),
  keyword_hits as (
    select
      ranked.id,
      row_number() over (order by ranked.rank desc) as keyword_rank
    from (
      select
        c.id,
        ts_rank_cd(c.content_tsv, (select keyword_query.tsq from keyword_query)) as rank
      from public.knowledge_chunks c
      where (select keyword_query.tsq from keyword_query) is not null
        and c.knowledge_scope_id = scope_id
        and c.content_tsv @@ (select keyword_query.tsq from keyword_query)
        and exists (
          select 1
          from public.knowledge_documents d
          where d.id = c.document_id
            and d.indexed = true
            and d.status = 'indexed'
            and d.version = c.version
            and (filter_categories is null or d.category = any (filter_categories))
        )
      order by ts_rank_cd(c.content_tsv, (select keyword_query.tsq from keyword_query)) desc
      limit greatest(1, least(match_count, 50))
    ) ranked
  ),
  candidates as (
    select vector_hits.id from vector_hits
    union
    select keyword_hits.id from keyword_hits
  )
  select
    c.id as chunk_id,
    c.document_id,
    d.title as document_title,
    d.category,
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
    (
      c.section is not null
      and char_length(btrim(c.section)) >= 4
      and strpos(lower(coalesce(query_text, '')), lower(btrim(c.section))) > 0
    ) as section_exact
  from candidates ids
  join public.knowledge_chunks c
    on c.id = ids.id
  join public.knowledge_documents d
    on d.id = c.document_id
  left join vector_hits v
    on v.id = c.id
  left join keyword_hits k
    on k.id = c.id
  where c.knowledge_scope_id = scope_id
    and d.indexed = true
    and d.status = 'indexed'
    and c.version = d.version
    and (filter_categories is null or d.category = any (filter_categories));
$$;

comment on function public.match_knowledge_chunks_hybrid is
  'Keyword OR-query and vector candidates for one scope, read through the HNSW and GIN indexes, plus an exact section-title flag on those candidates. The app fuses the ranks. Does not replace match_knowledge_chunks.';

revoke execute on function public.match_knowledge_chunks_hybrid(
  extensions.vector, text, text, integer, double precision, text[]
) from public, anon;

grant execute on function public.match_knowledge_chunks_hybrid(
  extensions.vector, text, text, integer, double precision, text[]
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rollback. Restores the function body from
-- 20261023001000_knowledge_hybrid_search.sql. Not applied by this migration.
-- Copy the block below and run it to put the previous body back.
-- ---------------------------------------------------------------------------
/*
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
*/
