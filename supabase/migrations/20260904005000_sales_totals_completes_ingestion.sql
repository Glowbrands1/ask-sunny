-- A SALES TOTALS INGESTION HAS TO FINISH, OR IDEMPOTENCY CANNOT WORK.
--
-- THE DEFECT. `ingest_sales_totals` wrote the snapshot and its facts and never
-- touched `report_ingestions`. The attempt `begin_report_ingestion` opened
-- therefore stayed in 'parsing' forever, and that breaks the guarantee the
-- whole design rests on:
--
--   `begin_report_ingestion`'s second idempotency layer short-circuits on an
--   attempt whose status is 'succeeded'. With the attempt stuck in 'parsing'
--   it can never match, so a re-delivery of the SAME bytes opens a NEW attempt
--   and writes a SECOND snapshot — superseding the first and doubling the row
--   count for that report date.
--
--   The first layer does not save it. `report_files` is unique on
--   `file_sha256`, so a re-delivery reuses the file ROW; it says nothing about
--   whether the report was already ingested.
--
-- This was invisible to every local test: a test double answered
-- `begin_report_ingestion` as though the fingerprint were honoured on its own,
-- which is true only for a completed attempt. It took the first real delivery
-- to expose it, and it would have doubled a day's figures on Resend's first
-- retry.
--
-- THE FIX, and why it is inside this function rather than in the caller: the
-- completion belongs in the SAME TRANSACTION as the snapshot and the facts.
-- Marked succeeded from application code, a crash between the two calls would
-- leave a written snapshot with an unfinished attempt — the exact state that
-- caused this. `complete_comp_sales_ingestion` has always worked this way; this
-- brings the two families into line.
--
-- `period_scoped = false` IS SET HERE FOR A REASON. The column defaults TRUE,
-- and `report_ingestions_succeeded_requires_period` refuses a succeeded row
-- that is period-scoped and has no period. Sales Totals is a daily snapshot
-- with no `report_periods` row, so the completion must declare that or be
-- rejected by the constraint.
--
-- NO DATA IS REWRITTEN. `create or replace function` only; the two existing
-- snapshots (2026-09-01 and 2026-09-02, one per date, both live) and their 432
-- facts are untouched.

create or replace function public.ingest_sales_totals(
  p_ingestion_id      uuid,
  p_report_date       date,
  p_report_date_raw   text,
  p_summary_row_count integer,
  p_salon_row_count   integer,
  p_value_count       integer,
  p_warnings          text[],
  p_facts             jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot_id  uuid;
  v_superseded   uuid;
  v_facts_out    integer := 0;
  v_superseded_n integer := 0;
  v_unknown      text[]  := '{}';
  v_salons       integer := 0;
begin
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    raise exception 'p_facts must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  select id into v_superseded
  from public.sales_totals_snapshots
  where report_date = p_report_date
    and superseded_by_ingestion_id is null
  for update;

  if v_superseded is not null then
    update public.sales_totals_facts
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded
       and superseded_by_ingestion_id is null;
    v_superseded_n := coalesce((select count(*) from public.sales_totals_facts
                                 where snapshot_id = v_superseded
                                   and superseded_by_ingestion_id = p_ingestion_id), 0);

    update public.sales_totals_snapshots
       set superseded_by_ingestion_id = p_ingestion_id
     where id = v_superseded;
  end if;

  insert into public.sales_totals_snapshots (
    ingestion_id, report_date, month_start, report_date_raw,
    summary_row_count, salon_row_count, value_count, warnings
  )
  values (
    p_ingestion_id, p_report_date, date_trunc('month', p_report_date)::date,
    p_report_date_raw, p_summary_row_count, p_salon_row_count, p_value_count,
    coalesce(p_warnings, '{}')
  )
  returning id into v_snapshot_id;

  with incoming as (
    select
      f->>'scope_kind'                       as scope_kind,
      f->>'scope_code'                       as scope_code,
      f->>'store_name'                       as store_name,
      f->>'metric_code'                      as metric_code,
      f->>'report_window'                    as report_window,
      nullif(f->>'value', '')::numeric       as value,
      nullif(f->>'salon_count', '')::integer as salon_count,
      nullif(f->>'source_row', '')::integer  as source_row
    from jsonb_array_elements(p_facts) as f
  ),
  written as (
    insert into public.sales_totals_facts (
      ingestion_id, snapshot_id, report_date, scope_kind,
      scope_id, salon_id, metric_id, report_window, value, salon_count, source_row
    )
    select
      p_ingestion_id, v_snapshot_id, p_report_date,
      i.scope_kind::public.sales_totals_scope_kind,
      sc.id,
      sa.id,
      m.id,
      i.report_window::public.sales_totals_window,
      i.value,
      case when i.scope_kind = 'summary' then i.salon_count else null end,
      i.source_row
    from incoming i
    join public.sales_totals_metrics m on m.code = i.metric_code
    left join public.sales_totals_scopes sc
           on i.scope_kind = 'summary' and sc.code = i.scope_code
    left join public.salons sa
           on i.scope_kind = 'salon' and sa.store_name = i.store_name
    where (i.scope_kind = 'summary' and sc.id is not null)
       or (i.scope_kind = 'salon'   and sa.id is not null)
    returning 1
  )
  select count(*) into v_facts_out from written;

  select coalesce(array_agg(distinct name), '{}') into v_unknown
  from (
    select f->>'store_name' as name
    from jsonb_array_elements(p_facts) as f
    where f->>'scope_kind' = 'salon'
      and not exists (
        select 1 from public.salons s where s.store_name = f->>'store_name'
      )
  ) missing;

  -- How many distinct salons this delivery actually filed for, for the
  -- attempt's own record. Counted from what was WRITTEN, not from what arrived.
  select count(distinct salon_id) into v_salons
  from public.sales_totals_facts
  where snapshot_id = v_snapshot_id
    and salon_id is not null;

  /*
   * THE COMPLETION — the part that was missing.
   *
   * Same transaction as the snapshot and the facts, so the attempt cannot be
   * left unfinished beside a written report. `period_scoped = false` is what
   * makes a succeeded attempt legal without a `report_periods` row.
   */
  update public.report_ingestions
     set status         = 'succeeded',
         period_scoped  = false,
         period_id      = null,
         fact_count     = v_facts_out,
         salon_count    = v_salons,
         warnings       = coalesce(p_warnings, '{}'),
         failure_reason = null,
         finished_at    = now()
   where id = p_ingestion_id;

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'facts_written', v_facts_out,
    'facts_superseded', v_superseded_n,
    'superseded_snapshot_id', v_superseded,
    'unresolved_salons', to_jsonb(v_unknown)
  );
end;
$$;

comment on function public.ingest_sales_totals(uuid, date, text, integer, integer, integer, text[], jsonb) is
  'Writes one Sales Totals snapshot, its facts AND the completion of its ingestion attempt in a single transaction, superseding any earlier live snapshot for the SAME report_date. Marking the attempt succeeded is what lets begin_report_ingestion recognise a re-delivery; period_scoped is set false because a daily snapshot has no report_periods row. Salon rows resolve by exact store_name; unresolved names are returned, never invented.';

revoke all on function public.ingest_sales_totals(uuid, date, text, integer, integer, integer, text[], jsonb) from anon, authenticated;
