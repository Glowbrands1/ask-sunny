-- ---------------------------------------------------------------------------
-- CALENDAR (Pau, 26 Nov 2026: one calendar in Ask Sunny, Ask Bubbles and the
-- Leadership Hub; design: Glowbrands1/leadership-hub docs/calendar-design.md).
--
-- The calendar copies nothing: follow-ups, HR approvals and Google Reviews are
-- read from their own tables at view time, and L10 meetings from the Hub. Two
-- new tables only:
--
-- 1. calendar_reminders: personal reminders ("+ New event", or the chat's
--    reminder card that the person confirms). Who can see one: 'only_me' (the
--    default) or 'my_team'. A team reminder carries the salons its owner
--    covered when it was saved (`team_salon_numbers`; null = every salon, for
--    an account with no salon limit), and is shown to the salon directors,
--    DMs, RMs and admins whose salons overlap: the leaders above and below.
--    Idempotent per (owner, ref): Save twice on one card makes one reminder.
-- 2. calendar_partner_nonces: one-time nonces for POST /api/partner/calendar,
--    the Leadership Hub's signed read of a person's events (ten minutes).
--
-- Both are server-only like app_notifications: RLS on and forced, no
-- policies, only the secret key reads or writes them.
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  owner_subject text not null check (length(owner_subject) between 1 and 120),
  owner_email text not null,
  owner_name text not null default '',
  title text not null check (length(btrim(title)) between 1 and 200),
  on_date date not null,
  start_time time,
  visibility text not null default 'only_me' check (visibility in ('only_me', 'my_team')),
  team_salon_numbers text[],
  ref text not null check (ref ~ '^[A-Za-z0-9_-]{1,60}$'),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_subject, ref)
);
create index if not exists calendar_reminders_date_idx on public.calendar_reminders (on_date) where deleted_at is null;
create index if not exists calendar_reminders_owner_idx on public.calendar_reminders (owner_subject, created_at);

alter table public.calendar_reminders enable row level security;
alter table public.calendar_reminders force row level security;
revoke all on public.calendar_reminders from anon, authenticated;
grant all on public.calendar_reminders to service_role;

create table if not exists public.calendar_partner_nonces (
  nonce text primary key check (nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  seen_at timestamptz not null default now()
);
create index if not exists calendar_partner_nonces_seen_idx on public.calendar_partner_nonces (seen_at);

alter table public.calendar_partner_nonces enable row level security;
alter table public.calendar_partner_nonces force row level security;
revoke all on public.calendar_partner_nonces from anon, authenticated;
grant all on public.calendar_partner_nonces to service_role;
