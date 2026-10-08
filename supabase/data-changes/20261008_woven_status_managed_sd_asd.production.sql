-- ============================================================================
-- PRODUCTION RUN — ONE-TIME, APPROVED DATA CHANGE — NOT A MIGRATION
-- Ask Sunny project rbkylaavthsjepsczccv only. Run once, in the SQL editor.
-- ============================================================================
--
-- The 16 approved Salon Director / Assistant Salon Director links become:
--
--   managed_status   = true
--   managed_role     = false
--   managed_location = false
--
-- and NOTHING ELSE changes: no account status, role, scope, salon or Auth
-- user; no ban, no session revoked; no other link. Carley Robertson stays
-- disabled exactly as she is. No lifecycle action runs (this file calls none).
--
-- PINNED TO WHAT WAS REVIEWED (read-only, 8 Oct 2026): each EmployeeID must
-- still be linked (woven_linked, admin_manual) to exactly the account below,
-- with exactly the role, salon and status below, a confirmed SD/ASD Woven
-- position, and no role override. Anything different — one row — and the
-- whole file stops with an error naming it, and NOTHING is changed.
--
-- BEFORE IT COMMITS it re-checks that, apart from the three flags (and the
-- automatic updated_at) on these 16 links:
--   * every app_users row is byte-for-byte unchanged
--   * every auth.users identity/ban/password/metadata field is unchanged
--   * every other employee_account_links row is unchanged
--   * no access run started, no apply run exists, no session was revoked
--   * Carley is still disabled and not banned
--   * all 16 links read status:on, location:off, role:off
--   * exactly one managed_flags_changed audit row per changed link
--
-- Logic identical to supabase/data-changes/20261006_woven_status_managed_sd_asd.sql
-- (tested on the local stack), plus the Production pins and post-checks above.
-- The whole file is ONE statement: it either fully applies or changes nothing.
-- Safe to run twice: a second run changes 0 links and writes 0 audit rows.

