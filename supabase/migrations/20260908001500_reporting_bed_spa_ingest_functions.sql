-- ---------------------------------------------------------------------------
-- THE TRANSACTIONAL WRITES FOR THE THREE NEW REPORT FAMILIES.
--
-- Same shape as `complete_comp_sales_ingestion` and for the same reason:
-- supabase-js has no client-side transaction, so an atomic write of a period,
-- its salons and its facts is not expressible from the application. A function
-- body IS one transaction.
--
-- Each function does the whole write or none of it, and marks the attempt
-- succeeded INSIDE the same transaction — so a half-written report can never
-- be marked successful. `begin_report_ingestion` and `fail_report_ingestion`
-- are reused unchanged: the file row, the attempt row, all four idempotency
-- layers and the failure history are the existing mechanism, and nothing here
-- duplicates them.
--
-- SUPERSESSION IS SCOPED TO (PERIOD, COMPANY) in every one of them. A corrected
-- report for the same month supersedes the earlier one; a report for a
-- different month supersedes NOTHING. That is what lets a July backfill land in
-- the Period control weeks after August without disturbing it, and it is why
-- each function computes its supersession from `period_id` rather than from
-- "the latest snapshot".
--
-- A SALON ROW IS NEVER INVENTED. Salons resolve on the zero-padded TEXT salon
-- number where the delivery supplies one, and on the exact store name where it
-- does not. An unresolved name is RETURNED to the caller and its facts are
-- skipped, which is the honest outcome — a reported gap beats a fabricated
-- salon, and `KS Lawrence` and `KS Lawrenceburg` are two real salons eight
-- characters apart.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A shared helper: resolve or create the period, and upsert salons.
--
-- `p_salons` is `[{salon_number, store_name}]`. A salon_number of null means
-- "match this store name if you already know it, and do not create it" — the
-- Bed Usage and SPA Wellness reports carry no salon number, so only a delivery
-- with a roster (Spa Engagement) may introduce a salon.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_bed_spa_period(
  p_period jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_grain      public.report_period_grain := (p_period->>'grain')::public.report_period_grain;
  v_period_end date := (p_period->>'period_end')::date;
  v_period_id  uuid;
begin
  /*
   * A PERIOD IS CREATED ON FIRST SIGHT AND REUSED THEREAFTER, so a new report
   * can only ever append.
   *
   * `do nothing`, NOT `do update set label_raw`, AND THAT IS THE WHOLE POINT.
   *
   * The period row is SHARED with the Comp Report. Bed Usage covers 1-31 August
   * and lands on (mtd, 2026-08-31) — the same row the Comp Report already
   * created and already names. `report_periods.label_raw` is what Salon
   * Performance prints in its scope banner, its salon header and its data
   * source panel, so refreshing it here would have retitled the COMP REPORT's
   * period with the Bed Usage workbook's name: a visible change to a working
   * dashboard, and an overwrite of another report's provenance.
   *
   * There is nothing to gain from the refresh either. Every Bed/Spa snapshot
   * records its own `source_period_label`, which is what the three new tabs
   * display, so the shared column can stay as the FIRST report to describe this
   * window wrote it.
   */
  insert into public.report_periods (grain, period_end, period_start, fiscal_year, label_raw)
  values (
    v_grain,
    v_period_end,
    (p_period->>'period_start')::date,
    (p_period->>'fiscal_year')::integer,
    p_period->>'label_raw'
  )
  on conflict (grain, period_end) do nothing
  returning id into v_period_id;

  -- `do nothing` returns no row when the period already existed, so read it.
  if v_period_id is null then
    select id into v_period_id
    from public.report_periods
    where grain = v_grain and period_end = v_period_end;
  end if;

  if v_period_id is null then
    raise exception 'Could not resolve or create the reporting period % %', v_grain, v_period_end
      using errcode = 'no_data_found';
  end if;

  return v_period_id;
end;
$$;

comment on function public.upsert_bed_spa_period(jsonb) is
  'Creates a reporting period on first sight and reuses it thereafter. Keyed on (grain, period_end), so MTD, YTD and LTM through the same day are three periods.';

revoke all on function public.upsert_bed_spa_period(jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. BED USAGE.
--
-- `p_payload` carries `period`, `company`, `salons`, `equipment`,
-- `benchmarks`, `diagnostics` and `warnings`.
-- ---------------------------------------------------------------------------

create or replace function public.complete_bed_usage_ingestion(
  p_ingestion_id uuid,
  p_payload      jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_period_id      uuid;
  v_snapshot_id    uuid;
  v_superseded     uuid;
  v_company        text := p_payload->>'company';
  v_salon_rows     integer := 0;
  v_equipment_rows integer := 0;
  v_benchmark_rows integer := 0;
  v_superseded_n   integer := 0;
  v_unresolved     text[] := '{}';
begin
  if v_company is null or btrim(v_company) = '' then
    raise exception 'The payload names no company' using errcode = 'invalid_parameter_value';
  end if;

  v_period_id := public.upsert_bed_spa_period(p_payload->'period');

  -- SUPERSEDE THE PREVIOUS LIVE SNAPSHOT FOR THIS PERIOD AND COMPANY, and
  -- nothing else. `for update` serialises two concurrent deliveries of the
  -- same month rather than letting both believe they are the live one.
  select id into v_superseded
  from public.bed_usage_snapshots
  where period_id = v_period_id
    and company = v_company
    and superseded_by_ingestion_id is null
  for update;

  if v_superseded is not null then
    update public.bed_usage_salon_facts
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;
    v_superseded_n := v_superseded_n + coalesce(
      (select count(*) from public.bed_usage_salon_facts
        where snapshot_id = v_superseded and superseded_by_ingestion_id = p_ingestion_id), 0);

    update public.bed_usage_equipment_facts
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;
    v_superseded_n := v_superseded_n + coalesce(
      (select count(*) from public.bed_usage_equipment_facts
        where snapshot_id = v_superseded and superseded_by_ingestion_id = p_ingestion_id), 0);

    update public.bed_usage_chain_benchmarks
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;

    update public.bed_usage_snapshots
       set superseded_by_ingestion_id = p_ingestion_id
     where id = v_superseded;
  end if;

  /*
   * SALONS ARE MATCHED, NEVER CREATED, on this path. The Bed Usage report
   * carries no salon number, so a store name this application has never seen
   * cannot be given an identifier without inventing one. The names are
   * returned instead.
   */
  select coalesce(array_agg(distinct s.store_name), '{}') into v_unresolved
  from jsonb_to_recordset(p_payload->'salons') as s(store_name text, total_tans numeric, bed_count integer, source_row integer)
  where not exists (select 1 from public.salons x where x.store_name = s.store_name);

  insert into public.bed_usage_snapshots (
    ingestion_id, period_id, company, source_period_label,
    source_salon_count, source_company_count,
    salon_count, equipment_count, warnings
  )
  values (
    p_ingestion_id, v_period_id, v_company,
    p_payload->'period'->>'label_raw',
    nullif(p_payload->'diagnostics'->>'source_salon_count', '')::integer,
    nullif(p_payload->'diagnostics'->>'source_company_count', '')::integer,
    coalesce(jsonb_array_length(p_payload->'salons'), 0),
    coalesce(jsonb_array_length(p_payload->'equipment'), 0),
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'warnings', '[]'::jsonb))),
      '{}'
    )
  )
  returning id into v_snapshot_id;

  with incoming as (
    select * from jsonb_to_recordset(p_payload->'salons') as s(
      store_name text, total_tans numeric, bed_count integer, source_row integer
    )
  ), written as (
    insert into public.bed_usage_salon_facts (
      ingestion_id, snapshot_id, period_id, salon_id, total_tans, bed_count, source_row
    )
    select p_ingestion_id, v_snapshot_id, v_period_id, sa.id, i.total_tans, i.bed_count, i.source_row
    from incoming i
    join public.salons sa on sa.store_name = i.store_name
    returning 1
  )
  select count(*) into v_salon_rows from written;

  /*
   * AN INGESTION THAT RESOLVED NO SALONS IS A FAILURE, NOT AN EMPTY SUCCESS.
   *
   * The raise rolls the whole transaction back — including the supersession
   * above — so the previous month's live facts survive. Without it a delivery
   * whose salons could not be matched would supersede a good period with
   * nothing and the dashboard would report zero salons as though that were the
   * answer.
   *
   * THE COMMONEST CAUSE IS ORDERING, and the message says so. This report
   * carries no salon number, so it can only MATCH salons this application
   * already knows; the Spa Engagement delivery's `Roster` is the only source
   * of a salon number in any of the three reports, so it has to land first the
   * first time a company is onboarded.
   */
  if v_salon_rows = 0 then
    raise exception
      'No salon in this Bed Usage delivery matched a known salon (% named). This report carries no salon number, so salons must already exist: ingest the Spa Engagement delivery first, whose Roster is the only source of one.',
      coalesce(jsonb_array_length(p_payload->'salons'), 0)
      using errcode = 'no_data_found';
  end if;

  with incoming as (
    select * from jsonb_to_recordset(p_payload->'equipment') as e(
      store_name text, level text, bed_type text, qty integer,
      client_tans numeric, total_tans_with_employee numeric, per_bed numeric,
      v_chain_percent numeric, v_chain_ratio numeric, v_bed_type_percent numeric,
      share_of_salon_tans numeric, share_of_salon_beds numeric, source_row integer
    )
  ), written as (
    insert into public.bed_usage_equipment_facts (
      ingestion_id, snapshot_id, period_id, salon_id,
      level, bed_type, qty, client_tans, total_tans_with_employee, per_bed,
      v_chain_percent, v_chain_ratio, v_bed_type_percent,
      share_of_salon_tans, share_of_salon_beds, source_row
    )
    select
      p_ingestion_id, v_snapshot_id, v_period_id, sa.id,
      i.level, i.bed_type, i.qty, i.client_tans, i.total_tans_with_employee, i.per_bed,
      i.v_chain_percent, i.v_chain_ratio, i.v_bed_type_percent,
      i.share_of_salon_tans, i.share_of_salon_beds, i.source_row
    from incoming i
    join public.salons sa on sa.store_name = i.store_name
    returning 1
  )
  select count(*) into v_equipment_rows from written;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_payload->'benchmarks', '[]'::jsonb)) as b(
      level text, tans_per_bed numeric, total_beds integer, share_of_chain_tans numeric
    )
  ), written as (
    insert into public.bed_usage_chain_benchmarks (
      ingestion_id, snapshot_id, period_id, level, tans_per_bed, total_beds, share_of_chain_tans
    )
    select p_ingestion_id, v_snapshot_id, v_period_id, i.level, i.tans_per_bed, i.total_beds, i.share_of_chain_tans
    from incoming i
    returning 1
  )
  select count(*) into v_benchmark_rows from written;

  -- SUCCEEDED IS SET INSIDE THIS TRANSACTION, so a rollback of any statement
  -- above leaves the attempt un-succeeded rather than claiming a partial load.
  update public.report_ingestions
     set status = 'succeeded',
         period_id = v_period_id,
         fact_count = v_salon_rows + v_equipment_rows,
         salon_count = v_salon_rows,
         finished_at = now()
   where id = p_ingestion_id;

  return jsonb_build_object(
    'period_id', v_period_id,
    'snapshot_id', v_snapshot_id,
    'salon_count', v_salon_rows,
    'fact_count', v_salon_rows + v_equipment_rows,
    'benchmark_count', v_benchmark_rows,
    'superseded_facts', v_superseded_n,
    'superseded_snapshot_id', v_superseded,
    'unresolved_salons', to_jsonb(v_unresolved)
  );
