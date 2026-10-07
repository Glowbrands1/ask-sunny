-- ============================================================================
-- ONE-TIME, APPROVED DATA CHANGE — NOT A MIGRATION. Run only with approval.
-- ============================================================================
--
-- Owner decision, 6 Oct 2026: the 16 already-confirmed Salon Director /
-- Assistant Salon Director links take part in the termination lifecycle.
-- For exactly these links:
--
--   managed_status   = true    an explicit Woven Terminated disables the account
--   managed_role     = false   Woven never changes their role
--   managed_location = false   Woven never changes their salon
--
-- Nothing else changes: no account, role, scope, salon or status; no auth
-- user; no other link. Admins, protected overrides, District Managers, HR,
-- Operations and other senior or special accounts are NOT in this list and
-- are refused by the conditions below even if one were added by mistake.
--
-- SAFE TO RUN TWICE. It refuses, changing nothing, unless all 16 links exist
-- and each still is what was approved: woven_linked by a person, a salon-level
-- Salon Director / Assistant Salon Director, not protected, not disabled, and
-- Active in Woven's latest read in an approved SD/ASD position.
--
-- Uses the managed-flags mechanism of 20261006001000_woven_adoption_and_credentials
-- (only the three flags change; the link guard refuses anything else) and its
-- audit action, `managed_flags_changed`, written per changed link in the same
-- format ("status:on,location:off,role:off"). The termination lifecycle that
-- acts on the flag is 20261006002000_woven_account_lifecycle.
--
-- NOTE (6 Oct 2026): another workstream's "adoption" batches turned location
-- and role ON for these links (Kami Ruckle and Maddie Milazzo at 11:32 UTC,
-- the other 14 at 11:33 UTC). The owner decided this lifecycle's policy wins:
-- this file sets location and role OFF for all 16 and keeps status ON. It does
-- NOT touch Rachael Dugan, Colene Schildt, Sarah Cotton or DJ Wade (senior
-- accounts whose status was also switched on there) — a separate decision.
--
-- Run as one transaction:  psql "$DB" -v ON_ERROR_STOP=1 -1 -f <this file>

do $$
declare
  v_approved constant text[] := array[
    -- Salon Directors
    '174d59d0-d3f9-4779-bf05-0cc1a7dd16c8',  -- Carley Robertson
    'f8b3b5f9-40ea-4383-a0d7-f103d28c5710',  -- Dez Chowning
    'cb81342e-3bc7-4505-8902-10af3f75b6f3',  -- Kami Ruckle
    '974d6522-3568-4830-9d15-94e783f40b80',  -- Kivryn Belville
    'ddb99f8d-06b5-47ba-aef5-c51a68ca6e3c',  -- Kristin Foltz
    'eac66645-cf80-48fd-ba2c-8a0fa46888c4',  -- Machelle Jewett
    '6f25726c-592c-409d-b189-6325ad354f3b',  -- Maddie Milazzo
    'c1716200-075b-46de-be20-7c418ca9ce3c',  -- Savana Sonier
    'e0d426d5-0e89-4a93-b584-c9aa530c3796',  -- Sydney Young
    'da2b482e-3e41-4605-97d4-0364dcfb1a02',  -- Veronica Farris
    -- Assistant Salon Directors
    '979f35bb-5a24-4658-868a-e2bca9a606fa',  -- Aundasey Wilson
    '3cbf645b-0301-42cc-b6ca-82ae36b045ad',  -- Brandi Algya
    '5ae457de-5028-4e12-a9be-dcdfda3e1e1a',  -- Carly Dolt
    'a20fe09c-f5f4-4d40-af59-a385e543adfc',  -- Erin Nelson
    '3b0dfac4-a467-43b4-935c-e63d0a07cd6a',  -- Grace Heusinkvelt
    'e4516641-630d-4123-b46a-ac7309a9765d'   -- Kylie Burt
  ];
  v_eligible integer;
  v_updated  integer;
begin
  select count(*) into v_eligible
    from public.employee_account_links l
    join public.app_users u on u.id = l.app_user_id
    join public.employee_access_directory d on d.source_system = 'woven' and d.external_employee_id = l.external_employee_id
    join public.woven_position_map p on p.woven_position_id = d.position_id
   where l.external_employee_id = any (v_approved)
     and l.management = 'woven_linked'
     and l.link_method in ('admin_manual', 'admin_confirmed_email')
     and u.role::text in ('salon_director', 'assistant_salon_director')
     and u.scope_level::text = 'salon'
     and u.status::text <> 'disabled'
     and not exists (select 1 from public.employee_role_overrides o where o.app_user_id = u.id)
     and d.employment_status::text = 'active' and d.missing_sync_count = 0
     and p.status::text = 'mapped' and p.is_confirmed
     and p.ask_sunny_role::text in ('salon_director', 'assistant_salon_director');

  if v_eligible <> cardinality(v_approved) then
    raise exception 'woven_status_managed_sd_asd: % of % approved links qualify; nothing changed. Re-check before running.',
      v_eligible, cardinality(v_approved);
  end if;

  with changed as (
    update public.employee_account_links l
       set managed_status   = true,
           managed_location = false,
           managed_role     = false
      from public.employee_account_links before
     where before.app_user_id = l.app_user_id
       and l.external_employee_id = any (v_approved)
       and l.management = 'woven_linked'
       and (l.managed_status is distinct from true or l.managed_location or l.managed_role)
    returning l.app_user_id,
              'status:' || case when before.managed_status then 'on' else 'off' end ||
              ',location:' || case when before.managed_location then 'on' else 'off' end ||
              ',role:' || case when before.managed_role then 'on' else 'off' end as from_label
  )
  insert into public.app_user_audit (target_user_id, target_email, actor_user_id, actor_email, action, from_value, to_value)
  select c.app_user_id, u.email, null,
         'owner-approved lifecycle 2026-10-06 (paulyne.camacho@glowbrands.com): 16 SD/ASD status-managed',
         'managed_flags_changed', c.from_label, 'status:on,location:off,role:off'
    from changed c join public.app_users u on u.id = c.app_user_id;
  get diagnostics v_updated = row_count;

  raise notice 'woven_status_managed_sd_asd: % links now status-managed (% changed by this run).', v_eligible, v_updated;
end;
$$;