do $$
declare
  /* EmployeeID → reviewed account, role, salon, status. */
  v_pinned constant jsonb := '{
    "174d59d0-d3f9-4779-bf05-0cc1a7dd16c8": {"account": "254db2a2-8d32-47eb-ba19-a28a0451595c", "role": "salon_director",           "salon": "loc-0307", "status": "disabled", "who": "Carley Robertson (Terminated in Woven; stays disabled)"},
    "f8b3b5f9-40ea-4383-a0d7-f103d28c5710": {"account": "215bef7a-5507-435e-8576-c2ef07d6a9dd", "role": "salon_director",           "salon": "loc-0314", "status": "active",   "who": "Dez Chowning"},
    "cb81342e-3bc7-4505-8902-10af3f75b6f3": {"account": "631bd3d3-8274-431f-93e0-08d186411404", "role": "salon_director",           "salon": "loc-0309", "status": "active",   "who": "Kami Ruckle"},
    "974d6522-3568-4830-9d15-94e783f40b80": {"account": "f0e176f5-a1aa-4422-bd25-3ff14a8e58a4", "role": "salon_director",           "salon": "loc-0462", "status": "active",   "who": "Kivryn Belville"},
    "ddb99f8d-06b5-47ba-aef5-c51a68ca6e3c": {"account": "2dcc3a04-18a4-40cc-b008-c5b0b6abc58c", "role": "salon_director",           "salon": "loc-0394", "status": "active",   "who": "Kristin Foltz"},
    "eac66645-cf80-48fd-ba2c-8a0fa46888c4": {"account": "7edf90cb-ab98-4935-9cb8-0686cd502f04", "role": "salon_director",           "salon": "loc-0307", "status": "active",   "who": "Machelle Jewett"},
    "6f25726c-592c-409d-b189-6325ad354f3b": {"account": "c3a7f79e-0578-427f-b62e-4b7c5e5d6175", "role": "salon_director",           "salon": "loc-0462", "status": "active",   "who": "Maddie Milazzo"},
    "c1716200-075b-46de-be20-7c418ca9ce3c": {"account": "41a44031-1fd4-416f-80b5-7b8a84f2d8d7", "role": "salon_director",           "salon": "loc-0410", "status": "active",   "who": "Savana Sonier"},
    "e0d426d5-0e89-4a93-b584-c9aa530c3796": {"account": "7f9b5dc6-fd0e-4cf7-8bcc-86d3cb86766f", "role": "salon_director",           "salon": "loc-0311", "status": "active",   "who": "Sydney Young"},
    "da2b482e-3e41-4605-97d4-0364dcfb1a02": {"account": "b0a5ccfa-9fac-422c-a1c8-13a761cceb4e", "role": "salon_director",           "salon": "loc-0468", "status": "active",   "who": "Veronica Farris"},
    "979f35bb-5a24-4658-868a-e2bca9a606fa": {"account": "0617c552-273f-4dde-8833-91d5c46771cb", "role": "assistant_salon_director", "salon": "loc-0306", "status": "active",   "who": "Aundasey Wilson"},
    "3cbf645b-0301-42cc-b6ca-82ae36b045ad": {"account": "e4fad79d-4be4-42e7-888e-8b5746385ec1", "role": "assistant_salon_director", "salon": "loc-0311", "status": "active",   "who": "Brandi Algya"},
    "5ae457de-5028-4e12-a9be-dcdfda3e1e1a": {"account": "bdfbbab0-940c-4636-998f-0e1315dcdd36", "role": "assistant_salon_director", "salon": "loc-0394", "status": "active",   "who": "Carly Dolt"},
    "a20fe09c-f5f4-4d40-af59-a385e543adfc": {"account": "c2dce01d-c202-4b3f-b259-a8fc2a51e9fc", "role": "assistant_salon_director", "salon": "loc-0313", "status": "active",   "who": "Erin Nelson"},
    "3b0dfac4-a467-43b4-935c-e63d0a07cd6a": {"account": "263342f1-dbf0-4c6d-8884-5b35bd621d4a", "role": "assistant_salon_director", "salon": "loc-0410", "status": "active",   "who": "Grace Heusinkvelt"},
    "e4516641-630d-4123-b46a-ac7309a9765d": {"account": "2b07a732-308c-4741-9eb3-1bae91736754", "role": "assistant_salon_director", "salon": "loc-0495", "status": "active",   "who": "Kylie Burt"}
  }'::jsonb;
  v_carley_account constant uuid := '254db2a2-8d32-47eb-ba19-a28a0451595c';
  v_actor constant text := 'owner-approved lifecycle 2026-10-06 (paulyne.camacho@glowbrands.com): 16 SD/ASD status-managed';

  v_ids          text[];
  v_accounts     uuid[];
  v_problems     text[];
  v_to_change    integer;
  v_updated      integer;
  v_audits       integer;
  v_started      timestamptz := now();  -- this transaction's start = the audit rows' created_at
  -- fingerprints taken before the change, compared after it
  f_users        text;
  f_auth         text;
  f_other_links  text;
  f_pinned_links text;
  f_runs         text;
  f_sessions     bigint;
