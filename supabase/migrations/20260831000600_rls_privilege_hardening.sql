-- Ask Sunny — corrective migration for two privilege defects in
-- 20260829000400_rls.sql, found by post-application verification.
--
-- 20260829000400 has been corrected in Git so a fresh project comes up right.
-- This migration exists because that project had ALREADY been applied, and a
-- recorded migration must not be silently rewritten underneath a live database.
-- Both files converge on the same end state; every statement here is idempotent
-- and re-running either is harmless.
--
-- DEFECT 1 — `authenticated` held INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
-- and TRIGGER on both knowledge tables.
--
--   Cause: Supabase ships `alter default privileges ... grant all on tables to
--   anon, authenticated`, so both roles are granted ALL the moment a table is
--   created in `public`. The original migration's `grant select ... to
--   authenticated` is additive and never removed the rest.
--
--   Impact: not exploitable as it stood. Row level security is enabled AND
--   forced on both tables, and no insert/update/delete policy exists for
--   `authenticated`, so the writes were refused. The defect is the loss of a
--   defence layer: one future permissive policy would have silently opened
--   writes that the schema comments explicitly say are not permitted.
--
-- DEFECT 2 — `anon` could EXECUTE public.match_knowledge_chunks.
--
--   Cause: Postgres grants EXECUTE on every new function to PUBLIC, which
--   `anon` inherits. `revoke execute ... from anon` does not remove a PUBLIC
--   grant, so the original revoke had no effect on the inherited privilege.
--
--   Impact: no data disclosure. The function is `security invoker`, so it runs
--   with the caller's privileges, and `anon` holds no privileges on either
--   table — the call errors rather than returning rows. But "anonymous access
--   is not granted to internal knowledge" was not true as written, and relying
--   on the absence of a table grant to make a function grant safe is exactly
--   the single-layer assumption this schema is meant to avoid.

-- Remove every inherited privilege from the browser-held roles first...
revoke all on public.knowledge_documents from anon, authenticated;
revoke all on public.knowledge_chunks    from anon, authenticated;

revoke execute on function public.match_knowledge_chunks(
  extensions.vector(1024), text, integer, double precision, text[]
) from public, anon, authenticated;

-- ...then grant back only what the threat model actually intends:
-- read-only access for signed-in employees, once authentication ships.
grant select on public.knowledge_documents to authenticated;
grant select on public.knowledge_chunks    to authenticated;
grant execute on function public.match_knowledge_chunks(
  extensions.vector(1024), text, integer, double precision, text[]
) to authenticated;

-- `service_role` is untouched: it bypasses RLS by design and is the only role
-- that writes, used exclusively from server-side route handlers holding
-- SUPABASE_SECRET_KEY.
