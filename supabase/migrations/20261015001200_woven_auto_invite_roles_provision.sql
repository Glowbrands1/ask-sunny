-- ============================================================================
-- WOVEN AUTOMATIC INVITATIONS — ASD, SD, DM, RM only — part 3 of 3: the provisioning function
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
-- The only part that changes behaviour. The drop of the old function and the create of the new one are in ONE transaction, so there is never a moment with no provisioning function.
--
-- POLICY (from the original migration header):
--
-- Owner instruction, 15 Oct 2026. `employee_access_provision_account` (the one
-- function that creates an account from Woven) used to accept only Salon
-- Director / Assistant Salon Director at salon scope. It now accepts exactly
-- four roles and re-proves, inside its own transaction, everything the planner
-- decided:
--
--   role                       scope      primary area               also covers
--   assistant_salon_director   salon      loc-<primary salon>        loc-<each approved additional salon>
--   salon_director             salon      loc-<primary salon>        loc-<each approved additional salon>
--   district_manager           district   dist-<slug(district)>      none
--   regional_manager           region     reg-<slug(region)>         none
--
-- EVERY assigned location must resolve: the primary and each ADDITIONAL
-- location must be a mapped salon (or a location a person marked `ignored`,
-- which grants nothing). Temporary / expiring locations neither grant nor
-- block. A District / Regional Manager's salons must ALL sit in the one
-- district / region reporting currently assigns, and reporting must not have
-- moved any of them between its two newest periods — otherwise the function
-- refuses and a person decides.
-- Additional salons of a Salon Director / Assistant Salon Director ARE granted,
-- for NEW accounts only (owner instruction, 16 Oct 2026, superseding decision 4
-- of 2 Oct); this function never touches an existing account. The caller's
-- list must equal the list the database derives, or nothing is created.
--
-- A role outside the four, or an unmapped / unconfirmed position, raises
-- `provision_role_not_auto_provisioned` — nothing is created and (because the
-- invitation follows creation) nothing is emailed. Manual administrator
-- invitations do not pass through this function and are untouched.
--
-- The previous 7-argument function is dropped: there is exactly one door.

drop function if exists public.employee_access_provision_account(uuid, text, text, text, text, text, text);
drop function if exists public.employee_access_provision_account(uuid, text, text, text, text, text, text, text);

