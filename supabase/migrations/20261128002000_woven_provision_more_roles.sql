-- ---------------------------------------------------------------------------
-- THE ACCOUNT LIFECYCLE MAY CREATE DISTRICT MANAGERS.
--
-- Pau, 28 Nov 2026: "we need to add District manager also, just not
-- corporate", and "we dont add tanning consultants and employee in both apps".
--
-- `employee_access_provision_account` accepted only Salon Director and
-- Assistant Salon Director. This replaces the function with ONE change: it
-- also accepts District Manager —
--
--   assistant_salon_director, salon_director, district_manager
--
-- Tanning Consultants (`employee`) stay refused: they are not given accounts.
-- Every other check is unchanged: the position must still be mapped and
-- confirmed to exactly this role, the primary location mapped to this salon,
-- the employee Active in the latest read, the email unique and Woven's own.
-- The account is still created at its Woven salon (scope `salon`); a District
-- Manager's scope is widened to their district afterwards by the position sync
-- (`src/lib/admin/position-sync.ts`, audited `scope_changed`), before any
-- invitation can go (new hires wait for a second sync).
--
-- Employee, admin, owner, developer and regional_manager stay refused.
-- ---------------------------------------------------------------------------

create or replace function public.employee_access_provision_account(
  p_app_user_id         uuid,
  p_external_employee_id text,
  p_email               text,
  p_display_name        text,
  p_role                text,
  p_primary_area_id     text,
  p_set_by              text
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
  v_area      text;
begin
  if p_app_user_id is null or p_external_employee_id is null or v_email = '' then
    raise exception 'provision_invalid_input' using errcode = 'invalid_parameter_value';
  end if;
  if p_role not in ('assistant_salon_director', 'salon_director', 'district_manager') then
    raise exception 'provision_role_not_auto_provisioned' using errcode = 'check_violation';
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
   * nobody has used it yet (email unconfirmed). Supabase Auth stores a random,
   * never-disclosed hash for a user created without a password; the person
   * replaces it with their own when they accept the invitation.
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

  /* Woven, re-read now: Active in the latest run, unique email, no status conflict, approved position, salon. */
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

  select p.ask_sunny_role::text into v_role
    from public.woven_position_map p
   where p.woven_position_id = v_dir.position_id and p.status::text = 'mapped' and p.is_confirmed;
  if v_role is distinct from p_role then
    raise exception 'provision_position_not_approved' using errcode = 'check_violation';
  end if;

  select 'loc-' || s.salon_number into v_area
    from public.woven_location_map m
    join public.salons s on s.id = m.salon_id
   where m.woven_location_id = v_dir.primary_woven_location_id and m.status::text = 'mapped';
  if v_area is distinct from p_primary_area_id then
    raise exception 'provision_location_not_mapped' using errcode = 'check_violation';
  end if;

  insert into public.app_users (
    id, email, display_name, role, status, scope_level, scope_primary_area_id, scope_also_covers_area_ids, created_by, updated_by
  ) values (
    p_app_user_id, v_email, left(coalesce(nullif(btrim(p_display_name), ''), v_email), 120),
    p_role::public.app_user_role, 'invited', 'salon', p_primary_area_id, '{}', null, null
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
  values (p_app_user_id, v_email, null, left(p_set_by, 120), 'woven_provisioned', null, p_role || ' ' || p_primary_area_id);

  return 'created';
end;
$$;
