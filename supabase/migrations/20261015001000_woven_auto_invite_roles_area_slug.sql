-- ============================================================================
-- WOVEN AUTOMATIC INVITATIONS — ASD, SD, DM, RM only — part 1 of 3: area slug helper
-- ============================================================================
--
-- The original single migration timed out repeatedly when applied to Production
-- through the Supabase connector (60 s limit; ~10 DDL statements, each firing the
-- project's DDL event triggers). It was split, unapplied anywhere, into three
-- independently verifiable migrations applied in this order:
--
--   20261015001000  area_slug      a pure text helper (no data access)
--   20261015001100  salon_area     a salon's current and previous district/region labels
--   20261015001200  provision      the role / scope / location re-proof (drops the 7-argument function)
--
-- Additive and inert: nothing calls this until part 3.
--
-- See part 3 for the policy this implements (owner instructions of 15 and 16 Oct 2026).

/* Same slug as src/lib/reporting/scope/area-ids.ts: lower-case, runs of non [a-z0-9] become '-', trimmed. */
create or replace function public.employee_access_area_slug(p_label text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(btrim(coalesce(p_label, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

revoke all on function public.employee_access_area_slug(text) from public, anon, authenticated, service_role;