create or replace function public.employee_access_provision_account(
  p_app_user_id          uuid,
  p_external_employee_id text,
  p_email                text,
  p_display_name         text,
  p_role                 text,
  p_scope_level          text,
  p_primary_area_id      text,
  p_also_covers          text[],
  p_set_by               text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email     text := lower(btrim(p_email));
  v_dir       record;
  v_link      record;
  v_auth      record;
  v_role      text;
  v_salon     text;
  v_primary   text;
  v_numbers   text[] := '{}';
  v_areas     text[] := '{}';
  v_aff       record;
  v_area      record;
  v_expected  text;
  v_also      text[];
  v_moved     boolean;
begin
  if p_app_user_id is null or p_external_employee_id is null or v_email = '' then
    raise exception 'provision_invalid_input' using errcode = 'invalid_parameter_value';
  end if;
  /* THE ROLE ALLOWLIST. Everything else — including every unmapped position — stops here. */
  if p_role is null or p_role not in ('assistant_salon_director', 'salon_director', 'district_manager', 'regional_manager') then
    raise exception 'provision_role_not_auto_provisioned' using errcode = 'check_violation';
  end if;
  if p_scope_level is distinct from (case p_role
        when 'district_manager' then 'district'
        when 'regional_manager' then 'region'
        else 'salon' end) then
    raise exception 'provision_scope_not_valid_for_role' using errcode = 'check_violation';
  end if;

  /* One provisioning per employee and per email at a time. */
  perform pg_advisory_xact_lock(hashtext('woven-provision-employee:' || p_external_employee_id));
  perform pg_advisory_xact_lock(hashtext('woven-provision-email:' || v_email));

  /* IDEMPOTENT: this exact account was already provisioned for this employee. */
  select * into v_link from public.employee_account_links where app_user_id = p_app_user_id;
  if found then
    if v_link.management = 'woven_linked' and v_link.external_employee_id = p_external_employee_id and v_link.link_method = 'provisioned' then
      return 'already_provisioned';
    end if;
    raise exception 'provision_account_already_linked' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.employee_account_links l where l.source_system = 'woven' and l.external_employee_id = p_external_employee_id) then
    raise exception 'provision_employee_already_linked' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.app_users u where u.id = p_app_user_id or lower(u.email) = v_email) then
    raise exception 'provision_account_exists' using errcode = 'unique_violation';
  end if;

  /*
   * The auth user is the one created FOR this employee (its app_metadata, which
   * only the service key can write, names the EmployeeID), for this email, and
   * nobody has used it yet (email unconfirmed).
   */
  select au.email, au.raw_app_meta_data ->> 'external_employee_id' as external_id, au.email_confirmed_at
    into v_auth
    from auth.users au where au.id = p_app_user_id;
  if not found or lower(v_auth.email) <> v_email or v_auth.external_id is distinct from p_external_employee_id then
    raise exception 'provision_auth_user_mismatch' using errcode = 'check_violation';
  end if;
  if v_auth.email_confirmed_at is not null then
    raise exception 'provision_auth_user_already_confirmed' using errcode = 'check_violation';
  end if;

  /* Woven, re-read now: Active in the latest run, unique email, no status conflict, approved position. */
  if not public.employee_access_directory_is_current() then
    raise exception 'provision_directory_not_current' using errcode = 'check_violation';
  end if;
  select d.* into v_dir from public.employee_access_directory d
   where d.source_system = 'woven' and d.external_employee_id = p_external_employee_id
   for share;
  if not found then
    raise exception 'provision_employee_not_found' using errcode = 'no_data_found';
  end if;
  if public.employee_access_observed_status(p_external_employee_id) <> 'active' then
    raise exception 'provision_employee_not_active' using errcode = 'check_violation';
  end if;
  if 'status_termination_conflict' = any (v_dir.data_issues) then
    raise exception 'provision_status_conflict' using errcode = 'check_violation';
  end if;
  if lower(btrim(coalesce(v_dir.email_address, ''))) <> v_email then
    raise exception 'provision_email_mismatch' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.employee_access_directory d where lower(btrim(d.email_address)) = v_email) <> 1 then
    raise exception 'provision_duplicate_email' using errcode = 'check_violation';
  end if;

  /* The role comes from the CONFIRMED position mapping — never from the caller. */
  select p.ask_sunny_role::text into v_role
    from public.woven_position_map p
   where p.woven_position_id = v_dir.position_id and p.status::text = 'mapped' and p.is_confirmed;
  if v_role is null or v_role not in ('assistant_salon_director', 'salon_director', 'district_manager', 'regional_manager') then
    raise exception 'provision_role_not_auto_provisioned' using errcode = 'check_violation';
  end if;
  if v_role is distinct from p_role then
    raise exception 'provision_position_not_approved' using errcode = 'check_violation';
  end if;

  /* The primary location: a mapped salon. */
  select s.salon_number into v_primary
    from public.woven_location_map m
    join public.salons s on s.id = m.salon_id
   where m.woven_location_id = v_dir.primary_woven_location_id and m.status::text = 'mapped';
  if v_primary is null then
    raise exception 'provision_location_not_mapped' using errcode = 'check_violation';
  end if;
  v_numbers := array[v_primary];

  /* Every ADDITIONAL location (not temporary / expiring): a mapped salon, or one a person marked ignored. */
  for v_aff in
    select la.woven_location_id
      from public.employee_location_affiliations la
     where la.employee_id = v_dir.id and la.active and la.access_type::text = 'additional'
  loop
    select m.status::text as status, s.salon_number
      into v_area
      from public.woven_location_map m
      left join public.salons s on s.id = m.salon_id
     where m.woven_location_id = v_aff.woven_location_id;
    if not found or v_area.status = 'unmapped' then
      raise exception 'provision_additional_location_not_mapped' using errcode = 'check_violation';
    end if;
    if v_area.status = 'ignored' then
      continue;
    end if;
    if v_area.status <> 'mapped' or v_area.salon_number is null then
      raise exception 'provision_additional_location_not_mapped' using errcode = 'check_violation';
    end if;
    if not (v_area.salon_number = any (v_numbers)) then
      v_numbers := v_numbers || v_area.salon_number;
    end if;
  end loop;

  /* The area the account will hold, proven from the database and compared with what the planner asked for. */
  if p_scope_level = 'salon' then
    v_expected := 'loc-' || v_primary;
  else
    foreach v_salon in array v_numbers loop
      select case when p_scope_level = 'district' then 'dist-' || public.employee_access_area_slug(a.district_label)
                  else 'reg-' || public.employee_access_area_slug(a.region_label) end,
             case when p_scope_level = 'district' then a.previous_district_label is not null
                       and public.employee_access_area_slug(a.previous_district_label) <> public.employee_access_area_slug(a.district_label)
                  else a.previous_region_label is not null
                       and public.employee_access_area_slug(a.previous_region_label) <> public.employee_access_area_slug(a.region_label) end
        into v_expected, v_moved
        from public.employee_access_salon_area(v_salon) a
       where (p_scope_level = 'district' and a.district_label is not null)
          or (p_scope_level = 'region' and a.region_label is not null);
      if v_expected is null then
        raise exception 'provision_area_unknown' using errcode = 'check_violation';
      end if;
      if v_moved then
        raise exception 'provision_area_changed_recently' using errcode = 'check_violation';
      end if;
      if not (v_expected = any (v_areas)) then
        v_areas := v_areas || v_expected;
      end if;
    end loop;
    if cardinality(v_areas) <> 1 then
      raise exception 'provision_locations_span_several_areas' using errcode = 'check_violation';
    end if;
    v_expected := v_areas[1];
  end if;
  if v_expected is distinct from p_primary_area_id then
    raise exception 'provision_area_mismatch' using errcode = 'check_violation';
  end if;

  /* ALSO COVERS: a salon-level account holds each approved additional salon; a district / region account holds nothing extra. */
  if p_scope_level = 'salon' then
    select coalesce(array_agg('loc-' || n order by n), '{}') into v_also from unnest(v_numbers) as n where n <> v_primary;
  else
    v_also := '{}';
  end if;
  if coalesce((select array_agg(x order by x) from unnest(coalesce(p_also_covers, '{}')) as x), '{}') is distinct from v_also then
    raise exception 'provision_also_covers_mismatch' using errcode = 'check_violation';
  end if;

  insert into public.app_users (
    id, email, display_name, role, status, scope_level, scope_primary_area_id, scope_also_covers_area_ids, created_by, updated_by
  ) values (
    p_app_user_id, v_email, left(coalesce(nullif(btrim(p_display_name), ''), v_email), 120),
    p_role::public.app_user_role, 'invited', p_scope_level::public.app_scope_level, p_primary_area_id, v_also, null, null
  );

  insert into public.employee_account_links (
    app_user_id, management, source_system, external_employee_id, link_method,
    managed_status, managed_location, managed_role,
    provisioned_by_source, first_provisioned_at, last_synced_at, invite_delivery_status, reason, set_by
  ) values (
    p_app_user_id, 'woven_linked', 'woven', p_external_employee_id, 'provisioned',
    true, false, false,
    'woven', now(), now(), 'not_sent', 'Created from Woven: approved position, Active', left(p_set_by, 120)
  );

  insert into public.app_user_audit (target_user_id, target_email, actor_user_id, actor_email, action, from_value, to_value)
  values (p_app_user_id, v_email, null, left(p_set_by, 120), 'woven_provisioned', null,
          p_role || ' ' || p_scope_level || ' ' || p_primary_area_id || ' salons:' || array_to_string(v_numbers, ','));

  return 'created';
end;
$$;

revoke all on function public.employee_access_provision_account(uuid, text, text, text, text, text, text, text[], text) from public, anon, authenticated, service_role;
grant execute on function public.employee_access_provision_account(uuid, text, text, text, text, text, text, text[], text) to service_role;
