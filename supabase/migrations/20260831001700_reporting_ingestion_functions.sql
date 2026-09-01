-- Ask Sunny — the transactional heart of report ingestion.
--
-- WHY THIS IS SQL AND NOT TYPESCRIPT.
--
-- The normalized write must be atomic: a failure must never leave half the
-- facts inserted, an ingestion marked succeeded, or a period's live facts
-- partially superseded. supabase-js has no client-side transaction — every
-- `.from(...).insert(...)` is its own commit — so an atomic multi-table write
-- driven from the application is not expressible there. A single function is,
-- because a function body IS one transaction.
--
-- The TypeScript repository therefore does no multi-table writing of its own:
-- it calls these three functions and interprets what they return.
--
-- WHY THREE FUNCTIONS AND NOT ONE.
--
-- Retry semantics require that a FAILED attempt survives. If the whole
-- ingestion were one transaction, a failure would roll the attempt row back
-- with everything else and the failure history — the rows an operator most
-- needs — would vanish. So:
--
--   1. begin_report_ingestion      commits the file and the attempt row.
--   2. complete_comp_sales_ingestion  does the whole normalized write, or none
--                                     of it, and marks the attempt succeeded
--                                     inside that same transaction.
--   3. fail_report_ingestion      records why an attempt failed.
--
-- Step 2 is the atomic one. Steps 1 and 3 exist precisely so that a rollback of
-- step 2 leaves an accurate, durable record of the attempt.

-- ---------------------------------------------------------------------------
-- 1. Register the file and open an attempt.
--
-- Returns `already_ingested` WITHOUT opening an attempt when these bytes have
-- already succeeded under this parser and version. That is idempotency layers 1
-- and 2 answered before any work is done: re-sending the same email, a Power
-- Automate retry or an administrator uploading a second copy all land here.

create or replace function public.begin_report_ingestion(
  p_source_code    text,
  p_file           jsonb,
  p_parser_key     text,
  p_parser_version integer,
  p_fingerprint    text,
  p_sheet_names    text[]
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_source_id    uuid;
  v_file_id      uuid;
  v_existing     uuid;
  v_ingestion_id uuid;
  v_file_created boolean := false;
begin
  select id into v_source_id
  from public.report_sources
  where code = p_source_code and active
  for update;

  if v_source_id is null then
    raise exception 'Unknown or inactive report source: %', p_source_code
      using errcode = 'no_data_found';
  end if;

  -- IDEMPOTENCY LAYER 1 — content identity. The unique index on file_sha256
  -- does the work; `on conflict do nothing` turns a collision into a lookup
  -- rather than an error.
  insert into public.report_files (
    source_id, storage_bucket, storage_path, original_filename, mime_type,
    size_bytes, file_sha256, external_message_id, external_archive_url
  )
  values (
    v_source_id,
    coalesce(p_file->>'storage_bucket', 'reporting-sources'),
    p_file->>'storage_path',
    p_file->>'original_filename',
    p_file->>'mime_type',
    (p_file->>'size_bytes')::bigint,
    p_file->>'file_sha256',
    p_file->>'external_message_id',
    p_file->>'external_archive_url'
  )
  on conflict (file_sha256) do nothing
  returning id into v_file_id;

  if v_file_id is null then
    select id into v_file_id
    from public.report_files
    where file_sha256 = p_file->>'file_sha256';
  else
    v_file_created := true;
  end if;

  -- At most one attempt per (file, parser, version) may have succeeded; the
  -- partial unique index guarantees it, and this reads it.
  select id into v_existing
  from public.report_ingestions
  where file_id = v_file_id
    and parser_key = p_parser_key
    and parser_version = p_parser_version
    and status = 'succeeded'
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'status', 'already_ingested',
      'file_id', v_file_id,
      'file_created', v_file_created,
      'ingestion_id', v_existing
    );
  end if;

  -- A retry inserts a NEW attempt; previous failures keep their reasons.
  insert into public.report_ingestions (
    file_id, source_id, parser_key, parser_version, status,
    fingerprint, source_sheet_names
  )
  values (
    v_file_id, v_source_id, p_parser_key, p_parser_version, 'parsing',
    p_fingerprint, coalesce(p_sheet_names, '{}')
  )
  returning id into v_ingestion_id;

  return jsonb_build_object(
    'status', 'started',
    'file_id', v_file_id,
    'file_created', v_file_created,
    'ingestion_id', v_ingestion_id
  );
end;
$$;

comment on function public.begin_report_ingestion(text, jsonb, text, integer, text, text[]) is
  'Registers a raw file and opens an ingestion attempt. Returns already_ingested when these bytes have already succeeded under this parser and version, without opening an attempt.';

-- ---------------------------------------------------------------------------
-- 2. The atomic normalized write.
--
-- Everything below happens in one transaction: period, salons, attributes,
-- supersession of what was there before, the new facts, and the status change
-- to `succeeded`. Any exception rolls back all of it, and the attempt stays
-- open for `fail_report_ingestion` to annotate.

