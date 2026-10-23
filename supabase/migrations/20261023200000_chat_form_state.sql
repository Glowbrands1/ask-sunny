-- Additive per-conversation form state for FORM_STATE_ENABLED.
-- Nothing here alters an existing table. The application does not read or
-- write a row until that flag is on. This migration is not applied from the app.

create table public.chat_form_state (
  id uuid primary key default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id text not null,
  conversation_id text not null,
  state jsonb not null,
  unique (user_id, conversation_id)
);

comment on table public.chat_form_state is
  'Structured form facts for one chat: employee, salon, title, dates, warning level, payroll, policy, and a chosen disambiguation. Service role only. Unused until FORM_STATE_ENABLED is on.';

alter table public.chat_form_state enable row level security;
alter table public.chat_form_state force row level security;

revoke all on public.chat_form_state from public, anon, authenticated;
grant select, insert, update on public.chat_form_state to service_role;
