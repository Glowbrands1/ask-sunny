-- ===========================================================================
-- THE ONE TABLE IN `public` WITH NO ROW LEVEL SECURITY
-- ===========================================================================
--
-- `public.knowledge_chunks_backfill_20260911` is a snapshot taken by hand on
-- 11 September, before a backfill rewrote knowledge chunk locators. It was
-- created outside this migrations directory, so it exists in the deployed
-- database and in no schema file — which is precisely why it was missed: every
-- table that arrived through a migration got the project's security posture
-- written beside it, and this one never passed through that door.
--
-- WHAT IT ACTUALLY EXPOSES. 110 rows of `id, locator, section, metadata` — no
-- chunk text and no embeddings, so this is not the knowledge base leaking. It
-- is still a real hole: Supabase grants `anon` and `authenticated` full DML on
-- any new table in `public`, and with RLS off those grants are the whole story.
-- Anyone holding the publishable key — which ships in every browser — could
-- read this table, and could just as easily DELETE the backup somebody took
-- specifically so a bad backfill could be undone.
--
-- WHY ENABLING IT BREAKS NOTHING.
--
--   1. Nothing reads it. No application code, no migration and no view refers
--      to it (`pg_depend` reports zero dependent rewrite rules), and the name
--      appears nowhere in the repository.
--   2. Knowledge RETRIEVAL does not touch it. `match_knowledge_chunks` reads
--      `public.knowledge_chunks`, which has RLS enabled and forced already and
--      is unchanged here.
--   3. The snapshot stays restorable. The secret key holds `service_role`,
--      which bypasses RLS by design, so a restore from this table works after
--      this migration exactly as it did before.
--
-- The alternative — dropping it — would destroy the only copy of the
-- pre-backfill locators while the backfill it guards is still recent. The
-- table is kept; only the reach of a browser-held key is removed.
--
-- IF EXISTS, because the table is not in this migration history: a database
-- built from these files alone has never had it, and that is a correct outcome
-- rather than a failure to abort on.

do $$
begin
  if to_regclass('public.knowledge_chunks_backfill_20260911') is null then
    raise notice
      'knowledge_chunks_backfill_20260911 is absent; nothing to secure.';
    return;
  end if;

  -- WRITTEN OUT WHOLE, not assembled from fragments: a static test greps this
  -- directory for the posture, and a statement split across a `||` is invisible
  -- to it. The line is long; the alternative is a check that cannot see this.
  execute 'alter table public.knowledge_chunks_backfill_20260911 enable row level security';
  -- Forced, so the policies bind the table owner too and a later migration
  -- running as owner cannot read around them.
  execute 'alter table public.knowledge_chunks_backfill_20260911 force row level security';

  -- The grants Supabase hands out by default, taken back. RLS alone would
  -- already deny these roles; revoking says so at the privilege layer as well,
  -- which is the posture every other table in this schema carries.
  execute 'revoke all on public.knowledge_chunks_backfill_20260911 from anon, authenticated';

  execute 'comment on table public.knowledge_chunks_backfill_20260911 is '
       || quote_literal(
            'Hand-taken snapshot of knowledge chunk locators before the '
         || '11 September 2026 backfill. Read by nothing; kept so the backfill '
         || 'can be undone. Reachable only with the secret key.');
end
$$;

/*
 * NO POLICY IS DEFINED, AND THAT IS THE POLICY.
 *
 * RLS enabled with no policy denies every role that does not bypass it, which
 * is the same shape `activity_events`, `form_instances` and `training_videos`
 * already use. Writing `using (false)` would say the same thing in more words
 * and invite somebody to "fix" it later by loosening the predicate.
 *
 * ROLLBACK, if this table ever does need a client-side reader:
 *
 *   alter table public.knowledge_chunks_backfill_20260911
 *     no force row level security;
 *   alter table public.knowledge_chunks_backfill_20260911
 *     disable row level security;
 *   grant select on public.knowledge_chunks_backfill_20260911 to authenticated;
 *
 * — but a reader for a one-off backup snapshot is a sign the restore belongs
 * in a server route, not in a browser.
 */
