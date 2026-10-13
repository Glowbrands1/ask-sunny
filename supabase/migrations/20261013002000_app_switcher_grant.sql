-- ---------------------------------------------------------------------------
-- APP SWITCHER GRANT — SCHEMA ONLY.
--
-- Lets a NAMED non-administrator see the Ask Sunny / Ask Bubbles switcher, and
-- nothing else: it changes no role, permission or scope. Administrators always
-- see the switcher regardless of this flag.
--
-- THIS MIGRATION GRANTS NOBODY ANYTHING. The column defaults to false for every
-- existing and future row. Who holds the flag is DATA, set per person by an
-- operator (supabase/ops/app-switcher-grant.sql for an existing account, or the
-- provisioning script for a new one), so the migration is safe to apply before
-- or after any account exists and is idempotent.
--
-- WHO CAN CHANGE IT. Only a caller with no browser identity: the server's
-- secret key, or an operator on the database. `authenticated` already holds no
-- INSERT/UPDATE/DELETE on app_users (no policy, no privilege); the trigger below
-- makes the same refusal hold even if a write path is added later, exactly as
-- `app_users_no_self_elevation` does for role and status.
-- ---------------------------------------------------------------------------
alter table public.app_users
  add column if not exists can_switch_apps boolean not null default false;

comment on column public.app_users.can_switch_apps is
  'Offers the Ask Sunny / Ask Bubbles app switcher to a non-administrator. Grants the link only; no role, permission or scope changes. Administrators always see the switcher regardless. Set by an operator or the server, never by the user.';

create or replace function public.app_users_guard_switch_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * KEYED ON THE CALLER'S OWN JWT, not on a value in the row. A browser session
   * always carries a `sub`; the server's secret key and a database operator do
   * not, and they are the intended writers.
   */
  if auth.uid() is not null then
    if tg_op = 'INSERT' and new.can_switch_apps then
      raise exception 'App switcher access can only be granted by an administrator operation.'
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and new.can_switch_apps is distinct from old.can_switch_apps then
      raise exception 'App switcher access can only be changed by an administrator operation.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists app_users_guard_switch_grant on public.app_users;
create trigger app_users_guard_switch_grant
  before insert or update on public.app_users
  for each row execute function public.app_users_guard_switch_grant();

revoke all on function public.app_users_guard_switch_grant() from public, anon, authenticated;
