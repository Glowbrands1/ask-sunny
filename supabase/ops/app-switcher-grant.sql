-- ---------------------------------------------------------------------------
-- GRANT THE APP SWITCHER TO NAMED, EXISTING ACCOUNTS — an operator script, NOT a
-- migration (it is not applied automatically and is safe to re-run).
--
-- Run it in the SQL editor / psql as the project owner, AFTER:
--   1. 20261013002000_app_switcher_grant.sql has been applied, and
--   2. both accounts exist (Ask Bubbles: provisioned first — see
--      docs/app-switcher-provisioning.md).
--
-- It touches only the rows named below, and only while the role matches what was
-- approved; a person whose role has since changed is NOT granted. It then
-- verifies the outcome and RAISES — rolling the whole statement back — unless
-- exactly the intended accounts, and no other non-administrator, hold the flag.
-- Idempotent: a second run changes nothing and passes the same checks.
-- ---------------------------------------------------------------------------
do $$
declare
  v_expected constant integer := 2;
  v_granted  integer;
  v_extra    text;
begin
  update public.app_users u
     set can_switch_apps = true
    from (values
      ('dj.wade@glowbrands.com',       'regional_manager'),
      ('colene.schildt@glowbrands.com', 'district_manager')
    ) as t(email, role)
   where lower(u.email) = t.email
     and u.role::text = t.role
     and u.status = 'active'
     and u.can_switch_apps is distinct from true;

  -- Exactly the two intended, active, correctly-roled accounts hold the flag.
  select count(*) into v_granted
    from public.app_users u
   where u.can_switch_apps
     and u.status = 'active'
     and ((lower(u.email) = 'dj.wade@glowbrands.com'        and u.role = 'regional_manager')
       or (lower(u.email) = 'colene.schildt@glowbrands.com' and u.role = 'district_manager'));

  if v_granted <> v_expected then
    raise exception 'Expected % granted accounts, found %. Is each account present, active and in the approved role?', v_expected, v_granted;
  end if;

  -- No OTHER non-administrator holds the flag.
  select string_agg(u.email, ', ') into v_extra
    from public.app_users u
   where u.can_switch_apps
     and u.role::text not in ('admin', 'owner', 'developer')
     and lower(u.email) not in ('dj.wade@glowbrands.com', 'colene.schildt@glowbrands.com');

  if v_extra is not null then
    raise exception 'Unexpected non-administrator accounts hold can_switch_apps: %', v_extra;
  end if;

  raise notice 'OK: % accounts hold can_switch_apps, as intended.', v_granted;
end
$$;
