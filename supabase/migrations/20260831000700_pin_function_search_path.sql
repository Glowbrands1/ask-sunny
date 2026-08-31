-- Ask Sunny — pin the trigger function's search_path.
--
-- Supabase's database linter reported `function_search_path_mutable` against
-- `public.touch_updated_at` after the first real migration run:
-- https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
--
-- A function with a mutable search_path resolves unqualified names against
-- whatever the caller's path says, so anyone able to create an object in a
-- schema earlier in that path can change what the function calls. The exposure
-- here is small — this is a trigger function, not SECURITY DEFINER, and the
-- browser-held roles cannot create objects in `public` — but the fix is one
-- clause and leaving a known finding open is worse than closing it.
--
-- 20260829000200_knowledge_schema.sql is corrected in Git so a fresh project
-- comes up pinned. This migration carries the same change for the project that
-- was already applied. Both converge; `create or replace` is idempotent.
--
-- The body references only `now()`, which resolves from pg_catalog regardless
-- of the search_path, so an empty path is safe.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
