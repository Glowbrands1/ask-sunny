-- ---------------------------------------------------------------------------
-- AUTOMATED INTAKE LINEAGE.
--
-- Three fields an automated sender knows and the schema had nowhere to keep.
-- Two were listed as blockers in docs/reporting-ingestion-contract.md §7, and
-- all three matter more once a scheduler or a mailbox rather than a person is
-- submitting the report: when a human uploads, somebody sees the response; when
-- a forwarded email uploads, the stored row is the only record.
--
--   sender_email   Who the message came from. A Comp Report arriving from an
--                  unexpected mailbox is the kind of thing that should be
--                  visible in the source & quality panel rather than discovered
--                  later.
--
--   received_at    Already a column, but defaulted to now() — which for an
--                  emailed report is the PROCESSING time, not the arrival time.
--                  The two diverge exactly when it matters: a delayed message,
--                  a replayed one, a backfill run weeks later. The column now
--                  accepts the real value from the caller and keeps its default
--                  for callers that do not know it.
--
--   inbound_email_id  The inbound provider's id for the received email, when
--                  the delivery arrived as mail. Kept SEPARATE from
--                  external_message_id, which holds the upstream Message-ID of
--                  the original mail: one names the message that was sent, the
--                  other the copy the provider received. Collapsing them would
--                  make correlating a stored file back to the provider's own
--                  record impossible.
--
-- ADDITIVE AND NON-DESTRUCTIVE. Two nullable columns, and one function replaced
-- to read three more optional keys from a jsonb payload it already receives. No
-- existing row is touched, no fact is rewritten, no index changes. The 1,277
-- live facts and both reporting periods are unaffected.
-- ---------------------------------------------------------------------------

alter table public.report_files
  add column if not exists sender_email text;

alter table public.report_files
  add column if not exists inbound_email_id text;

comment on column public.report_files.sender_email is
  'Sending address as reported by the intake caller. Lineage only; never used '
  'for authorization — the caller is authenticated by REPORTING_INGEST_SECRET '
  'or a verified inbound-email webhook signature.';

comment on column public.report_files.inbound_email_id is
  'The inbound email provider''s id for the received message, when the delivery '
  'arrived as mail. Lineage only. Separate from external_message_id, which holds '
  'the upstream Message-ID of the original mail.';

-- ---------------------------------------------------------------------------
-- Register the file and open an attempt.
--
-- Unchanged except for the three new optional keys. The idempotency behaviour is
-- identical: layer 1 is the unique index on file_sha256, layer 2 is the partial
-- unique index on (file_id, parser_key, parser_version) where status =
-- 'succeeded', and `already_ingested` is still returned WITHOUT opening an
-- attempt.
--
-- ALL THREE NEW KEYS ARE READ ONLY WHEN THE FILE ROW IS CREATED. A re-delivery of
-- the same bytes matches the existing row by digest and must not rewrite its
-- lineage: the first delivery's sender and arrival time are the true ones, and
-- a retry hours later carries a different `received_at` that would silently
-- overwrite them.
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

  -- At most one attempt per (file, parser, version) may have succeeded; the
  -- partial unique index is the authority. Found here, the answer is returned
  -- before any work is done.
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

  insert into public.report_ingestions (
    file_id, parser_key, parser_version, status, fingerprint, source_sheet_names
  )
  values (
    v_file_id, p_parser_key, p_parser_version, 'running', p_fingerprint, p_sheet_names
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
  'Registers the source file and opens one ingestion attempt, or reports '
  'already_ingested for (file, parser, version). Optional p_file keys '
  'sender_email, received_at and inbound_email_id are recorded only when the '
  'file row is created, so a re-delivery never rewrites the first delivery''s '
  'lineage.';
