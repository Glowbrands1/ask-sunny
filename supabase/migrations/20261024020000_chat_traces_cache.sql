-- Cache evidence on chat_traces.
-- The table and chat_traces.slots are already applied. These columns are
-- nullable so a writer from before this migration can still insert.
-- CHAT_TRACE_ENABLED still defaults off. Nothing here writes a row.
--
-- The three cache columns are appended after slots. create or replace view
-- can add columns at the end of an existing view. Putting them after
-- latency_ms renames the later columns, and Postgres rejects that with
-- "cannot change name of view column". This file cannot have committed
-- anywhere that error is raised, so the column order is fixed here.

alter table public.chat_traces
  add column if not exists cache_creation_input_tokens integer;

alter table public.chat_traces
  add column if not exists cache_read_input_tokens integer;

alter table public.chat_traces
  add column if not exists first_token_ms integer;

comment on column public.chat_traces.cache_creation_input_tokens is
  'Anthropic usage.cache_creation_input_tokens for this turn. Null when the model did not report it.';

comment on column public.chat_traces.cache_read_input_tokens is
  'Anthropic usage.cache_read_input_tokens for this turn. Null when the model did not report it.';

comment on column public.chat_traces.first_token_ms is
  'Milliseconds from the request until the first text token. Null when the call was not streamed.';

-- A replace without WITH clears security_invoker, which production already set.
create or replace view public.chat_traces_live
with (security_invoker = true) as
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
    slots,
    cache_creation_input_tokens,
    cache_read_input_tokens,
    first_token_ms
  from public.chat_traces;

comment on view public.chat_traces_live is
  'A short reading of chat_traces for the Supabase table editor and SQL editor.';

revoke all on public.chat_traces_live from public, anon, authenticated;
revoke all on public.chat_traces_live from service_role;
grant select on public.chat_traces_live to service_role;
