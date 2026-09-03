-- ---------------------------------------------------------------------------
-- RESTORE THE OPENED-ATTEMPT ROW TO WHAT THE SCHEMA ACTUALLY ACCEPTS.
--
-- 20260902001000_reporting_intake_lineage rewrote `begin_report_ingestion` to
-- read three new lineage keys, and its own header says the function is
-- "unchanged except for the three new optional keys". It was not. Three things
-- changed in the INSERT that opens an attempt, and each of them is fatal:
--
--   1. THE STATUS. It writes 'running', which is not a value of
--      public.report_ingestion_status ('received', 'parsing', 'succeeded',
--      'failed', 'rejected_duplicate'). Every call since raises
--        invalid input value for enum public.report_ingestion_status: "running"
--      before a single row is written, and the caller sees only the generic
--      "the ingestion could not be completed" that intake returns in place of
--      a database error string.
--
--      'parsing' is the state meant here. The enum declares it as the step
--      between 'received' (bytes stored, not yet parsed) and 'succeeded';
--      20260831001700 opened every attempt with it, and the three August
--      ingestions passed through it. It also stays correct downstream:
--      `fail_report_ingestion` records a failure against any attempt not yet
--      'succeeded', and the read view counts only 'succeeded'. Nothing in the
--      schema, the functions, the TypeScript contracts, the read views or the
--      tests refers to a 'running' state, so it carries no distinct lifecycle
--      meaning and the enum is left alone.
--
--      OBSERVED, NOT CHANGED HERE: 20260831001700's completion step refused an
--      attempt whose status was not 'parsing'. 20260831002000 rewrote
--      `complete_comp_sales_ingestion` for sheet-scoped supersession without
--      carrying that guard over, so the effective completion step no longer
--      checks the state it advances from. Restoring it is a separate decision
--      from restoring this insert, and is deliberately not bundled in.
--
--   2. THE SOURCE. The insert dropped `source_id`, which is NOT NULL on
--      report_ingestions. A second failure hiding behind the first.
--
--   3. THE SHEET NAMES. `coalesce(p_sheet_names, '{}')` became a bare
--      `p_sheet_names`, so a caller that passes null hits the NOT NULL on a
--      column whose default it can no longer reach.
--
-- WHAT THIS MIGRATION DOES. Replaces that one function. The three new lineage
-- keys, both idempotency layers and the `already_ingested` short circuit are
-- kept exactly as 20260902001000 wrote them; only the attempt INSERT is
-- restored to the form 20260831001700 established.
--
-- NO DATA IS TOUCHED. No table, index, enum, view or policy changes, and no
-- existing row is read or rewritten. The three succeeded ingestions, the 1,277
-- live facts and both reporting periods are exactly as they were.
-- ---------------------------------------------------------------------------

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
    size_bytes, file_sha256, external_message_id, external_archive_url,
    sender_email, received_at, inbound_email_id
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
    p_file->>'external_archive_url',
    p_file->>'sender_email',
    -- The caller's value when it supplied one, otherwise the column default.
    coalesce((p_file->>'received_at')::timestamptz, now()),
    p_file->>'inbound_email_id'
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

  -- IDEMPOTENCY LAYER 2 — at most one attempt per (file, parser, version) may
  -- have succeeded; the partial unique index is the authority. Found here, the
  -- answer is returned before any work is done.
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

  -- A retry inserts a NEW attempt; previous failures keep their reasons. The
  -- attempt opens as 'parsing' — the state `complete_comp_sales_ingestion`
  -- advances from and `fail_report_ingestion` records against.
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
    'status', 'opened',
    'file_id', v_file_id,
    'file_created', v_file_created,
    'ingestion_id', v_ingestion_id
  );
end;
$$;

comment on function public.begin_report_ingestion(text, jsonb, text, integer, text, text[]) is
  'Registers the source file and opens one ingestion attempt in the ''parsing'' '
  'state, or reports already_ingested for (file, parser, version). Optional '
  'p_file keys sender_email, received_at and inbound_email_id are recorded only '
  'when the file row is created, so a re-delivery never rewrites the first '
  'delivery''s lineage.';
