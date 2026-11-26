-- ---------------------------------------------------------------------------
-- Port of the sibling app's 20261126001000_form_follow_up_notices.sql (Ask Bubbles).
-- FOLLOW-UP NOTICES (Pau, 26 Nov 2026): "for the follow up, this is when the
-- manager will follo up with the person, when its due and overdue pls add a
-- notification whoever created the form".
--
-- A daily job (`/api/forms/follow-up/cron`, `src/lib/forms/follow-up-notices.ts`)
-- rings the bell of the person who created the form: once on the day the
-- follow-up is due, once when it is overdue. This table is how it sends each
-- one only once, whatever runs: the job claims `(form, stage, date)` here first
-- and rings only when the claim is new. A moved follow-up date is a new date,
-- so it is announced again; marking the follow-up done stops both.
--
-- RLS is enabled with no policies, like `app_notifications`: only the server,
-- under the secret key, reads or writes it.
-- ---------------------------------------------------------------------------

create table if not exists public.form_follow_up_notice_sends (
  instance_id uuid not null references public.form_instances (id) on delete cascade,
  stage text not null check (stage in ('due', 'overdue')),
  follow_up_date date not null,
  recipient_email text not null,
  sent_at timestamptz not null default now(),
  primary key (instance_id, stage, follow_up_date)
);

alter table public.form_follow_up_notice_sends enable row level security;
alter table public.form_follow_up_notice_sends force row level security;

revoke all on public.form_follow_up_notice_sends from anon, authenticated;
grant all on public.form_follow_up_notice_sends to service_role;
