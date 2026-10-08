-- ============================================================================
-- KEYWORD RETRIEVAL BESIDE THE VECTOR SEARCH
-- ============================================================================
--
-- ASK SUNNY FEEDBACK, 6 OCTOBER 2026. A manager asked for coaching material on
-- "getting checking accounts put onto client profiles" and Sunny said the
-- knowledge base had nothing on why checking accounts are preferred. It does —
-- the TC Mastery activity books answer it word for word — but the question was
-- phrased as a coaching request, so every one of the fourteen vector matches
-- was a coaching framework and the documents that actually say "checking
-- account" never reached the prompt.
--
-- Embeddings match meaning; they lose the specific term the manager typed. So
-- this adds a second, lexical leg the application fuses with the first
-- (`lib/knowledge/hybrid.ts`). Nothing about the vector search changes.
--
-- RANKED BY HOW RARE THE MATCHED WORDS ARE. A word in a thousand chunks
-- ("client") says little; a phrase in twenty-five ("checking account") says a
-- lot. Each query unit is weighted by inverse document frequency over the
-- chunks the caller may see, and a chunk's score is the sum over the units it
-- contains. Adjacent word pairs are units too, so a chunk with the phrase
-- outranks one that merely has both words somewhere.
--
-- THE SAME VISIBILITY AS `match_knowledge_chunks`, clause for clause: one
-- brand corpus, the document indexed with status `indexed`, the chunk on the
-- document's current version, the optional category filter. Woven audience
-- holds and exclusions are decided at ingestion — a held or excluded part never
-- becomes an indexed document — so they bind here exactly as they bind there.
-- Superseded uploads are not `indexed` and are not seen.
--
-- INPUT IS DATA, NEVER QUERY SYNTAX. Each term goes through `plainto_tsquery`
-- and each pair through `phraseto_tsquery`, which accept any text and cannot
-- raise a syntax error; both arrays are capped.

-- ============================================================================
-- LOCKING, AND WHY THE TIMEOUTS
-- ============================================================================
--
-- Adding a STORED generated column rewrites `knowledge_chunks` under an ACCESS
-- EXCLUSIVE lock and rebuilds every index on it, the HNSW embedding index
-- included. Nothing can read or write the table until it commits: chat
-- retrieval waits, the Woven knowledge sync waits. 13,455 rows in Ask Sunny;
-- measured at about 17 s on a production-sized copy under PGlite.
--
-- LOCK TIMEOUT. A lock request queues behind any open transaction on the
-- table, and every reader that arrives after it queues behind IT — a waiting
-- ALTER stalls the whole application as surely as a running one. Five seconds,
-- then fail cleanly with nothing changed, and retry in a quieter minute.
--
-- STATEMENT TIMEOUT. The role default (2 min in production) is raised so the
-- rewrite and HNSW rebuild cannot be cut off half way; ten minutes is a
-- ceiling, not an estimate.
--
-- PLAIN SET, NOT SET LOCAL. Inside a transaction the settings revert on
-- rollback; outside one, SET LOCAL would silently do nothing. Both are reset
-- at the end either way.
--
-- RUN IT AT A QUIET TIME, NOT AT :35–:45 PAST THE HOUR, when the Woven sync
-- writes chunks. See docs/ask-sunny-feedback-2026-10-07.md.

set lock_timeout = '5s';
set statement_timeout = '10min';

alter table public.knowledge_chunks
  add column if not exists content_tsv tsvector
  generated always as (
    to_tsvector('english'::regconfig, coalesce(section, '') || ' ' || coalesce(content, ''))
  ) stored;

create index if not exists knowledge_chunks_content_tsv_idx
  on public.knowledge_chunks using gin (content_tsv);

