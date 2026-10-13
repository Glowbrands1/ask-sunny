-- ---------------------------------------------------------------------------
-- APP SWITCHER GRANT — lets a NAMED non-administrator see the Ask Sunny / Ask
-- Bubbles switcher, and nothing else.
--
-- The switcher was administrators-only. This adds a per-person flag so a
-- manager can be offered the link without being given an administrative role.
-- It changes no role, permission or scope, and the other app's own sign-in and
-- roles still decide what that person can do there. Default false, so nobody
-- gains anything by this migration except the people named below.
--
-- Written only by the server/operator (no UPDATE policy exists for browser
-- roles), read by the person themselves under the existing select-own policy.
-- ---------------------------------------------------------------------------
alter table public.app_users
  add column if not exists can_switch_apps boolean not null default false;

comment on column public.app_users.can_switch_apps is
  'Offers the Ask Sunny / Ask Bubbles app switcher to a non-administrator. Grants the link only; no role, permission or scope changes. Administrators always see the switcher regardless.';

-- No-op wherever these accounts do not exist (e.g. a fresh database).
update public.app_users
   set can_switch_apps = true
 where lower(email) in ('dj.wade@glowbrands.com', 'colene.schildt@glowbrands.com');
