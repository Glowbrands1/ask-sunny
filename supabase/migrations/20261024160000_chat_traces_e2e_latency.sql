-- End-to-end latency on chat_traces.
-- latency_ms is the model call only. e2e_latency_ms is the chat request
-- received until the last model token. Nullable so a writer from before
-- this migration can still insert. CHAT_TRACE_ENABLED still defaults off.
--
-- The column is appended after first_token_ms. create or replace view can
-- add a column at the end of an existing view. Inserting it earlier renames
-- the later columns, and Postgres rejects that.

alter table public.chat_traces
  add column if not exists e2e_latency_ms integer;

comment on column public.chat_traces.e2e_latency_ms is
  'Milliseconds from when the chat request was received until the last model token. Null when the turn did not call the model. latency_ms remains the model call only.';

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
    first_token_ms,
    e2e_latency_ms
  from public.chat_traces;

comment on view public.chat_traces_live is
  'A short reading of chat_traces for the Supabase table editor and SQL editor.';

revoke all on public.chat_traces_live from public, anon, authenticated;
revoke all on public.chat_traces_live from service_role;
grant select on public.chat_traces_live to service_role;
