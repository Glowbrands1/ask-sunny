-- Additive rolling summary for LONG_CONTEXT_ENABLED.
-- Nothing here alters an existing table. The application does not read or
-- write a row until that flag is on.

create table public.chat_context_summaries (
  id uuid primary key default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id text not null,
  conversation_id text not null,
  through_message_id text,
  summary text not null,
  unique (user_id, conversation_id)
);

comment on table public.chat_context_summaries is
  'A short summary of chat turns that fell outside the long-context window. Service role only. Unused until LONG_CONTEXT_ENABLED is on.';

alter table public.chat_context_summaries enable row level security;
alter table public.chat_context_summaries force row level security;

revoke all on public.chat_context_summaries from public, anon, authenticated;
grant select, insert, update on public.chat_context_summaries to service_role;
