-- Ask Sunny — private Storage bucket for original documents.
--
-- PRIVATE, unconditionally. Company policy manuals, coaching frameworks and
-- compensation material must never sit behind a public URL. Files are read
-- through short-lived signed URLs minted server-side, never by object path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-documents',
  'knowledge-documents',
  false,
  52428800, -- 50 MB, the same ceiling the server-side validator enforces
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are created for `anon` or `authenticated`.
-- Uploads and downloads both go through server-side routes using the service
-- role, which bypasses RLS. That keeps object paths unguessable AND
-- unrequestable: a browser cannot name a path at all.
--
-- When per-user download access is added after authentication ships, add a
-- select policy here keyed off bucket_id and the user's scope — do not make
-- the bucket public.
