-- ONE OPEN REVISION PER FORM, enforced by the database.
--
-- `reviseInstance` (src/lib/forms/instances.ts) returns the open revision when
-- there is one, but two presses of "Edit as new draft" at the same moment can
-- both pass that check and each insert a draft. This index refuses the second
-- insert (unique_violation, 23505); `reviseInstance` then returns the revision
-- the first press opened.
--
-- Only OPEN DRAFTS that revise a form are covered. Finalized revisions, and
-- every form that revises nothing, are untouched, so a form can still be
-- revised again after its revision is finalized.
--
-- Before applying, this must return no rows (an existing duplicate would make
-- the index fail to build):
--
--   select revises_instance_id, count(*)
--   from public.form_instances
--   where status = 'draft' and revises_instance_id is not null
--   group by revises_instance_id
--   having count(*) > 1;
--
-- Not CONCURRENTLY: migrations run inside a transaction. The table is small and
-- the build takes a brief lock on form_instances only.

create unique index if not exists form_instances_one_open_revision
  on public.form_instances (revises_instance_id)
  where status = 'draft' and revises_instance_id is not null;
