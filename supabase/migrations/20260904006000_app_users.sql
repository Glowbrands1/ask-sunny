-- ---------------------------------------------------------------------------
-- THE APPLICATION USER — who a person IS in Ask Sunny, beside who Supabase Auth
-- says they are.
--
-- Supabase Auth owns credentials and nothing else: passwords, recovery tokens
-- and sessions live in `auth`, and this project never sees, stores or hashes a
-- password. What Auth does NOT own is the org chart. Role, status and scope are
-- this application's own facts, so they live here, keyed to `auth.users.id`.
--
-- WHY NOT `user_metadata`. It is writable by the user it describes. A role kept
-- there is a role the holder can edit, which makes it worthless as an
-- authorization input. The same argument rules out any browser-held copy.
--
-- WHY A SEPARATE TABLE RATHER THAN A VIEW OVER `auth.users`. A profile has to
-- be able to exist in `invited` state, to be disabled without destroying the
-- credential, and to carry scope that Auth has no concept of.
--
-- FAIL CLOSED IS THE WHOLE POINT. A verified Auth session with no row here
-- resolves to NO access. There is no "missing profile defaults to admin" and no
-- "fall back to the role the browser sent" — see `getAppUser` on the server.
--
-- ADDITIVE ONLY. This migration creates new types, one new table, one audit
-- table, policies and triggers. It reads nothing, rewrites nothing, and drops
-- nothing. Forms, reporting, Sales Totals, knowledge and Storage are untouched.
-- ---------------------------------------------------------------------------

/*
 * ROLE IS AN ENUM, deliberately.
 *
 * A typo becomes a rejected write rather than a user with an unrecognised role
 * that every permission lookup silently denies — or worse, that some future
 * `?? "admin"` treats as privileged. Adding a role is a migration, which is
 * correct while role POLICY is code-controlled.
 *
 * `employee` is the frontline role: Ask Sunny, Knowledge Base, Videos, nothing
 * else. `admin` is the CLIENT administrator — full access, and distinct from
 * `developer`, which stays for internal build and support work. They are
 * separate because "the customer's administrator" and "the people who build
 * the software" are different jobs that happen to share a permission set
 * today, and conflating them would leave no way to describe either.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_user_role') then
    create type public.app_user_role as enum (
      'employee',
      'assistant_salon_director',
      'salon_director',
      'district_manager',
      'regional_manager',
      'admin',
      'owner',
      'developer'
    );
  end if;
end
$$;

/*
 * STATUS, modelling what Supabase Auth can actually tell us apart.
 *
 *   invited  — the profile exists and an invitation was sent; the person has
 *              not chosen a password yet. Distinguished from `active` so User
 *              Management can show the truth and offer "resend invite" rather
 *              than presenting a pending person as a working account.
 *   active   — may sign in and use the app.
 *   disabled — the credential may still exist, and access is refused anyway.
 *              Disabling is reversible and destroys nothing, which is what
 *              makes it the right answer for somebody who has left.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_user_status') then
    create type public.app_user_status as enum ('invited', 'active', 'disabled');
  end if;
end
$$;

/*
 * SCOPE mirrors the application's existing `AccessScope` exactly — level, one
 * primary area, and any additional areas covered. Mirrored rather than
 * redesigned so the identity a route receives is the shape every existing
 * caller already handles.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_scope_level') then
    create type public.app_scope_level as enum ('global', 'region', 'district', 'salon');
  end if;
end
$$;

create table if not exists public.app_users (
  /*
   * THE SAME ID AS THE CREDENTIAL. `on delete cascade` because a profile
   * without its auth user is unreachable by definition — nothing could ever
   * sign in as it — so keeping the orphan would only mean a row that looks like
   * an account and is not one.
   */
  id uuid primary key references auth.users (id) on delete cascade,

  /*
   * A CONVENIENCE COPY of the address, for listing users without querying the
   * auth schema on every read. `auth.users.email` remains authoritative; this
   * is kept in step by the admin routes that change it.
   */
  email text not null,

  display_name text not null,
  role public.app_user_role not null,
  status public.app_user_status not null default 'invited',

  scope_level public.app_scope_level not null default 'salon',
  scope_primary_area_id text,
  scope_also_covers_area_ids text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /* Who made the change, as an auth user id where one is known. */
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,

  /*
   * A GLOBAL scope names no area; every narrower level must name one. Without
   * this a district manager could exist with no district, and every scoped
   * query would silently return everything or nothing.
   */
  constraint app_users_scope_area_coherent check (
    (scope_level = 'global' and scope_primary_area_id is null)
    or (scope_level <> 'global' and scope_primary_area_id is not null)
  )
);