end;
$$;

comment on function public.complete_bed_usage_ingestion(uuid, jsonb) is
  'Writes one Bed Usage delivery atomically, superseding any earlier live snapshot for the SAME period and company. Salons are matched on store name and never created here; unresolved names are returned.';

revoke all on function public.complete_bed_usage_ingestion(uuid, jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. SPA WELLNESS.
--
-- One call per WINDOW, because each window is its own period. `p_payload`
-- carries `period`, `window_code`, `source_sheet`, `company`,
-- `equipment_types`, `salons`, `equipment_use`, `benchmarks`, `diagnostics`
-- and `warnings`.
--
-- EQUIPMENT TYPES ARE UPSERTED FROM THE DELIVERY, which is how a type first
-- seen this month is stored rather than dropped. `first_seen` is set once;
-- `last_seen` moves with every report, so a type that stops appearing is
-- visible as a stale `last_seen` rather than vanishing.
-- ---------------------------------------------------------------------------

create or replace function public.complete_spa_wellness_ingestion(
  p_ingestion_id uuid,
  p_payload      jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_period_id      uuid;
  v_snapshot_id    uuid;
  v_superseded     uuid;
  v_company        text := p_payload->>'company';
  v_salon_rows     integer := 0;
  v_use_rows       integer := 0;
  v_type_rows      integer := 0;
  v_benchmark_rows integer := 0;
  v_superseded_n   integer := 0;
  v_unresolved     text[] := '{}';
begin
  if v_company is null or btrim(v_company) = '' then
    raise exception 'The payload names no company' using errcode = 'invalid_parameter_value';
  end if;

  v_period_id := public.upsert_bed_spa_period(p_payload->'period');

  -- THE OPEN CATALOGUE. A new equipment type is a row, not a deployment.
  with incoming as (
    select * from jsonb_to_recordset(p_payload->'equipment_types') as t(
      code text, label text, short_label text, is_comparable boolean, display_order integer
    )
  ), written as (
    insert into public.spa_equipment_types (
      code, label, short_label, is_comparable, display_order,
      first_seen_ingestion_id, last_seen_ingestion_id
    )
    select i.code, i.label, i.short_label, coalesce(i.is_comparable, true),
           coalesce(i.display_order, 0), p_ingestion_id, p_ingestion_id
    from incoming i
    on conflict (code) do update
      set label = excluded.label,
          short_label = excluded.short_label,
          is_comparable = excluded.is_comparable,
          display_order = excluded.display_order,
          last_seen_ingestion_id = p_ingestion_id
    returning 1
  )
  select count(*) into v_type_rows from written;

  select id into v_superseded
  from public.spa_wellness_snapshots
  where period_id = v_period_id
    and company = v_company
    and superseded_by_ingestion_id is null
  for update;

  if v_superseded is not null then
    update public.spa_wellness_salon_facts
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;
    v_superseded_n := v_superseded_n + coalesce(
      (select count(*) from public.spa_wellness_salon_facts
        where snapshot_id = v_superseded and superseded_by_ingestion_id = p_ingestion_id), 0);

    update public.spa_wellness_equipment_facts
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;
    v_superseded_n := v_superseded_n + coalesce(
      (select count(*) from public.spa_wellness_equipment_facts
        where snapshot_id = v_superseded and superseded_by_ingestion_id = p_ingestion_id), 0);

    update public.spa_equipment_benchmarks
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;

    update public.spa_wellness_snapshots
       set superseded_by_ingestion_id = p_ingestion_id
     where id = v_superseded;
  end if;

  select coalesce(array_agg(distinct s.store_name), '{}') into v_unresolved
  from jsonb_to_recordset(p_payload->'salons') as s(store_name text)
  where not exists (select 1 from public.salons x where x.store_name = s.store_name);

  insert into public.spa_wellness_snapshots (
    ingestion_id, period_id, window_code, source_sheet, company,
    source_period_label,
    source_salon_count, salon_count, equipment_type_count, equipment_use_count,
    not_installed_cell_count, warnings
  )
  values (
    p_ingestion_id, v_period_id,
    p_payload->>'window_code', p_payload->>'source_sheet', v_company,
    p_payload->'period'->>'label_raw',
    nullif(p_payload->'diagnostics'->>'source_salon_count', '')::integer,
    coalesce(jsonb_array_length(p_payload->'salons'), 0),
    coalesce(jsonb_array_length(p_payload->'equipment_types'), 0),
    coalesce(jsonb_array_length(p_payload->'equipment_use'), 0),
    nullif(p_payload->'diagnostics'->>'not_installed_cells', '')::integer,
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'warnings', '[]'::jsonb))),
      '{}'
    )
  )
  returning id into v_snapshot_id;

  with incoming as (
    select * from jsonb_to_recordset(p_payload->'salons') as s(
      store_name text, total_sessions numeric, equipment_pieces integer,
      equipment_types_used integer, district_label text, region_label text,
      first_use_date date, newest_first_use_date date, is_comp_salon boolean,
      source_row integer
    )
  ), written as (
    insert into public.spa_wellness_salon_facts (
      ingestion_id, snapshot_id, period_id, salon_id,
      total_sessions, equipment_pieces, equipment_types_used,
      district_label, region_label, first_use_date, newest_first_use_date,
      is_comp_salon, source_row
    )
    select
      p_ingestion_id, v_snapshot_id, v_period_id, sa.id,
      i.total_sessions, i.equipment_pieces, coalesce(i.equipment_types_used, 0),
      i.district_label, i.region_label, i.first_use_date, i.newest_first_use_date,
      i.is_comp_salon, i.source_row
    from incoming i
    join public.salons sa on sa.store_name = i.store_name
    returning 1
  )
  select count(*) into v_salon_rows from written;

  -- The same rule as Bed Usage, and for the same reason: an empty ingestion
  -- would supersede a good window with nothing. See the note there.
  if v_salon_rows = 0 then
    raise exception
      'No salon in this SPA Wellness window matched a known salon (% named). This report carries no salon number, so salons must already exist: ingest the Spa Engagement delivery first, whose Roster is the only source of one.',
      coalesce(jsonb_array_length(p_payload->'salons'), 0)
      using errcode = 'no_data_found';
  end if;

  /*
   * EQUIPMENT USE. `where i.sessions > 0` is belt and braces on top of the
   * table's own check constraint: a zero in this source means the equipment is
   * not installed, and a caller that ever sent one would be refused rather
   * than storing an absence as a failure.
   */
  with incoming as (
    select * from jsonb_to_recordset(p_payload->'equipment_use') as u(
      store_name text, equipment_code text, sessions numeric,
      first_use_date date, last_use_date date, source_row integer
    )
  ), written as (
    insert into public.spa_wellness_equipment_facts (
      ingestion_id, snapshot_id, period_id, salon_id, equipment_type_id,
      sessions, first_use_date, last_use_date, source_row
    )
    select
      p_ingestion_id, v_snapshot_id, v_period_id, sa.id, t.id,
      i.sessions, i.first_use_date, i.last_use_date, i.source_row
    from incoming i
    join public.salons sa on sa.store_name = i.store_name
    join public.spa_equipment_types t on t.code = i.equipment_code
    where i.sessions > 0
    returning 1
  )
  select count(*) into v_use_rows from written;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_payload->'benchmarks', '[]'::jsonb)) as b(
      equipment_code text, chain_salon_count integer, chain_average_sessions numeric,
      peer_salon_count integer, peer_average_sessions numeric
    )
  ), written as (
    insert into public.spa_equipment_benchmarks (
      ingestion_id, snapshot_id, period_id, equipment_type_id,
      chain_salon_count, chain_average_sessions, peer_salon_count, peer_average_sessions
    )
    select
      p_ingestion_id, v_snapshot_id, v_period_id, t.id,
      coalesce(i.chain_salon_count, 0),
      case when coalesce(i.chain_salon_count, 0) > 0 then i.chain_average_sessions end,
      coalesce(i.peer_salon_count, 0),
      -- A peer count of zero carries a NULL average: nobody to compare with is
      -- not a comparison of nothing. Enforced by a check constraint too.
      case when coalesce(i.peer_salon_count, 0) > 0 then i.peer_average_sessions end
    from incoming i
    join public.spa_equipment_types t on t.code = i.equipment_code
    returning 1
  )
  select count(*) into v_benchmark_rows from written;

  update public.report_ingestions
     set status = 'succeeded',
         period_id = v_period_id,
         fact_count = v_salon_rows + v_use_rows,
         salon_count = v_salon_rows,
         finished_at = now()
   where id = p_ingestion_id;

  return jsonb_build_object(
    'period_id', v_period_id,
    'snapshot_id', v_snapshot_id,
    'salon_count', v_salon_rows,
    'fact_count', v_salon_rows + v_use_rows,
    'equipment_type_count', v_type_rows,
    'benchmark_count', v_benchmark_rows,
    'superseded_facts', v_superseded_n,
    'superseded_snapshot_id', v_superseded,
    'unresolved_salons', to_jsonb(v_unresolved)
  );
