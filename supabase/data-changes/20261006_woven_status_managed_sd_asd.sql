-- ============================================================================
-- ONE-TIME, APPROVED DATA CHANGE — NOT A MIGRATION. Run only with approval.
-- ============================================================================
--
-- Owner decision, 6 Oct 2026 (re-confirmed 7 Oct): the 16 already-confirmed
-- Salon Director / Assistant Salon Director links take part in the account
-- lifecycle. For exactly these links:
--
--   managed_status   = true    an explicit Woven Terminated disables the account
--   managed_role     = false   Woven never changes their role
--   managed_location = false   Woven never changes their salon
--
-- ONLY those three flags change. No account, role, scope, salon or status; no
-- auth user; no other link. `app_users` is never written: nobody is disabled,
-- re-enabled or reactivated by this file.
--
-- REVISED 7 Oct 2026: one of the 16 (Carley Robertson) is now Terminated in
-- Woven and her profile was disabled by the owner. A legitimately Terminated
-- (or already disabled) member no longer fails the batch: her flags are
-- normalized like everyone else's — status ON, so DISABLE_TERMINATED can
-- finish her revocation later — and her account is left exactly as it is.
--
-- WHAT IS CHECKED, FOR EACH OF THE 16 EMPLOYEE IDS (all of them, before
-- anything changes). Any failure aborts the WHOLE batch, nothing changed, and
-- the error names every EmployeeID that failed and why:
--
--   identity   exactly one Woven link for the EmployeeID; woven_linked; made
--              by a person (admin_manual / admin_confirmed_email); exactly
--              one Woven directory record for it
--   account    a salon-level Salon Director / Assistant Salon Director
--   protected  no role override, not an administrative role
--   mapping    the Woven position is a confirmed, mapped SD/ASD position
--   status     Woven reports Active or Terminated (anything else is not
--              what was approved, and is refused)
--
-- NOT checked, on purpose: the profile's own status (a disabled profile is
-- fine and stays disabled) and the Woven read's freshness (the flags do not
-- act on their own; DISABLE_TERMINATED re-checks Woven when it runs).
--
-- SAFE TO RUN TWICE. A link already at status:on,location:off,role:off is not
-- touched and gets no audit row. Each changed link gets one
-- `managed_flags_changed` audit row ("status:on,location:off,role:off"), the
-- mechanism of 20261006001000_woven_adoption_and_credentials.
--
-- NOTE (6 Oct 2026): another workstream's "adoption" batches turned location
-- and role ON for these links. The owner decided this lifecycle's policy wins.
-- This file does NOT touch Rachael Dugan, Colene Schildt, Sarah Cotton or DJ
-- Wade (senior accounts), admins, protected overrides, District Managers, HR
-- or Operations: they are not in the list, and are refused below if added.
--
-- Run as one transaction:  psql "$DB" -v ON_ERROR_STOP=1 -1 -f <this file>

do $$
declare
  v_approved constant text[] := array[
    -- Salon Directors
    '174d59d0-d3f9-4779-bf05-0cc1a7dd16c8',  -- Carley Robertson (Terminated in Woven 7 Oct; profile disabled by the owner)
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
  v_problems   text[];
  v_terminated integer;
  v_updated    integer;
begin
  if cardinality(v_approved) <> 16 or (select count(distinct x) from unnest(v_approved) x) <> 16 then
    raise exception 'woven_status_managed_sd_asd: the approved list must hold 16 distinct EmployeeIDs; nothing changed';
  end if;

  /* Every check, for every approved EmployeeID, before anything changes. */
  select array_agg(c.external_employee_id || ': ' || c.problem order by c.external_employee_id),
         count(*) filter (where c.problem is null and c.woven_status = 'terminated')
    into v_problems, v_terminated
    from (
      select a.external_employee_id,
             d.woven_status,
             case
               when (select count(*) from public.employee_account_links x
                      where x.source_system = 'woven' and x.external_employee_id = a.external_employee_id) <> 1
                 then 'expected exactly one Woven link for this EmployeeID'
               when l.management <> 'woven_linked'
                 then 'link is ' || l.management || ', not woven_linked'
               when l.link_method not in ('admin_manual', 'admin_confirmed_email')
                 then 'link was not confirmed by a person (' || l.link_method || ')'
               when u.id is null
                 then 'linked account not found'
               when exists (select 1 from public.employee_role_overrides o where o.app_user_id = u.id)
                 then 'protected: the account has a role override'
               when u.role::text in ('admin', 'owner', 'developer')
                 then 'protected: administrative account (' || u.role::text || ')'
               when u.role::text not in ('salon_director', 'assistant_salon_director')
                 then 'account role ' || u.role::text || ' is not Salon Director / Assistant Salon Director'
               when u.scope_level::text <> 'salon'
                 then 'account scope ' || u.scope_level::text || ' is not salon'
               when d.n <> 1
                 then 'expected exactly one Woven directory record, found ' || d.n
               when not d.position_ok
                 then 'Woven position is not a confirmed, mapped SD/ASD position'
               when d.woven_status not in ('active', 'terminated')
                 then 'Woven status is ' || d.woven_status || ', not Active or Terminated'
             end as problem
        from unnest(v_approved) as a (external_employee_id)
        left join public.employee_account_links l
               on l.source_system = 'woven' and l.external_employee_id = a.external_employee_id
        left join public.app_users u on u.id = l.app_user_id
        cross join lateral (
          select count(*) as n,
                 min(dd.employment_status::text) as woven_status,
                 coalesce(bool_and(p.status::text = 'mapped' and p.is_confirmed
                                   and p.ask_sunny_role::text in ('salon_director', 'assistant_salon_director')), false) as position_ok
            from public.employee_access_directory dd
            left join public.woven_position_map p on p.woven_position_id = dd.position_id
           where dd.source_system = 'woven' and dd.external_employee_id = a.external_employee_id
        ) d
    ) c
   where c.problem is not null or c.woven_status = 'terminated';

  v_problems := array_remove(v_problems, null);
  if cardinality(v_problems) > 0 then
    raise exception 'woven_status_managed_sd_asd: % of 16 approved links failed validation; nothing changed. %',
      cardinality(v_problems), array_to_string(v_problems, ' | ');
  end if;

  /* Only the three flags; only where they differ; one audit row per changed link. */
  with changed as (
    update public.employee_account_links l
       set managed_status   = true,
           managed_location = false,
           managed_role     = false
      from public.employee_account_links before
     where before.app_user_id = l.app_user_id
       and l.source_system = 'woven'
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

  raise notice 'woven_status_managed_sd_asd: 16 links status-managed (% changed by this run; % Terminated in Woven, left exactly as they are).',
    v_updated, coalesce(v_terminated, 0);
end;
$$;
