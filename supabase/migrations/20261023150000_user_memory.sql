-- Per-user chat notes for CHAT_MEMORY_ENABLED.
-- Not applied by this change. The flag defaults off, and the server
-- does not read or write the table until that flag is on.
--
-- Each authenticated user can see only their own rows. The server uses
-- the service role and still filters every query on user_id.

create table public.user_memory (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id text not null,
  kind text not null check (kind in ('salon', 'employee', 'preference')),
  key text not null,
  value text not null,
  source_conversation_id text,
  updated_at timestamptz not null default now(),
  unique (user_id, kind, key)
);

create index user_memory_user_updated_idx on public.user_memory (user_id, updated_at desc);

comment on table public.user_memory is
  'Notes a user asked Ask Sunny to keep. RLS: auth.uid() = user_id. Service role queries filter on user_id as well.';

alter table public.user_memory enable row level security;
alter table public.user_memory force row level security;

revoke all on public.user_memory from public, anon;
grant select, insert, update, delete on public.user_memory to authenticated;
grant select, insert, update, delete on public.user_memory to service_role;

create policy user_memory_own_rows on public.user_memory
  for all
  to authenticated
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
