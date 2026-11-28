-- ---------------------------------------------------------------------------
-- WHO HAS ALREADY BEEN ANNOUNCED AS A NEW HIRE — the admins' bell, from Woven.
--
-- Pau, 28 Nov 2026: "create a notification when a new person is onboarded …
-- for admins only for now backfill it". After each successful Woven directory
-- sync, every active employee hired in the last NEW_HIRE_NOTICE_BACKFILL_DAYS
-- days gets one notice in every admin's bell (`app_notifications`,
-- `src/lib/admin/new-hire-notices.ts`). This table is the record that it was
-- sent, so each employee is announced ONCE, ever: removing the notice from a
-- bell does not bring it back, and the next sync does not repeat it.
--
-- ADDITIVE ONLY. One new table; nothing existing is read, rewritten or dropped.
--
-- Keyed by Woven EmployeeID. No name, email or position is stored here: those
-- stay in the directory and in the notices themselves.
--
-- The run CLAIMS an employee by inserting this row (on conflict do nothing)
-- before writing the bell, so two runs at once never announce the same person
-- twice; a failed bell write deletes its claim and the next run tries again.
--
-- RLS IS ENABLED WITH NO POLICIES, like `app_notifications`: only the server,
-- under the secret key, reads or writes it.
-- ---------------------------------------------------------------------------

create table public.woven_new_hire_notices (
  external_employee_id text primary key
    check (external_employee_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  hire_date date,
  -- How many admins' bells it was written to.
  recipients integer not null default 0 check (recipients >= 0),
  notified_at timestamptz not null default now()
);

alter table public.woven_new_hire_notices enable row level security;
alter table public.woven_new_hire_notices force row level security;

revoke all on public.woven_new_hire_notices from anon, authenticated;
grant all on public.woven_new_hire_notices to service_role;