end;
$$;

comment on function public.complete_spa_wellness_ingestion(uuid, jsonb) is
  'Writes one WINDOW of a SPA Wellness delivery atomically. Equipment types are upserted from the delivery''s own headers, so a new spa product needs no deployment. Rows with zero sessions are refused: a zero means the equipment is not installed.';

revoke all on function public.complete_spa_wellness_ingestion(uuid, jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. SPA ENGAGEMENT.
--
-- The one delivery that MAY CREATE A SALON, because it is the only one carrying
-- a roster with salon numbers. `p_payload` carries `period`, `company`,
-- `rank_population`, `rank_weights`, `roster`, `salons`, `managers`,
-- `inventory`, `daily`, `diagnostics` and `warnings`.
-- ---------------------------------------------------------------------------

create or replace function public.complete_spa_engagement_ingestion(
  p_ingestion_id uuid,
  p_payload      jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_period_id     uuid;
  v_snapshot_id   uuid;
  v_superseded    uuid;
  v_company       text := p_payload->>'company';
  v_salon_rows    integer := 0;
  v_manager_rows  integer := 0;
  v_inventory     integer := 0;
  v_daily_rows    integer := 0;
  v_superseded_n  integer := 0;
begin
  if v_company is null or btrim(v_company) = '' then
    raise exception 'The payload names no company' using errcode = 'invalid_parameter_value';
  end if;

  v_period_id := public.upsert_bed_spa_period(p_payload->'period');

  /*
   * THE ROSTER IS THE ONLY PLACE A SALON NUMBER APPEARS in any of the three new
   * reports, so this is the only path that may introduce a salon. The number is
   * TEXT and its zero-padding is preserved: `0468` read as a number is `468`,
   * and the next report that reads it correctly would create a second salon for
   * the same store and split its history.
   */
  insert into public.salons (
    salon_number, store_name, opened_at, first_seen_ingestion_id, last_seen_ingestion_id
  )
  select r.salon_number, r.store_name, r.opened_at, p_ingestion_id, p_ingestion_id
  from jsonb_to_recordset(coalesce(p_payload->'roster', '[]'::jsonb)) as r(
    salon_number text, store_name text, opened_at date
  )
  where btrim(coalesce(r.salon_number, '')) <> '' and btrim(coalesce(r.store_name, '')) <> ''
  on conflict (salon_number) do update
    set store_name = excluded.store_name,
        opened_at  = coalesce(excluded.opened_at, public.salons.opened_at),
        last_seen_ingestion_id = p_ingestion_id;

  select id into v_superseded
  from public.spa_engagement_snapshots
  where period_id = v_period_id
    and company = v_company
    and superseded_by_ingestion_id is null
  for update;

  if v_superseded is not null then
    update public.spa_engagement_salon_facts
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;
    v_superseded_n := v_superseded_n + coalesce(
      (select count(*) from public.spa_engagement_salon_facts
        where snapshot_id = v_superseded and superseded_by_ingestion_id = p_ingestion_id), 0);

    update public.spa_engagement_manager_facts
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;

    update public.spa_bed_inventory
       set superseded_by_ingestion_id = p_ingestion_id
     where snapshot_id = v_superseded and superseded_by_ingestion_id is null;

    update public.spa_engagement_snapshots
       set superseded_by_ingestion_id = p_ingestion_id
     where id = v_superseded;
  end if;

  insert into public.spa_engagement_snapshots (
    ingestion_id, period_id, company, source_period_label,
    rank_population, rank_weights,
    source_salon_count, salon_count, unrostered_salons,
    daily_range_start, daily_range_end, warnings
  )
  values (
    p_ingestion_id, v_period_id, v_company,
    p_payload->'period'->>'label_raw',
    (p_payload->>'rank_population')::integer,
    coalesce(p_payload->'rank_weights', '{}'::jsonb),
    nullif(p_payload->'diagnostics'->>'source_salon_count', '')::integer,
    coalesce(jsonb_array_length(p_payload->'salons'), 0),
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(
        coalesce(p_payload->'diagnostics'->'unrostered_salons', '[]'::jsonb))),
      '{}'
    ),
    nullif(p_payload->'diagnostics'->>'daily_range_start', '')::date,
    nullif(p_payload->'diagnostics'->>'daily_range_end', '')::date,
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'warnings', '[]'::jsonb))),
      '{}'
    )
  )
  returning id into v_snapshot_id;

  with incoming as (
    select * from jsonb_to_recordset(p_payload->'salons') as s(
      salon_number text, store_name text, spa_sessions numeric,
      total_unique_tanners numeric, unique_spa_tanners numeric, spa_beds integer,
      ownership text, district_label text, region_label text,
      reported_spa_sessions_per_bed numeric,
      reported_spa_sessions_per_unique_per_bed numeric,
      reported_unique_spa_tanner_pct numeric,
      reported_ranks jsonb, reported_overall_rank integer,
      computed_weighted_score numeric, source_row integer
    )
  ), written as (
    insert into public.spa_engagement_salon_facts (
      ingestion_id, snapshot_id, period_id, salon_id,
      spa_sessions, total_unique_tanners, unique_spa_tanners, spa_beds,
      ownership, district_label, region_label,
      reported_spa_sessions_per_bed, reported_spa_sessions_per_unique_per_bed,
      reported_unique_spa_tanner_pct, reported_ranks, reported_overall_rank,
      computed_weighted_score, source_row
    )
    select
      p_ingestion_id, v_snapshot_id, v_period_id, sa.id,
      i.spa_sessions, i.total_unique_tanners, i.unique_spa_tanners, i.spa_beds,
      i.ownership, i.district_label, i.region_label,
      i.reported_spa_sessions_per_bed, i.reported_spa_sessions_per_unique_per_bed,
      i.reported_unique_spa_tanner_pct, coalesce(i.reported_ranks, '{}'::jsonb),
      i.reported_overall_rank, i.computed_weighted_score, i.source_row
    from incoming i
    -- Matched on the SALON NUMBER, which the roster upsert above has just
    -- guaranteed exists for every rostered salon.
    join public.salons sa on sa.salon_number = i.salon_number
    returning 1
  )
  select count(*) into v_salon_rows from written;

  -- Far less likely here, because the roster upsert above creates the salons
  -- this join needs — but an empty write must still not supersede a good
  -- period, so the rule is the same.
  if v_salon_rows = 0 then
    raise exception
      'No salon in this Spa Engagement delivery could be written (% named). The roster upsert should have created them, so this is a data problem worth looking at rather than an ordering one.',
      coalesce(jsonb_array_length(p_payload->'salons'), 0)
      using errcode = 'no_data_found';
  end if;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_payload->'managers', '[]'::jsonb)) as m(
      district_label text, region_label text, spa_sessions numeric,
      total_unique_tanners numeric, unique_spa_tanners numeric, spa_beds integer,
      reported_overall_rank integer
    )
  ), written as (
    insert into public.spa_engagement_manager_facts (
      ingestion_id, snapshot_id, period_id, district_label, region_label,
      spa_sessions, total_unique_tanners, unique_spa_tanners, spa_beds,
      reported_overall_rank
    )
    select
      p_ingestion_id, v_snapshot_id, v_period_id, i.district_label, i.region_label,
      i.spa_sessions, i.total_unique_tanners, i.unique_spa_tanners, i.spa_beds,
      i.reported_overall_rank
    from incoming i
    returning 1
  )
  select count(*) into v_manager_rows from written;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_payload->'inventory', '[]'::jsonb)) as v(
      store_name text, type_description text, units integer, category text
    )
  ), written as (
    insert into public.spa_bed_inventory (
      ingestion_id, snapshot_id, period_id, salon_id, type_description, units, category
    )
    select p_ingestion_id, v_snapshot_id, v_period_id, sa.id, i.type_description, i.units, i.category
    from incoming i
    join public.salons sa on sa.store_name = i.store_name
    where i.units > 0
    returning 1
  )
  select count(*) into v_inventory from written;

  /*
   * THE DAILY SERIES. Consecutive deliveries overlap by 27 of 28 days and
   * agree about them, so a re-reported day SUPERSEDES the earlier row rather
   * than duplicating it — one live row per salon per day, whichever delivery
   * brought it.
   */
  update public.spa_engagement_daily_facts d
     set superseded_by_ingestion_id = p_ingestion_id
   from jsonb_to_recordset(coalesce(p_payload->'daily', '[]'::jsonb)) as i(
     store_name text, activity_date date
   )
   join public.salons sa on sa.store_name = i.store_name
  where d.salon_id = sa.id
    and d.activity_date = i.activity_date
    and d.superseded_by_ingestion_id is null;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_payload->'daily', '[]'::jsonb)) as d(
      store_name text, activity_date date, unique_tanners numeric,
      unique_spa_tanners numeric, total_visits numeric, spa_visits numeric
    )
  ), written as (
    insert into public.spa_engagement_daily_facts (
      ingestion_id, snapshot_id, salon_id, activity_date,
      unique_tanners, unique_spa_tanners, total_visits, spa_visits
    )
    select
      p_ingestion_id, v_snapshot_id, sa.id, i.activity_date,
      i.unique_tanners, i.unique_spa_tanners, i.total_visits, i.spa_visits
    from incoming i
    join public.salons sa on sa.store_name = i.store_name
    returning 1
  )
  select count(*) into v_daily_rows from written;

  update public.report_ingestions
     set status = 'succeeded',
         period_id = v_period_id,
         fact_count = v_salon_rows + v_manager_rows + v_daily_rows,
         salon_count = v_salon_rows,
         finished_at = now()
   where id = p_ingestion_id;

  return jsonb_build_object(
    'period_id', v_period_id,
    'snapshot_id', v_snapshot_id,
    'salon_count', v_salon_rows,
    'fact_count', v_salon_rows + v_manager_rows + v_daily_rows,
    'manager_count', v_manager_rows,
    'inventory_count', v_inventory,
    'daily_count', v_daily_rows,
    'superseded_facts', v_superseded_n,
    'superseded_snapshot_id', v_superseded
  );
end;
$$;

comment on function public.complete_spa_engagement_ingestion(uuid, jsonb) is
  'Writes one Spa Engagement delivery atomically. The ONLY path that may introduce a salon, because its Roster is the only place a salon number appears in the three new reports; the number is stored as TEXT so zero-padding survives.';

revoke all on function public.complete_spa_engagement_ingestion(uuid, jsonb) from anon, authenticated;
