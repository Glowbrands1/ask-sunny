-- Per-turn slot state on the existing chat_traces table.
-- CHAT_TRACE_ENABLED still defaults off. Nothing here writes a row.
-- The column is what a turn settled: employee, salon, date, policy, and a
-- pending yes/no. Service role only, same as the table.

alter table public.chat_traces
  add column if not exists slots jsonb not null default '{}'::jsonb;

comment on column public.chat_traces.slots is
  'Form slots after this turn: employee, salon, date, policy, template, pending confirmation. Empty when the turn did not settle a form.';

create or replace view public.chat_traces_live as
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
    succeeded,
    slots
  from public.chat_traces;

comment on view public.chat_traces_live is
  'A short reading of chat_traces for the Supabase table editor and SQL editor.';

revoke all on public.chat_traces_live from public, anon, authenticated;
grant select on public.chat_traces_live to service_role;
