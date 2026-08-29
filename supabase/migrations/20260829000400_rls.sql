-- Ask Sunny — row level security for internal company knowledge.
--
-- Threat model for this milestone: these documents are confidential internal
-- company material. The default posture is therefore DENY. Nothing is readable
-- by `anon`, and nothing is writable by any browser-held role.
--
--   anon           -> no access at all.
--   authenticated  -> read only, and only once authentication actually ships
--                     (Milestone: Auth). The policy is written now so enabling
--                     it is a matter of users existing, not a schema change.
--   service_role   -> bypasses RLS by design. This is the ONLY role that
--                     writes, and it is only ever used from server-side route
--                     handlers. SUPABASE_SERVICE_ROLE_KEY must never be
--                     exposed to the browser.
--
-- NOTE: the demo role switcher in the prototype is a presentation aid, not
-- authentication. It grants no database access and must not be represented as
-- production security.

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks    enable row level security;

-- Belt and braces: forces RLS even for the table owner.
alter table public.knowledge_documents force row level security;
alter table public.knowledge_chunks    force row level security;

-- Signed-in employees may read the library.
create policy knowledge_documents_read_authenticated
  on public.knowledge_documents
  for select
  to authenticated
  using (true);

-- Signed-in employees may read chunks of documents they can read. Retrieval
-- goes through match_knowledge_chunks, which is security invoker, so this
-- policy is what actually gates a grounded answer.
create policy knowledge_chunks_read_authenticated
  on public.knowledge_chunks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.knowledge_documents d
      where d.id = knowledge_chunks.document_id
    )
  );

-- No insert / update / delete policy exists for `authenticated` on purpose.
-- Ingestion is a server-side operation performed with the service role. When
-- an admin-managed write path is added, it belongs here as an explicit policy
-- keyed off a role claim, not as a blanket `to authenticated`.

-- Explicitly remove any inherited privileges from the browser-held roles.
revoke all on public.knowledge_documents from anon;
revoke all on public.knowledge_chunks    from anon;
revoke execute on function public.match_knowledge_chunks(
  extensions.vector(1024), text, integer, double precision, text[]
) from anon;

grant select on public.knowledge_documents to authenticated;
grant select on public.knowledge_chunks    to authenticated;
grant execute on function public.match_knowledge_chunks(
  extensions.vector(1024), text, integer, double precision, text[]
) to authenticated;
