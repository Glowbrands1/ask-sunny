-- Ask Sunny — corrective migration: embedding width 1024 -> 384.
--
-- WHY. The embedding backend changed from an external vendor (Voyage AI,
-- 1024-dimension vectors over a REST API requiring VOYAGE_API_KEY) to the
-- `gte-small` model that runs natively inside Supabase Edge Functions. Its
-- output width is 384. See supabase/functions/embed/index.ts and
-- src/lib/config/models.ts, which are the two other places that number appears;
-- src/lib/config/embedding-dimensions.test.ts parses this file and fails if any
-- of them disagree.
--
-- WHY A NEW FILE RATHER THAN AN EDIT. 20260829000200, 20260829000300,
-- 20260829000400 and 20260831000600 are already applied to the live project.
-- Recorded migration history is not rewritten underneath a database that has
-- run it; the transition is expressed as a forward migration instead. Those
-- files still say vector(1024) on purpose — that is what they did — and this
-- one is the current state.
--
-- SAFETY. `alter column ... type extensions.vector(384)` re-checks every
-- existing row and fails on any vector of a different width. That is the right
-- behaviour, but it makes the migration abort halfway on a populated table, so
-- the guard below refuses up front with an explanation instead. The corpus is
-- empty today; if it is not when this runs, chunks must be deleted and their
-- documents re-ingested, because a 1024-dimension vector cannot be converted
-- into a 384-dimension one — the text has to be embedded again by the new
-- model.

do $$
declare
  chunk_count bigint;
begin
  select count(*) into chunk_count from public.knowledge_chunks;

  if chunk_count > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format(
        'Cannot narrow knowledge_chunks.embedding to vector(384): %s chunk(s) hold 1024-dimension vectors.',
        chunk_count
      ),
      hint = 'Delete every row in public.knowledge_chunks and re-ingest the affected documents so they are re-embedded with gte-small, then re-run this migration.';
  end if;
end;
$$;

-- The HNSW index is built over the column's declared type, so it must go before
-- the column changes and be rebuilt after. Dropping it first also means the
-- alter does not pay to maintain an index it is about to invalidate.
drop index if exists public.knowledge_chunks_embedding_idx;

alter table public.knowledge_chunks
  alter column embedding type extensions.vector(384);

create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- The argument type is part of a function's identity, so `create or replace`
-- with a narrower vector would ADD a second overload rather than replace the
-- first: two functions of the same name, and PostgREST would have to guess.
-- The 1024 signature is dropped explicitly.
drop function if exists public.match_knowledge_chunks(
  extensions.vector(1024), text, integer, double precision, text[]
);

-- Body identical to 20260829000300; only the argument width differs.
create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(384),
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
    and c.version = d.version
    and (filter_categories is null or d.category = any (filter_categories))
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by c.embedding operator(extensions.<=>) query_embedding
  limit greatest(1, least(match_count, 50));
$$;

comment on function public.match_knowledge_chunks is
  'Cosine similarity search over indexed knowledge chunks, scoped to one brand corpus. Runs security invoker so row level security applies to the calling role.';

-- A NEW function is a new privilege surface: it is created with the Postgres
-- default of EXECUTE to PUBLIC, which `anon` inherits. The revokes from
-- 20260831000600 named the old signature and do not carry over, so they are
-- re-issued here for the new one. Revoking from `anon` alone would not remove
-- the inherited PUBLIC grant — PUBLIC has to be named.
revoke execute on function public.match_knowledge_chunks(
  extensions.vector(384), text, integer, double precision, text[]
) from public, anon, authenticated;

grant execute on function public.match_knowledge_chunks(
  extensions.vector(384), text, integer, double precision, text[]
) to authenticated;
