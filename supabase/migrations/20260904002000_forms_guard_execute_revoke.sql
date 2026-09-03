-- FORMS: the two trigger guards must not be callable through the REST API.
--
-- `forms_guard_published_version()` and `forms_guard_finalized_values()` are
-- TRIGGER functions. Postgres grants EXECUTE on a new function to PUBLIC, and
-- PostgREST exposes anything executable at /rest/v1/rpc/<name>, so both were
-- reachable by `anon` and `authenticated` as SECURITY DEFINER functions — the
-- exact pair of warnings the Supabase security advisor raised after the Forms
-- migration landed.
--
-- Calling a trigger function directly raises "trigger functions can only be
-- called as triggers", so this was not an exploitable hole. It is still an
-- unnecessary definer-rights entry point on the public API surface, and the
-- rest of this schema already revokes everything from those roles rather than
-- relying on a table's RLS to be the only thing standing there. The functions
-- keep SECURITY DEFINER, because the invariant they enforce — a published
-- template version and a finalized form's values are immutable — has to hold
-- for every writer, including one added later.
--
-- Reporting's own functions were hardened the same way in
-- 20260831001700_reporting_ingestion_functions.sql. This is that pattern,
-- applied to the two functions the Forms migration added and nothing else: no
-- reporting object is touched.

revoke all on function public.forms_guard_published_version() from public, anon, authenticated;
revoke all on function public.forms_guard_finalized_values()  from public, anon, authenticated;

-- COVERING INDEXES for the Forms foreign keys the performance advisor flagged.
--
-- Only the ones a query actually walks:
--
--   form_instances.template_version_id     — every Form Monitoring row joins to
--     its version to print "v2". Unindexed, that is a sequential scan of the
--     versions table per row.
--   form_instances.revises_instance_id     — following a revision back to what
--     it replaced, and the ON DELETE check that runs on every version delete.
--   form_template_assets.superseded_by     — walking a template's PDF history.
--
-- form_template_current.version_id is DELIBERATELY LEFT ALONE. That table holds
-- one row per template — nine of them — and Postgres will never choose an index
-- over a scan of a page. Adding one would trade a write cost for nothing and
-- earn an "unused index" notice instead. The advisor's INFO on it stands, and
-- this comment is the answer to it.
--
-- No reporting table is touched.

create index if not exists form_instances_by_version
  on public.form_instances (template_version_id);

create index if not exists form_instances_by_revised
  on public.form_instances (revises_instance_id)
  where revises_instance_id is not null;

create index if not exists form_template_assets_by_superseded
  on public.form_template_assets (superseded_by)
  where superseded_by is not null;