comment on table public.app_users is
  'The application profile for an authenticated person: role, status and scope, keyed to auth.users.id. Supabase Auth owns the credential; this owns the org chart. A verified session with no row here has NO access.';

comment on column public.app_users.email is
  'Convenience copy of auth.users.email for listing. Compared case-insensitively via the unique index on lower(email); auth.users remains authoritative.';

/*
 * EMAIL IS UNIQUE CASE-INSENSITIVELY.
 *
 * `Curt.Bowen@suntancity.com` and `curt.bowen@suntancity.com` are one person.
 * A plain unique constraint would admit both and leave two profiles competing
 * to describe the same account, so the index is on `lower(email)` and every
 * lookup lowercases. `citext` would do the same job; an expression index needs
 * no extension and keeps the stored value exactly as the administrator typed it.
 */
create unique index if not exists app_users_email_key on public.app_users (lower(email));

/* Listing users, and the last-admin check below, both read by role + status. */
create index if not exists app_users_role_status on public.app_users (role, status);

create trigger app_users_touch_updated_at
  before update on public.app_users
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------- the audit ---
--
-- WHO CHANGED WHOSE ROLE, AND WHEN. Not a general activity log: only the three
-- security-sensitive acts, because those are the ones somebody will later need
-- to answer for.
--
-- NOTHING SECRET IS RECORDABLE HERE. There is no column for a password, a
-- token, or an invitation link — the shape refuses them rather than relying on
-- callers to be careful.

create table if not exists public.app_user_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  /* The profile the change was made TO. Kept if the profile is later removed. */
  target_user_id uuid,
  target_email text not null,
  /* Who did it. Null only for a bootstrap performed with the secret key. */
  actor_user_id uuid,
  actor_email text,
  action text not null check (
    action in ('invited', 'role_changed', 'status_changed', 'reset_requested', 'invite_resent')
  ),
  /* Previous and next value of whatever changed, as plain labels. */
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);

comment on table public.app_user_audit is
  'Security-sensitive user-management history: who changed whose role or status, and when. Carries no credential, token or invitation link — there is no column that could hold one.';

create index if not exists app_user_audit_by_target
  on public.app_user_audit (target_user_id, created_at desc);

-- ------------------------------------------------------- self-elevation ---
--
-- A USER MAY NEVER CHANGE THEIR OWN ROLE OR STATUS.
--
-- Today this is already impossible: `authenticated` holds no UPDATE policy, so
-- the only writer is the secret key, server-side, after
-- `authorizeRequest("manage_users")` has passed. The trigger exists for the
-- day somebody adds a well-meaning "let a user edit their own display name"
-- policy — an UPDATE policy is easy to widen by accident, and this makes the
-- dangerous half of it fail loudly instead.
--
-- It keys on the CALLER'S OWN auth uid, not on a value in the row, so it cannot
-- be satisfied by sending different data.

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
      raise exception 'A user cannot change their own status.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger app_users_no_self_elevation
  before update on public.app_users
  for each row execute function public.app_users_guard_self_elevation();

-- ---------------------------------------------------------- the last admin ---
--
-- THE APPLICATION MUST NEVER BE LEFT WITH NO ADMINISTRATOR.
--
-- Demoting, disabling or deleting the last active administrative account locks
-- everybody out of User Management permanently — there would be no one left who
-- could put it right, and no supported way back in short of hand-editing the
-- database.
--
-- IN THE DATABASE, NOT IN A ROUTE, and generic rather than keyed to any
-- person's address. A check in one API handler protects that handler; a trigger
-- protects every path, including a future bulk update, a repair script, and the
-- privileged client. Curt is the first administrator but nothing here knows or
-- cares who he is.
--
-- "Administrative" means the roles that reach the admin console: admin, owner,
-- developer. Kept in step with `ADMIN_CONSOLE_ROLES` in the application, and
-- asserted against it by a test so the two cannot drift.

