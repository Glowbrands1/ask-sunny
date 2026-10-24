-- The model's raw answer on chat_traces.
-- chat_messages keeps the text after citation checks and marker stripping.
-- raw_answer is the answer call's text before any of that, so a citation bug
-- can be replayed from what the model wrote. Capped at 20,000 characters by
-- the writer. Nullable, appended after e2e_latency_ms.
--
-- Written only when CHAT_TRACE_ENABLED and CHAT_TRACE_RAW_ANSWER_ENABLED are
-- both on. With the second flag off the insert does not name this column, so
-- the app works before this file is applied.
--
-- chat_traces_live is not changed. It lists named columns, not *, and it
-- leaves out the long text columns (prompt, retrieved). Read raw_answer from
-- chat_traces with the service role:
--   select created_at, conversation_id, raw_answer
--     from public.chat_traces order by created_at desc;

alter table public.chat_traces
  add column if not exists raw_answer text;

comment on column public.chat_traces.raw_answer is
  'The answer call''s text as the model returned it, before citation checks or post-processing. First 20,000 characters. Null unless CHAT_TRACE_RAW_ANSWER_ENABLED was on for the turn.';
