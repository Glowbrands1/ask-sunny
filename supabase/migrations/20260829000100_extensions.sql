-- Ask Sunny — required Postgres extensions.
--
-- pgvector powers similarity search over knowledge_chunks.embedding.
-- pgcrypto provides gen_random_uuid() for primary keys.
--
-- Supabase convention: extensions live in the `extensions` schema, not public.

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
