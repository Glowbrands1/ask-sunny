-- ---------------------------------------------------------------------------
-- WRITING A SALES TOTALS SNAPSHOT, TRANSACTIONALLY.
--
-- One call does three things or none of them: supersede the previous live
-- snapshot for THIS report date, open a new one, write its facts. A partial
-- write would leave a day half-reported, which is worse than not ingesting it.
--
-- WHAT SUPERSESSION IS SCOPED TO, and this is the whole design:
--
--   * A CORRECTED REPORT FOR THE SAME DATE supersedes the earlier snapshot.
--     Nothing is deleted — the old rows keep their ingestion id and are marked
--     superseded, so a disputed figure can still be traced to the delivery it
--     came from.
--   * A REPORT FOR A DIFFERENT DATE supersedes NOTHING. Each day is its own
--     snapshot and they coexist. This is why an older report ingested late
--     cannot displace a newer one: the read side orders by `report_date`, not
--     by when a row was written, so backfilling Sep 1 after Sep 2 restores
--     history without changing what "latest" means.
--   * IDENTICAL BYTES never arrive here at all. The file digest stops a
--     re-delivery upstream, in `begin_report_ingestion`.
--
-- SALON ROWS RESOLVE BY EXACT `store_name`, and by nothing else. This report
-- carries no salon number, so an unrecognised name cannot be turned into a
-- salon row without inventing an identifier for it. Those rows are skipped and
-- their names returned to the caller, which is the honest outcome: a reported
-- gap beats a fabricated salon or a fuzzy match onto the wrong store. All 15
-- names in the observed reports match exactly.
-- ---------------------------------------------------------------------------

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
  'Writes one Sales Totals snapshot and its facts in a single transaction, superseding any earlier live snapshot for the SAME report_date. A report for a different date never supersedes another. Salon rows resolve by exact store_name; unresolved names are returned, never invented.';

revoke all on function public.ingest_sales_totals(uuid, date, text, integer, integer, integer, text[], jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- READ POLICIES.
--
-- Mirrors the Comp Report domain exactly: one read-only SELECT policy per table
-- for `authenticated`, and nothing else. Writes stay the secret key's alone
-- (service_role bypasses RLS by design), and the browser-held roles keep no
-- INSERT/UPDATE/DELETE because they were revoked at creation.
--
-- Without these the tables have RLS enabled AND forced but no policy, which the
-- database linter reports and which would silently break reads the moment
-- employee login ships and pages begin querying as `authenticated`. Narrowing
-- by district still needs stable district codes this source does not carry.
-- ---------------------------------------------------------------------------

create policy sales_totals_metrics_select_authenticated
  on public.sales_totals_metrics for select to authenticated using (true);

create policy sales_totals_scopes_select_authenticated
  on public.sales_totals_scopes for select to authenticated using (true);

create policy sales_totals_snapshots_select_authenticated
  on public.sales_totals_snapshots for select to authenticated using (true);

create policy sales_totals_facts_select_authenticated
  on public.sales_totals_facts for select to authenticated using (true);

grant select on public.sales_totals_metrics       to authenticated;
grant select on public.sales_totals_scopes        to authenticated;
grant select on public.sales_totals_snapshots     to authenticated;
grant select on public.sales_totals_facts         to authenticated;
grant select on public.sales_totals_current_facts to authenticated;
