-- ============================================================================
-- REVOKING ACCESS MEANS REVOKING IT AT THE AUTHENTICATION LAYER TOO.
-- ============================================================================
--
-- Before this migration, "Disable" set `app_users.status = 'disabled'` and
-- nothing else. The application refused that account on its next request —
-- every API route and page re-reads `app_users` — but Supabase Auth did not
-- know: the password still signed in, the refresh token still refreshed, a
-- reset email still arrived, and a still-valid access token could read the
-- knowledge library straight through PostgREST with the publishable key,
-- because the two knowledge read policies asked only "is this an
-- authenticated Supabase user?".
--
-- This migration supplies the database half of a two-layer revocation (the
-- other half is the Auth Admin ban, applied by `src/lib/auth/revocation.ts`):
--
--   1. `auth_revoke_user_sessions(uuid)` — server-only. Deletes the user's
--      sessions and refresh tokens, so no existing session can be refreshed.
--   2. The knowledge read policies now require an ACTIVE Ask Sunny user, so an
--      access token that outlives a revocation reads nothing.
--   3. The audit vocabulary gains the actions that record it.
--
-- NOTHING IS DELETED THAT HISTORY DEPENDS ON. `auth.users` and `app_users`
-- rows are never deleted here (deleting an auth user would CASCADE to its
-- profile). Sessions are credentials, not history.
--
-- Applied only with approval, verbatim, in one transaction. Idempotent.

-- --------------------------------------------- 1. session revocation ---

create or replace function public.auth_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessions integer := 0;
  v_tokens   integer := 0;
begin
  if p_user_id is null then
    raise exception 'auth_revoke_user_sessions: a user id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Refresh tokens first: they reference sessions, and a refresh token is
  -- the credential that would mint a new access token.
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  get diagnostics v_tokens = row_count;

  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  return v_sessions;
end;
$$;

comment on function public.auth_revoke_user_sessions(uuid) is
  'Server-only. Deletes every Supabase Auth session and refresh token for one user, so no existing session can be refreshed. Returns the number of sessions removed. Never deletes the user. Callable only with the secret key (service_role).';

revoke all on function public.auth_revoke_user_sessions(uuid) from public;
revoke all on function public.auth_revoke_user_sessions(uuid) from anon, authenticated;
grant execute on function public.auth_revoke_user_sessions(uuid) to service_role;

-- -------------------------------- 2. knowledge reads need an ACTIVE user ---
--
-- The application reads knowledge with the secret key, which bypasses RLS;
-- no browser code queries these tables. These policies are therefore the
-- guard for exactly one caller: a raw PostgREST request carrying a user's
-- access token. That caller must be an ACTIVE Ask Sunny user — not merely a
-- Supabase user, not an invited one, not a disabled one.
--
-- The check is an uncorrelated scalar subquery, so Postgres evaluates it once
-- per statement rather than once per row. It reads `app_users` through the
-- caller's own `app_users_select_own` policy (id = auth.uid()), so it needs
-- no new grant and no SECURITY DEFINER helper.

drop policy if exists knowledge_documents_read_authenticated on public.knowledge_documents;
create policy knowledge_documents_read_authenticated
  on public.knowledge_documents
  for select
  to authenticated
  using (
    (select exists (
      select 1 from public.app_users u
      where u.id = (select auth.uid()) and u.status = 'active'
    ))
    and status::text <> 'retired'
  );

drop policy if exists knowledge_chunks_read_authenticated on public.knowledge_chunks;
create policy knowledge_chunks_read_authenticated
  on public.knowledge_chunks
  for select
  to authenticated
  using (
    (select exists (
      select 1 from public.app_users u
      where u.id = (select auth.uid()) and u.status = 'active'
    ))
    and exists (
      select 1
      from public.knowledge_documents d
      where d.id = knowledge_chunks.document_id
        and d.status::text <> 'retired'
    )
  );

-- ------------------------------------------------ 3. audit vocabulary ---
--
-- Only ADDITIVE: every existing value stays, so no historical row is
-- invalidated. `src/lib/admin/user-directory.test.ts` reads the latest
-- definition of this constraint and fails if the code emits anything else.

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
    'access_revocation_incomplete'
  ));