create or replace function public.app_users_guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_admin boolean;
  v_still_admin boolean;
  v_remaining integer;
begin
  v_was_admin := old.role in ('admin', 'owner', 'developer') and old.status = 'active';

  if not v_was_admin then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    v_still_admin := false;
  else
    v_still_admin := new.role in ('admin', 'owner', 'developer') and new.status = 'active';
  end if;

  -- Still an administrator afterwards: nothing to protect against.
  if v_still_admin then
    return new;
  end if;

  select count(*) into v_remaining
  from public.app_users
  where id <> old.id
    and status = 'active'
    and role in ('admin', 'owner', 'developer');

  if v_remaining = 0 then
    raise exception
      'This is the last active administrator. Give another account an administrative role before changing this one.'
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger app_users_keep_one_admin
  before update or delete on public.app_users
  for each row execute function public.app_users_guard_last_admin();

-- ------------------------------------------------------------------- RLS ---
--
-- ENABLED AND FORCED, with ONE policy: a signed-in person may read their own
-- row and nothing else.
--
-- WHAT THAT DELIBERATELY EXCLUDES:
--
--   the user DIRECTORY. `authenticated` cannot list other people, so an
--   employee cannot enumerate the company's staff, roles and email addresses
--   from the browser. User Management reads through the server with the secret
--   key AFTER `authorizeRequest("manage_users")` passes.
--
--   every WRITE. No INSERT, UPDATE or DELETE policy exists for any
--   browser-held role, so a user cannot create a profile, promote themselves,
--   or re-enable a disabled account. Combined with the trigger above, self
--   elevation is refused twice by two different mechanisms.
--
--   ANON entirely. An unauthenticated caller matches no policy.
--
-- FORCED matters because it applies to the table owner too, so a future
-- `security definer` function cannot read past the policy by accident.

alter table public.app_users enable row level security;
alter table public.app_users force row level security;

alter table public.app_user_audit enable row level security;
alter table public.app_user_audit force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_users'
      and policyname = 'app_users_select_own'
  ) then
    create policy app_users_select_own
      on public.app_users for select to authenticated
      using (id = auth.uid());
  end if;
end
$$;

grant select on public.app_users to authenticated;

/*
 * The audit trail has NO policy at all, for either browser role. It is read by
 * the server with the secret key when an administrator asks for it; a person's
 * own history is not something they need to query from the browser, and the
 * trail names other people.
 */
revoke all on public.app_user_audit from anon, authenticated;

/*
 * THE TWO GUARD FUNCTIONS ARE TRIGGERS, NOT AN API.
 *
 * Both are `security definer`, which they must be — a trigger that enforces an
 * invariant cannot run with the privileges of whoever tripped it. But
 * PostgREST exposes every function in `public` as an RPC endpoint, and the
 * database linter is right to flag a `security definer` function that `anon`
 * can call: `/rest/v1/rpc/app_users_guard_last_admin`. Calling one outside a
 * trigger fails for want of OLD/NEW rather than doing damage, and an
 * anonymously-callable elevated function still has no business being on the
 * exposed surface.
 *
 * Execute is therefore revoked from PUBLIC first, and that is the line that
 * does the work: Postgres grants EXECUTE to PUBLIC on every new function, so
 * revoking from `anon, authenticated` alone changes nothing -- the roles keep
 * the privilege through PUBLIC. Both revokes are kept, because a later GRANT
 * to either role individually should be undone here too.
 *
 * The triggers themselves are unaffected: a trigger runs as part of the
 * statement that fired it and does not consult EXECUTE on the function.
 */
revoke execute on function public.app_users_guard_self_elevation() from public;
revoke execute on function public.app_users_guard_self_elevation() from anon, authenticated;
revoke execute on function public.app_users_guard_last_admin() from public;
revoke execute on function public.app_users_guard_last_admin() from anon, authenticated;
