-- ONE OPEN REVISION PER FORM: AN ARCHIVED DRAFT IS NOT OPEN.
--
-- QA's audit item 17a (10 Nov 2026). `findOpenRevision` (src/lib/forms/instances.ts)
-- returned a revision draft an administrator had archived, so "Edit as new draft"
-- reopened it. Behind REVISION_ARCHIVED_NOT_OPEN_ENABLED, an archived draft is no
-- longer the open revision and a new request opens a new draft. The index from
-- 20261025233000 counts every draft revision, archived or not, so it would refuse
-- that new draft (23505) and `reviseInstance`'s raced lookup, which also skips the
-- archived one, would find nothing: the request would fail. This narrows the index
-- to the drafts that are open: not archived.
--
-- Safe with the flag off: `findOpenRevision` still returns the archived draft, so
-- no second draft is ever inserted beside it, and the narrower index refuses every
-- duplicate the old one refused among un-archived drafts.
--
-- With the flag on, un-archiving an old revision draft while a newer one is open is
-- refused by the index (23505): one open draft per form, as before.
--
-- Same build as 20261025233000: not CONCURRENTLY, a brief lock on form_instances.

drop index if exists public.form_instances_one_open_revision;

create unique index form_instances_one_open_revision
  on public.form_instances (revises_instance_id)
  where status = 'draft' and revises_instance_id is not null and archived_at is null;
