-- Ask Sunny — private Storage bucket for raw report artifacts.
--
-- Separate from `knowledge-documents`: different domain, different retention
-- and different audience. Raw comp reports carry salon-level financials and
-- manager names, so the bucket is PRIVATE — `public` is false, and every
-- download is a short-lived signed URL minted server-side. A public bucket here
-- would put company financials behind a guessable URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reporting-sources',
  'reporting-sources',
  false,
  52428800,  -- 50 MB, matching UPLOAD_LIMITS.maxBytes
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  -- .xlsx
    'application/vnd.ms-excel.sheet.macroEnabled.12',                    -- .xlsm
    'application/vnd.ms-excel',                                          -- .xls
    'text/csv'
  ]
)
on conflict (id) do nothing;

-- No storage.objects policies are created, so no browser role can read or write
-- objects in this bucket. Access is exclusively through the secret key,
-- server-side, exactly as for knowledge documents.
