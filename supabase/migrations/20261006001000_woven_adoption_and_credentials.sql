-- =============================================================================
-- Woven adoption and credential ownership
-- =============================================================================
--
-- Three narrow additions, nothing removed:
--
--   1. AUDIT VOCABULARY. Two new actions: 'managed_flags_changed' (an
--      administrator chose what Woven may manage for a linked account) and
--      'credentials_reset' (an administrator cleared an account's password and
--      sessions so the person sets their own). Additive only.
--
--   2. MANAGED FLAGS BECOME EDITABLE, AND ONLY THEM. service_role gets UPDATE on
--      exactly three columns of employee_account_links: managed_status,
--      managed_location, managed_role. A trigger refuses any update that
--      changes anything else (the account, the EmployeeID, how it was linked),
--      so a link stays the same link forever; only what Woven may manage can
--      change. Which flags an account may carry is decided by the server
--      (src/lib/employees/woven/access/managed-policy.ts) and audited.
--
--   3. auth_clear_user_credentials(uuid). Clears an account's password and
--      deletes its sessions and refresh tokens in ONE transaction. It never
--      SETS a password: afterwards nobody can sign in with any password until
--      the person follows the recovery email and chooses their own. Used for
--      accounts whose password was set by somebody other than their owner.
--      Server-only (service_role); browser roles cannot execute it.
--
-- Applied only with approval, verbatim, in one transaction. Idempotent.

-- ------------------------------------------------ 1. audit vocabulary ---
--
-- `src/lib/admin/user-directory.test.ts` and `credential-reset.test.ts` read
-- the latest definition of this constraint and fail if the code emits
-- anything else.

alter table public.app_user_audit
  drop constraint if exists app_user_audit_action_check;

alter table public.app_user_audit
  add constraint app_user_audit_action_check
  check (action in (
    'invited',
    'invite_resent',
    'invitation_accepted',
    'reset_requested',
    'role_changed',
    'status_changed',
    'scope_changed',
    'access_revoked',
    'access_restored',
    'access_revocation_incomplete',
    'managed_flags_changed',
    'credentials_reset'
  ));

-- ---------------------------------------- 2. editable managed flags only ---

create or replace function public.employee_account_links_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  /* Everything except the three flags (and the touched timestamp) is the link's identity. */
  if (to_jsonb(new) - array['managed_status', 'managed_location', 'managed_role', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['managed_status', 'managed_location', 'managed_role', 'updated_at']) then
    raise exception 'employee_account_links: only managed_status, managed_location and managed_role can change'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.employee_account_links_guard_update() from public, anon, authenticated, service_role;

drop trigger if exists employee_account_links_guard_update on public.employee_account_links;
create trigger employee_account_links_guard_update
  before update on public.employee_account_links
  for each row execute function public.employee_account_links_guard_update();

grant update (managed_status, managed_location, managed_role) on public.employee_account_links to service_role;

-- ------------------------------------ 3. clear a password, end sessions ---

create or replace function public.auth_clear_user_credentials(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found    integer := 0;
  v_tokens   integer := 0;
  v_sessions integer := 0;
begin
  if p_user_id is null then
    raise exception 'auth_clear_user_credentials: a user id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  /* '' is what an invited account that has not chosen a password holds: no password matches it. */
  update auth.users
     set encrypted_password = '', updated_at = now()
   where id = p_user_id and deleted_at is null;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    raise exception 'auth_clear_user_credentials: no such user'
      using errcode = 'no_data_found';
  end if;

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  get diagnostics v_tokens = row_count;

  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  return jsonb_build_object('refresh_tokens', v_tokens, 'sessions', v_sessions);
end;
$$;

revoke all on function public.auth_clear_user_credentials(uuid) from public, anon, authenticated;
grant execute on function public.auth_clear_user_credentials(uuid) to service_role;
