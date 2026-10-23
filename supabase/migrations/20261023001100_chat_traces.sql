-- Additive chat trace for CHAT_TRACE_ENABLED.
-- Nothing here alters an existing table. The flag defaults off, and the
-- application does not write a row until that flag is on.
--
-- How to read live chats: Supabase dashboard → Table Editor → chat_traces,
-- or the SQL editor: select * from public.chat_traces_live order by created_at desc.
-- anon and authenticated have no grants. The server writes with the service role.

create table public.chat_traces (
  id uuid primary key default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id text,
  message_id text,
  user_id text,
  original_query text,
  rewritten_query text,
  intent text,
  retrieved jsonb not null default '[]'::jsonb,
  retrieval_count integer,
  prompt text,
  model text,
  max_tokens integer,
  stop_reason text,
  input_tokens integer,
  output_tokens integer,
  thinking_tokens integer,
  latency_ms integer,
  error_subtype text,
  error_class text,
  error_status integer,
  form_in_progress boolean not null default false,
  retryable boolean not null default false,
  retried boolean not null default false,
  succeeded boolean not null default false
);

create index chat_traces_created_at_idx on public.chat_traces (created_at desc);

comment on table public.chat_traces is
  'One row per traced chat turn when CHAT_TRACE_ENABLED is on. Service role only. Read chat_traces_live in the Supabase SQL editor. The answer path does not retry; retried stays false and retryable says a later attempt could succeed.';

create view public.chat_traces_live as
  select
    created_at,
    conversation_id,
    user_id,
    original_query,
    rewritten_query,
    intent,
    retrieval_count,
    model,
    max_tokens,
    stop_reason,
    thinking_tokens,
    latency_ms,
    error_subtype,
    error_class,
    error_status,
    form_in_progress,
    retryable,
    retried,
    succeeded
  from public.chat_traces;

comment on view public.chat_traces_live is
  'A short reading of chat_traces for the Supabase table editor and SQL editor.';

alter table public.chat_traces enable row level security;
alter table public.chat_traces force row level security;

revoke all on public.chat_traces from public, anon, authenticated;
revoke all on public.chat_traces_live from public, anon, authenticated;
grant select, insert on public.chat_traces to service_role;
grant select on public.chat_traces_live to service_role;
