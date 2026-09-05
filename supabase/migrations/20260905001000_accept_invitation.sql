-- ============================================================================
-- ACCEPTING AN INVITATION: the one status change a person may make to
-- their own profile.
-- ============================================================================
--
-- THE HOLE THIS FILLS. `app_users.status` starts at 'invited', and the auth
-- provider REFUSES an invited profile — correctly, because a credential that
-- has never been used is not yet a user of this application. But nothing moved
-- a profile out of that state except `patchUser`, which requires
-- `manage_users` and refuses a change to your own account.
--
-- On a fresh deployment that is a closed loop with nobody inside it: the first
-- administrator is invited, cannot sign in because invited is refused, and
-- cannot be activated because the only person with `manage_users` is them.
-- Observed exactly that way — one auth user, one profile, zero active
-- administrators, and no supported way in.
--
-- ============================================================================
-- WHY THIS IS AN RPC AND NOT AN APPLICATION ROUTE
-- ============================================================================
--
-- The obvious place for this is a server route calling `authorizeRequest`. It
-- cannot be: `authorizeRequest` resolves the profile, and an invited profile is
-- exactly what it refuses. The route would have to bypass the app's own
-- authorization to serve the one person it exists for.
--
-- So the check moves to where the identity already is. `auth.uid()` comes from
-- the JWT PostgREST verified; this function takes NO ARGUMENTS, so there is no
-- id, role, status or email a caller could supply. The only thing it can be
-- told is "the person holding this session accepts their own invitation".

-- --------------------------------------------------------------------------
-- 1. The invariant gains its one exception, stated explicitly.
-- --------------------------------------------------------------------------
--
-- `app_users_guard_self_elevation` refuses any self-change of role or status.
-- That rule is still right, and accepting an invitation is the single
-- transition that has to be carved out of it — narrowly, in the invariant
-- itself, rather than by letting some caller run around the trigger.
--
-- Note what is NOT carved out: role is untouchable as before, and the status
-- exception is directional. 'invited' -> 'active' only. A disabled account
-- cannot re-enable itself, and an active account cannot disable itself into a
-- state an administrator would have to undo.

create or replace function public.app_users_guard_self_elevation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The privileged server client acts as service_role and is the intended
  -- writer; it has already passed the application's own authorization.
  if current_setting('request.jwt.claim.role', true) = 'service_role'
     or current_user = 'service_role' then
    return new;
  end if;

  if auth.uid() is not null and auth.uid() = new.id then
    if new.role is distinct from old.role then
      raise exception 'A user cannot change their own role.'
        using errcode = 'insufficient_privilege';
    end if;

    if new.status is distinct from old.status then
      /*
       * THE ONE PERMITTED SELF-TRANSITION. Accepting an invitation, and
       * nothing else. Written as an allow-list of a single ordered pair so
       * that every other self-change — including 'disabled' -> 'active', the
       * one that would matter most — still raises.
       */
      if not (old.status = 'invited' and new.status = 'active') then
        raise exception 'A user cannot change their own status.'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.app_users_guard_self_elevation() from public;
revoke execute on function public.app_users_guard_self_elevation() from anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. Defence in depth: the browser roles lose write privileges outright.
-- --------------------------------------------------------------------------
--
-- Supabase grants anon and authenticated full table privileges on everything in
-- `public` by default, and row level security is what actually stops them —
-- `app_users` is RLS-enabled, RLS-FORCED, and carries a SELECT policy only, so
-- an UPDATE from a browser matches no rows.
--
-- That is sound, and it is now the ONLY thing standing between a browser and
-- the self-transition carved out above. One policy added carelessly in future
-- would open it. Revoking the privileges as well means such a policy still
-- would not be enough: a caller would need a GRANT and a policy and the
-- trigger's permission, and the first two would have to be added deliberately.
--
-- SELECT is deliberately left in place — `app_users_select_own` needs it.

revoke insert, update, delete, truncate, references on public.app_users from anon;
revoke insert, update, delete, truncate, references on public.app_users from authenticated;

-- --------------------------------------------------------------------------
-- 3. The transition itself.
-- --------------------------------------------------------------------------

create or replace function public.accept_invitation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_status    public.app_user_status;
  v_email     text;
  v_confirmed boolean;
begin
  /*
   * FAILS CLOSED AT EVERY STEP, and each refusal is a different sentence
   * because they need different fixes.
   */
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;

  -- Locked, so two clicks on "Set password" cannot race each other.
  select status, email into v_status, v_email
  from public.app_users
  where id = v_uid
  for update;

  if not found then
    /*
     * A credential with no profile. Not a user of this application, and
     * emphatically not something to create one for — an account that could
     * invent its own profile is an account that could invent its own role.
     */
    raise exception 'No Ask Sunny profile exists for this account.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status = 'disabled' then
    -- Revoked access must not be recoverable by the revoked person.
    raise exception 'This account is disabled.' using errcode = 'insufficient_privilege';
  end if;

  if v_status = 'active' then
    /*
     * IDEMPOTENT. A double submit, a refresh of the confirmation page, or a
     * retry after a dropped response must all be safe — and must not write an
     * audit row claiming the invitation was accepted twice.
     */
    return jsonb_build_object('status', 'active', 'changed', false);
  end if;

  /*
   * The session alone is not proof enough. GoTrue confirms an invited user's
   * email at the moment they follow a real invitation link, so requiring
   * confirmation is what ties this transition to "they clicked the link we
   * sent" rather than merely "they hold a token".
   */
  select (email_confirmed_at is not null) into v_confirmed
  from auth.users where id = v_uid;

  if not coalesce(v_confirmed, false) then
    raise exception 'This account has not confirmed its email address.'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * Status ONLY. Role, scope, email, created_by and updated_by are not in this
   * statement, so there is no version of this call that changes any of them —
   * not a wrong argument, not a crafted payload, because there are no
   * arguments and no payload.
   */
  update public.app_users
     set status = 'active'
   where id = v_uid
     and status = 'invited';

  insert into public.app_user_audit (
    target_user_id, target_email, actor_user_id, actor_email, action,
    from_value, to_value
  )
  values (v_uid, v_email, v_uid, v_email, 'invitation_accepted', 'invited', 'active');

  return jsonb_build_object('status', 'active', 'changed', true);
end;
$$;

comment on function public.accept_invitation() is
  'Moves the CALLER''S OWN profile from invited to active, and nothing else. Takes no arguments: the subject is auth.uid() from the verified JWT, so a caller cannot name a different profile. Refuses a missing profile, a disabled profile and an unconfirmed email; idempotent for an already-active profile. Role, scope and email are not written by this function under any circumstances.';

-- Callable by a signed-in person and by nobody else. `anon` cannot reach it,
-- and PUBLIC is revoked because Postgres grants EXECUTE there on creation —
-- revoking from anon/authenticated alone would leave it callable through that.
revoke execute on function public.accept_invitation() from public;
revoke execute on function public.accept_invitation() from anon;
grant execute on function public.accept_invitation() to authenticated;