create or replace function public.complete_comp_sales_ingestion(
  p_ingestion_id uuid,
  p_payload      jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_period_id    uuid;
  v_salon_ids    uuid[];
  v_fact_count   integer;
  v_salon_count  integer;
  v_superseded_facts integer := 0;
  v_superseded_attrs integer := 0;
  v_unknown      text;
begin
  if not exists (
    select 1 from public.report_ingestions
    where id = p_ingestion_id and status = 'parsing'
  ) then
    raise exception 'Ingestion % is not open for completion', p_ingestion_id
      using errcode = 'invalid_parameter_value';
  end if;

  -- A parser may not invent a metric. Checked as a set, so the error names
  -- every unknown code at once instead of failing one at a time.
  select string_agg(distinct f.metric_code, ', ') into v_unknown
  from jsonb_to_recordset(p_payload->'facts') as f(metric_code text)
  where not exists (
    select 1 from public.report_metrics m where m.code = f.metric_code
  );

  if v_unknown is not null then
    raise exception 'Unknown metric codes: %', v_unknown
      using errcode = 'foreign_key_violation';
  end if;

  -- The reporting calendar. Uniqueness on (grain, period_end) makes a
  -- re-ingestion of the same period reuse the row rather than duplicate it.
  insert into public.report_periods (grain, period_end, period_start, fiscal_year, label_raw)
  values (
    (p_payload->'period'->>'grain')::public.report_period_grain,
    (p_payload->'period'->>'period_end')::date,
    (p_payload->'period'->>'period_start')::date,
    (p_payload->'period'->>'fiscal_year')::integer,
    p_payload->'period'->>'label_raw'
  )
  on conflict (grain, period_end) do update
    set label_raw = excluded.label_raw
  returning id into v_period_id;

  -- Salons, keyed on the zero-padded TEXT salon number. `first_seen` is set
  -- once and never overwritten; `last_seen` moves with every report.
  insert into public.salons (
    salon_number, store_name, owner_ref, owner_uid, opened_at,
    first_seen_ingestion_id, last_seen_ingestion_id
  )
  select
    s.salon_number, s.store_name, s.owner_ref, s.owner_uid, s.opened_at,
    p_ingestion_id, p_ingestion_id
  from jsonb_to_recordset(p_payload->'salons') as s(
    salon_number text, store_name text, owner_ref text, owner_uid text, opened_at date
  )
  on conflict (salon_number) do update
    set store_name = excluded.store_name,
        owner_ref  = coalesce(excluded.owner_ref, public.salons.owner_ref),
        owner_uid  = coalesce(excluded.owner_uid, public.salons.owner_uid),
        opened_at  = coalesce(excluded.opened_at, public.salons.opened_at),
        last_seen_ingestion_id = p_ingestion_id;

  select array_agg(id) into v_salon_ids
  from public.salons
  where salon_number in (
    select s.salon_number
    from jsonb_to_recordset(p_payload->'salons') as s(salon_number text)
  );

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

  update public.comp_sales_facts
     set superseded_by_ingestion_id = p_ingestion_id
   where period_id = v_period_id
     and salon_id = any (v_salon_ids)
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
  'The atomic normalized write: period, salons, period attributes, supersession of this report''s salons, facts, and the succeeded status — all in one transaction. Supersession is scoped to the salons this report names, because a recipient copy may be a filtered slice.';

-- ---------------------------------------------------------------------------
-- 3. Record a failure.
--
-- Called after the atomic write has rolled back, so the attempt row survives
-- with a user-safe reason. The reason never carries report content.

create or replace function public.fail_report_ingestion(
  p_ingestion_id uuid,
  p_reason       text
) returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  update public.report_ingestions
     set status = 'failed',
         failure_reason = coalesce(nullif(btrim(p_reason), ''), 'Ingestion failed.'),
         finished_at = now()
   where id = p_ingestion_id
     and status <> 'succeeded';

  return jsonb_build_object('status', 'failed', 'ingestion_id', p_ingestion_id);
end;
$$;

comment on function public.fail_report_ingestion(uuid, text) is
  'Marks an attempt failed with a user-safe reason. Never overwrites a succeeded attempt.';

-- ---------------------------------------------------------------------------
-- PRIVILEGES.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, which would
-- hand `anon` and `authenticated` the ability to write reporting data through
-- these functions — straight past the read-only posture the RLS migration set
-- up. Revoked first, then granted to `service_role` alone, which is the only
-- role a server-side route handler ever holds.

revoke all on function public.begin_report_ingestion(text, jsonb, text, integer, text, text[]) from public, anon, authenticated;
revoke all on function public.complete_comp_sales_ingestion(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_report_ingestion(uuid, text) from public, anon, authenticated;

grant execute on function public.begin_report_ingestion(text, jsonb, text, integer, text, text[]) to service_role;
grant execute on function public.complete_comp_sales_ingestion(uuid, jsonb) to service_role;
grant execute on function public.fail_report_ingestion(uuid, text) to service_role;
