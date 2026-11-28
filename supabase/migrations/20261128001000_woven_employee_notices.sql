-- ---------------------------------------------------------------------------
-- WHAT HAS ALREADY BEEN ANNOUNCED — hired, terminated, sign-in link sent.
--
-- Pau, 28 Nov 2026: a notice for every new hire (admins, the managers of any
-- salon the person is in, and HR), every termination (HR), backfilled two
-- weeks, and an email to her (through her n8n webhook) when someone joins, is
-- terminated, or is sent their sign-in link (`src/lib/admin/new-hire-notices.ts`).
--
-- This table is the record that an event was announced, so each one is
-- announced ONCE, ever: removing the notice from a bell does not bring it back,
-- and the next sync does not repeat it. `webhook_sent_at` stays empty until
-- the webhook accepted it, so a failed one is retried by the next sync.
--
-- ADDITIVE ONLY. One new table; nothing existing is read, rewritten or dropped.
--
-- Keyed by Woven EmployeeID, the event and its date (a rehire, or a second
-- termination, is a new event). No name, email or position is stored here.
--
-- The run CLAIMS an event by inserting its row (on conflict do nothing) before
-- writing the bell, so two runs at once never announce it twice; a failed bell
-- write deletes its claim and the next run tries again.
--
-- RLS IS ENABLED WITH NO POLICIES, like `app_notifications`: only the server,
-- under the secret key, reads or writes it.
-- ---------------------------------------------------------------------------

create table public.woven_employee_notices (
  event text not null check (event in ('hired', 'terminated', 'invite_sent')),
  external_employee_id text not null
    check (external_employee_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  event_date date not null,
  -- How many bells it was written to.
  recipients integer not null default 0 check (recipients >= 0),
  notified_at timestamptz not null default now(),
  webhook_sent_at timestamptz,
  primary key (event, external_employee_id, event_date)
);

create index woven_employee_notices_employee_idx
  on public.woven_employee_notices (external_employee_id);

alter table public.woven_employee_notices enable row level security;
alter table public.woven_employee_notices force row level security;

revoke all on public.woven_employee_notices from anon, authenticated;
grant all on public.woven_employee_notices to service_role;
