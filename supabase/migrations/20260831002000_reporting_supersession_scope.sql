-- Ask Sunny — scope fact supersession to the SHEET a report read.
--
-- A CORRECTNESS FIX, found before it could do any damage.
--
-- `complete_comp_sales_ingestion` superseded every live fact for the period and
-- the salons a report named. That was right while one parser read one sheet: a
-- restated report replaces what the previous one said about those salons.
--
-- It becomes wrong the moment a SECOND sheet of the same workbook is ingested.
-- `CompReport(MTD)` carries the trailing-window measures and `CompReport(MTD)
-- vs 2024` carries the year comparisons; both describe the same fifteen salons
-- in the same month-to-date period. Ingesting the rolling sheet would therefore
-- have stamped all 562 year-comparison facts as superseded — silently, with no
-- error, leaving a dashboard that had lost every figure it used to show.
--
-- The fix is to say what an ingestion actually restates: the facts that came
-- from the sheets IT read. Two sheets of one workbook now coexist, and
-- re-ingesting either one still replaces its own figures exactly as before.
--
-- Note the failure direction. The sheet list is derived from the payload's own
-- facts, so a payload naming no sheet supersedes NOTHING rather than
-- everything — `= any('{}')` is false for every row. An empty list cannot cause
-- data loss.
--
-- ATTRIBUTE SUPERSESSION IS UNCHANGED, and must be. `salon_period_attributes`
-- has a unique index allowing one live row per salon and period, so a second
-- ingestion for the same salons has to supersede the previous attributes. That
-- is also harmless: both sheets carry the same descriptor band, so the newer
-- ingestion restates the same district, region and ownership for that salon.
--
-- Everything else about the function is untouched: still one transaction, still
-- reading `metric_basis_year_required` from the catalogue rather than the
-- payload, still not SECURITY DEFINER, still executable only by service_role.

