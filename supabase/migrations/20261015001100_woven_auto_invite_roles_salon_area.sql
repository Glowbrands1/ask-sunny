-- ============================================================================
-- WOVEN AUTOMATIC INVITATIONS — ASD, SD, DM, RM only — part 2 of 3: salon area helper
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
-- Additive and inert: nothing calls this until part 3. Reads reporting tables; it never creates, alters or drops one.
--
-- See part 3 for the policy this implements (owner instructions of 15 and 16 Oct 2026).

drop function if exists public.employee_access_salon_area(text);

/*
 * A salon's CURRENT district / region label (its newest non-superseded reporting
 * period) and the labels of the period BEFORE it, so a recent move is visible.
 */
create or replace function public.employee_access_salon_area(p_salon_number text)
returns table (district_label text, region_label text, previous_district_label text, previous_region_label text)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select a.district_label, a.region_label,
           row_number() over (order by rp.period_end desc, rp.period_start desc) as rn
      from public.salon_period_attributes a
      join public.salons s on s.id = a.salon_id
      join public.report_periods rp on rp.id = a.period_id
     where s.salon_number = p_salon_number
       and a.superseded_by_ingestion_id is null
       and (a.district_label is not null or a.region_label is not null)
  )
  select c.district_label, c.region_label, p.district_label, p.region_label
    from ranked c
    left join ranked p on p.rn = 2
   where c.rn = 1;
$$;

revoke all on function public.employee_access_salon_area(text) from public, anon, authenticated, service_role;