create or replace function public.match_knowledge_chunks_keyword(
  query_terms text[],
  query_phrases text[],
  scope_id text,
  match_count integer default 8,
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
  keyword_score double precision,
  matched_units integer
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  -- MATERIALIZED, EACH SET ONCE. Postgres cannot estimate how many chunks a
  -- tsquery built at run time will match, so it guesses one; given that guess
  -- it inlined the weights into a nested loop and recomputed them, corpus
  -- count included, once per candidate chunk. That is quadratic: a few ms for
  -- a rare phrase, past the 8 s statement timeout for common words. Each set
  -- below is computed once, and each chunk is tested against each unit once.
  with units as materialized (
    select q, row_number() over () as unit_id
    from (
      select distinct q
      from (
        select plainto_tsquery('english'::regconfig, t) as q
          from unnest(coalesce(query_terms, '{}'::text[])) with ordinality as x(t, n)
          where n <= 24
        union all
        select phraseto_tsquery('english'::regconfig, p)
          from unnest(coalesce(query_phrases, '{}'::text[])) with ordinality as y(p, n)
          where n <= 16
      ) parsed
      where numnode(q) > 0
    ) distinct_units
  ),
  -- Any unit at all, so the candidate scan can use the GIN index. Built from
  -- tsquery values' own text, never from the caller's.
  any_unit as materialized (
    select string_agg('(' || q::text || ')', ' | ')::tsquery as q from units
  ),
  candidates as materialized (
    select c.id, c.content_tsv
    from public.knowledge_chunks c
    join public.knowledge_documents d
      on d.id = c.document_id
    where c.knowledge_scope_id = scope_id
      and d.indexed = true
      and d.status = 'indexed'
      and c.version = d.version
      and (filter_categories is null or d.category = any (filter_categories))
      and c.content_tsv @@ (select q from any_unit)
  ),
  corpus as materialized (
    select count(*)::double precision as total
    from public.knowledge_chunks c
    join public.knowledge_documents d
      on d.id = c.document_id
    where c.knowledge_scope_id = scope_id
      and d.indexed = true
      and d.status = 'indexed'
      and c.version = d.version
      and (filter_categories is null or d.category = any (filter_categories))
  ),
  -- Which unit each candidate contains: the one pass of tsquery matching.
  hits as materialized (
    select v.id, u.unit_id
    from candidates v
    join units u on v.content_tsv @@ u.q
  ),
  -- A chunk containing a unit is a candidate, so counting candidates is
  -- counting the visible corpus.
  weighted as materialized (
    select h.unit_id, ln((corpus.total + 1) / (count(*) + 0.5)) as idf
    from hits h
    cross join corpus
    group by h.unit_id, corpus.total
  ),
  scored as materialized (
    select h.id, sum(w.idf) as score, count(*)::integer as matched
    from hits h
    join weighted w on w.unit_id = h.unit_id
    group by h.id
  ),
  top as (
    select id, score, matched
    from scored
    order by score desc, id
    limit greatest(1, least(match_count, 50))
  )
  select
    c.id          as chunk_id,
    d.id          as document_id,
    d.title       as document_title,
    d.category    as category,
    c.locator     as locator,
    c.page        as page,
    c.section     as section,
    c.content     as content,
    s.score       as keyword_score,
    s.matched     as matched_units
  from top s
  join public.knowledge_chunks c on c.id = s.id
  join public.knowledge_documents d on d.id = c.document_id
  order by s.score desc, c.id;
$$;

comment on function public.match_knowledge_chunks_keyword is
  'Lexical search over indexed knowledge chunks, scoped to one brand corpus with the same visibility as match_knowledge_chunks, ranked by the inverse document frequency of the matched terms and phrases. Runs security invoker so row level security applies to the calling role.';

-- The same end state as match_knowledge_chunks, stated beside the function.
revoke execute on function public.match_knowledge_chunks_keyword(
  text[], text[], text, integer, text[]
) from public, anon, authenticated;

grant execute on function public.match_knowledge_chunks_keyword(
  text[], text[], text, integer, text[]
) to authenticated;

reset lock_timeout;
reset statement_timeout;