begin
  select array_agg(k order by k), array_agg((v_pinned -> k ->> 'account')::uuid order by k)
    into v_ids, v_accounts
    from jsonb_object_keys(v_pinned) k;
  if cardinality(v_ids) <> 16 or (select count(distinct a) from unnest(v_accounts) a) <> 16 then
    raise exception 'woven_status_managed_sd_asd: the pinned list must hold 16 distinct employees and 16 distinct accounts; nothing changed';
  end if;

  /* ------------------------------------------------ 1. every pin, every check */
  select array_agg(c.external_employee_id || ' (' || c.who || '): ' || c.problem order by c.external_employee_id)
    into v_problems
    from (
      select k as external_employee_id, v_pinned -> k ->> 'who' as who,
             case
               when (select count(*) from public.employee_account_links x
                      where x.source_system = 'woven' and x.external_employee_id = k) <> 1
                 then 'expected exactly one Woven link for this EmployeeID'
               when l.app_user_id is distinct from (v_pinned -> k ->> 'account')::uuid
                 then 'linked to a different account than reviewed'
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
               when u.role::text is distinct from v_pinned -> k ->> 'role'
                 then 'account role ' || u.role::text || ' differs from the reviewed ' || (v_pinned -> k ->> 'role')
               when u.scope_level::text <> 'salon'
                 then 'account scope ' || u.scope_level::text || ' is not salon'
               when u.scope_primary_area_id is distinct from v_pinned -> k ->> 'salon'
                 then 'account salon ' || coalesce(u.scope_primary_area_id, 'none') || ' differs from the reviewed ' || (v_pinned -> k ->> 'salon')
               when u.status::text is distinct from v_pinned -> k ->> 'status'
                 then 'account status ' || u.status::text || ' differs from the reviewed ' || (v_pinned -> k ->> 'status')
               when d.n <> 1
                 then 'expected exactly one Woven directory record, found ' || d.n
               when not d.position_ok
                 then 'Woven position is not a confirmed, mapped SD/ASD position'
               when d.woven_status not in ('active', 'terminated')
                 then 'Woven status is ' || d.woven_status || ', not Active or Terminated'
             end as problem
        from jsonb_object_keys(v_pinned) k
        left join public.employee_account_links l on l.source_system = 'woven' and l.external_employee_id = k
        left join public.app_users u on u.id = l.app_user_id
        cross join lateral (
          select count(*) as n,
                 min(dd.employment_status::text) as woven_status,
                 coalesce(bool_and(p.status::text = 'mapped' and p.is_confirmed
                                   and p.ask_sunny_role::text in ('salon_director', 'assistant_salon_director')), false) as position_ok
            from public.employee_access_directory dd
            left join public.woven_position_map p on p.woven_position_id = dd.position_id
           where dd.source_system = 'woven' and dd.external_employee_id = k
        ) d
    ) c
   where c.problem is not null;

  if cardinality(v_problems) > 0 then
    raise exception 'woven_status_managed_sd_asd: % of 16 links differ from what was reviewed; nothing changed. %',
      cardinality(v_problems), array_to_string(v_problems, ' | ');
  end if;

  if exists (select 1 from public.employee_access_runs where mode = 'apply' or status = 'running') then
    raise exception 'woven_status_managed_sd_asd: an apply run exists or a run is in progress; nothing changed';
  end if;

  /* ----------------------------------------------------- 2. the "before" picture */
  select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into f_users from public.app_users u;
  select md5(coalesce(string_agg(au.id::text || '|' || coalesce(au.email, '') || '|' || coalesce(au.banned_until::text, '') || '|' ||
                               coalesce(au.email_confirmed_at::text, '') || '|' || coalesce(au.encrypted_password, '') || '|' ||
                               coalesce(au.raw_app_meta_data::text, '') || '|' || coalesce(au.deleted_at::text, ''), ',' order by au.id), ''))
    into f_auth from auth.users au;
  select md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.app_user_id), '')) into f_other_links
    from public.employee_account_links l where l.app_user_id <> all (v_accounts);
  select md5(coalesce(string_agg((to_jsonb(l) - array['managed_status', 'managed_location', 'managed_role', 'updated_at'])::text, '|' order by l.app_user_id), ''))
    into f_pinned_links from public.employee_account_links l where l.app_user_id = any (v_accounts);
  select md5(coalesce(string_agg(r.id::text || r.status, ',' order by r.id), '')) into f_runs from public.employee_access_runs r;
  select count(*) into f_sessions from auth.sessions s where s.user_id = any (v_accounts);

  select count(*) into v_to_change from public.employee_account_links l
   where l.app_user_id = any (v_accounts)
     and (l.managed_status is distinct from true or l.managed_location or l.managed_role);

  /* ------------------------------------------- 3. only the three flags, only these 16 */
  with changed as (
    update public.employee_account_links l
       set managed_status   = true,
           managed_location = false,
           managed_role     = false
      from public.employee_account_links before
     where before.app_user_id = l.app_user_id
       and l.app_user_id = any (v_accounts)
       and l.source_system = 'woven'
       and l.management = 'woven_linked'
       and (l.managed_status is distinct from true or l.managed_location or l.managed_role)
    returning l.app_user_id,
              'status:' || case when before.managed_status then 'on' else 'off' end ||
              ',location:' || case when before.managed_location then 'on' else 'off' end ||
              ',role:' || case when before.managed_role then 'on' else 'off' end as from_label
  )
  insert into public.app_user_audit (target_user_id, target_email, actor_user_id, actor_email, action, from_value, to_value)
  select c.app_user_id, u.email, null, v_actor, 'managed_flags_changed', c.from_label, 'status:on,location:off,role:off'
    from changed c join public.app_users u on u.id = c.app_user_id;
  get diagnostics v_updated = row_count;

  /* ---------------------------------------------- 4. prove nothing else moved */
  if v_updated <> v_to_change then
    raise exception 'woven_status_managed_sd_asd: % links changed, % expected; rolled back, nothing changed', v_updated, v_to_change;
  end if;
  if (select count(*) from public.employee_account_links l
       where l.app_user_id = any (v_accounts) and l.managed_status and not l.managed_location and not l.managed_role) <> 16 then
    raise exception 'woven_status_managed_sd_asd: not all 16 links read status:on,location:off,role:off; rolled back, nothing changed';
  end if;
  select count(*) into v_audits from public.app_user_audit a
   where a.action = 'managed_flags_changed' and a.actor_email = v_actor and a.created_at >= v_started
     and a.target_user_id = any (v_accounts);
  if v_audits <> v_updated then
    raise exception 'woven_status_managed_sd_asd: % audit rows for % changed links; rolled back, nothing changed', v_audits, v_updated;
  end if;
  if (select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) from public.app_users u) <> f_users then
    raise exception 'woven_status_managed_sd_asd: an app_users row changed; rolled back, nothing changed';
  end if;
  if (select md5(coalesce(string_agg(au.id::text || '|' || coalesce(au.email, '') || '|' || coalesce(au.banned_until::text, '') || '|' ||
                                     coalesce(au.email_confirmed_at::text, '') || '|' || coalesce(au.encrypted_password, '') || '|' ||
                                     coalesce(au.raw_app_meta_data::text, '') || '|' || coalesce(au.deleted_at::text, ''), ',' order by au.id), ''))
        from auth.users au) <> f_auth then
    raise exception 'woven_status_managed_sd_asd: an auth.users row changed; rolled back, nothing changed';
  end if;
  if (select md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.app_user_id), '')) from public.employee_account_links l
       where l.app_user_id <> all (v_accounts)) <> f_other_links then
    raise exception 'woven_status_managed_sd_asd: a link outside the 16 changed; rolled back, nothing changed';
  end if;
  if (select md5(coalesce(string_agg((to_jsonb(l) - array['managed_status', 'managed_location', 'managed_role', 'updated_at'])::text, '|' order by l.app_user_id), ''))
        from public.employee_account_links l where l.app_user_id = any (v_accounts)) <> f_pinned_links then
    raise exception 'woven_status_managed_sd_asd: something other than the three flags changed on the 16 links; rolled back, nothing changed';
  end if;
  if (select md5(coalesce(string_agg(r.id::text || r.status, ',' order by r.id), '')) from public.employee_access_runs r) <> f_runs then
    raise exception 'woven_status_managed_sd_asd: an access run changed; rolled back, nothing changed';
  end if;
  if (select count(*) from auth.sessions s where s.user_id = any (v_accounts)) < f_sessions then
    raise exception 'woven_status_managed_sd_asd: a session was revoked; rolled back, nothing changed';
  end if;
  if not exists (
    select 1 from public.app_users u join auth.users au on au.id = u.id
     where u.id = v_carley_account and u.status::text = 'disabled' and coalesce(au.banned_until <= now(), true)
  ) then
    raise exception 'woven_status_managed_sd_asd: Carley Robertson is not exactly as reviewed (disabled, not banned); rolled back, nothing changed';
  end if;

  raise notice 'woven_status_managed_sd_asd: done. % of 16 links changed, % audit rows written; app_users, auth.users, sessions and every other link unchanged.',
    v_updated, v_audits;
end;
$$;