create or replace function public.complete_comp_sales_ingestion(
  p_ingestion_id uuid,
  p_payload      jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_period_id   uuid;
  v_salon_ids   uuid[];
  v_sheet_names text[];
  v_fact_count  integer;
  v_salon_count integer;
  v_superseded_facts integer;
  v_superseded_attrs integer;
begin
  -- PERIOD. Matched on (grain, period_end), the natural key.
  insert into public.report_periods (grain, period_end, period_start, fiscal_year, label_raw)
  select
    (p_payload->'period'->>'grain')::public.report_period_grain,
    (p_payload->'period'->>'period_end')::date,
    (p_payload->'period'->>'period_start')::date,
    (p_payload->'period'->>'fiscal_year')::integer,
    p_payload->'period'->>'label_raw'
  on conflict (grain, period_end) do nothing;

  select id into v_period_id
  from public.report_periods
  where grain = (p_payload->'period'->>'grain')::public.report_period_grain
    and period_end = (p_payload->'period'->>'period_end')::date;

  if v_period_id is null then
    raise exception 'report period could not be resolved for this ingestion';
  end if;

  -- SALONS. The business key is the zero-padded text salon number.
  insert into public.salons (salon_number, store_name, owner_ref, owner_uid, opened_at,
                             first_seen_ingestion_id, last_seen_ingestion_id)
  select
    s.salon_number, s.store_name, s.owner_ref, s.owner_uid, s.opened_at,
    p_ingestion_id, p_ingestion_id
  from jsonb_to_recordset(p_payload->'salons') as s(
    salon_number text, store_name text, owner_ref text, owner_uid text, opened_at date
  )
  on conflict (salon_number) do update
    set store_name = excluded.store_name,
        owner_ref = coalesce(excluded.owner_ref, public.salons.owner_ref),
        owner_uid = coalesce(excluded.owner_uid, public.salons.owner_uid),
        opened_at = coalesce(excluded.opened_at, public.salons.opened_at),
        last_seen_ingestion_id = p_ingestion_id,
        updated_at = now();

  select array_agg(id) into v_salon_ids
  from public.salons
  where salon_number in (
    select s.salon_number
    from jsonb_to_recordset(p_payload->'salons') as s(salon_number text)
  );

  -- The sheets this report read, taken from the lineage on its own facts.
  select coalesce(array_agg(distinct f.source_sheet), '{}')
    into v_sheet_names
  from jsonb_to_recordset(p_payload->'facts') as f(source_sheet text)
  where f.source_sheet is not null;

  -- SUPERSESSION IS SCOPED TO THIS REPORT'S SALONS.
  --
  -- Not to the whole period. A recipient's workbook may be filtered to a subset
  -- of salons, so superseding everything for the period would silently retire
  -- another slice's facts because this file happened not to mention them.
  update public.salon_period_attributes
     set superseded_by_ingestion_id = p_ingestion_id
   where period_id = v_period_id
     and salon_id = any (v_salon_ids)
     and superseded_by_ingestion_id is null;
  v_superseded_attrs := coalesce((select count(*) from public.salon_period_attributes
    where superseded_by_ingestion_id = p_ingestion_id), 0);

  -- ...AND, FOR FACTS, TO THE SHEETS THIS REPORT READ.
  --
  -- See the header note. Without this clause, ingesting one sheet of a workbook
  -- retires every fact another sheet of the same workbook contributed for the
  -- same salons and period.
  update public.comp_sales_facts
     set superseded_by_ingestion_id = p_ingestion_id
   where period_id = v_period_id
     and salon_id = any (v_salon_ids)
     and source_sheet = any (v_sheet_names)
     and superseded_by_ingestion_id is null;
  v_superseded_facts := coalesce((select count(*) from public.comp_sales_facts
    where superseded_by_ingestion_id = p_ingestion_id), 0);

  insert into public.salon_period_attributes (
    salon_id, period_id, ingestion_id, district_label, region_label, company,
    ownership_group, dma, pricing_plan, is_comp_salon, spa_pieces,
    spa_install_date, quintile_group, revenue_rank, salon_age_years,
    avg_client_age, market_consolidation, nearest_competitor_distance
  )
  select
    sal.id, v_period_id, p_ingestion_id, a.district_label, a.region_label,
    a.company, a.ownership_group, a.dma, a.pricing_plan, a.is_comp_salon,
    a.spa_pieces, a.spa_install_date, a.quintile_group, a.revenue_rank,
    a.salon_age_years, a.avg_client_age, a.market_consolidation,
    a.nearest_competitor_distance
  from jsonb_to_recordset(p_payload->'attributes') as a(
    salon_number text, district_label text, region_label text, company text,
    ownership_group text, dma text, pricing_plan text, is_comp_salon boolean,
    spa_pieces integer, spa_install_date date, quintile_group text,
    revenue_rank integer, salon_age_years numeric, avg_client_age numeric,
    market_consolidation text, nearest_competitor_distance numeric
  )
  join public.salons sal on sal.salon_number = a.salon_number;

  -- FACTS. `metric_basis_year_required` is read from the CATALOGUE, never from
  -- the payload: the composite foreign key exists so a fact whose flag
  -- disagrees with the catalogue has no parent, and letting a caller supply the
  -- flag would hand it the means to satisfy the key with a wrong value.
  insert into public.comp_sales_facts (
    ingestion_id, salon_id, period_id, metric_id, metric_basis_year_required,
    basis_year, value, source_sheet, source_column
  )
  select
    p_ingestion_id, sal.id, v_period_id, m.id, m.basis_year_required,
    f.basis_year, f.value, f.source_sheet, f.source_column
  from jsonb_to_recordset(p_payload->'facts') as f(
    salon_number text, metric_code text, basis_year integer, value numeric,
    source_sheet text, source_column text
  )
  join public.salons sal on sal.salon_number = f.salon_number
  join public.report_metrics m on m.code = f.metric_code;

  select count(*) into v_fact_count
  from public.comp_sales_facts where ingestion_id = p_ingestion_id;

  select count(distinct salon_id) into v_salon_count
  from public.comp_sales_facts where ingestion_id = p_ingestion_id;

  update public.report_ingestions
     set status = 'succeeded',
         period_id = v_period_id,
         fact_count = v_fact_count,
         salon_count = v_salon_count,
         warnings = coalesce(
           (select array_agg(w) from jsonb_array_elements_text(p_payload->'warnings') w),
           '{}'
         ),
         source_sheet_names = coalesce(
           (select array_agg(n) from jsonb_array_elements_text(p_payload->'sheet_names') n),
           source_sheet_names
         ),
         finished_at = now()
   where id = p_ingestion_id;

  return jsonb_build_object(
    'status', 'succeeded',
    'ingestion_id', p_ingestion_id,
    'period_id', v_period_id,
    'fact_count', v_fact_count,
    'salon_count', v_salon_count,
    'superseded_facts', v_superseded_facts,
    'superseded_attributes', v_superseded_attrs
  );
end;
$$;

comment on function public.complete_comp_sales_ingestion(uuid, jsonb) is
  'The atomic normalized write: period, salons, period attributes, supersession, facts, and the succeeded status - all in one transaction. Supersession is scoped to the salons this report names (a recipient copy may be a filtered slice) AND, for facts, to the source sheets it read, so ingesting one sheet of a workbook does not retire another sheet''s facts for the same salons and period.';

-- Privileges are re-asserted because `create or replace function` resets them
-- to the default, and the default on Supabase includes PUBLIC EXECUTE.
revoke all on function public.complete_comp_sales_ingestion(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_comp_sales_ingestion(uuid, jsonb)
  to service_role;
