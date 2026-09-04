-- FORM MONITORING NEEDS TO BE CLEANABLE, WITHOUT WEAKENING WHAT IS SIGNED.
--
-- Two different problems wearing the same word:
--
--   A DRAFT that nobody finished — a QA record, an abandoned start — is
--   clutter. It should be deletable outright, and the existing foreign keys
--   already make that safe: `form_instance_values` and `form_instance_events`
--   cascade from `form_instances`, and `revises_instance_id` is ON DELETE SET
--   NULL, so a revision whose original is removed does not dangle. Nothing new
--   is needed for deletion, and nothing is added here for it.
--
--   A FINALIZED form is a signed HR document. It must not be hard-deleted, and
--   its values must stay immutable. What it needs is to LEAVE THE ACTIVE LIST
--   while remaining on the record.
--
-- So this migration adds one nullable timestamp for the second case and nothing
-- else. Archiving is deliberately NOT a new `status` value:
--
--   `status` says what the form IS — draft, finalized, revised — and
--   `forms_guard_finalized_values()` keys the immutability rule off it. Adding
--   'archived' there would mean a finalized form could stop being finalized,
--   which is exactly the property that must not be losable.
--
--   `archived_at` says where the form is SHOWN. It is orthogonal, it cannot
--   change what the document says, and the value-freezing trigger is untouched
--   by it — the trigger guards `form_instance_values`, and this column is on
--   `form_instances`.
--
-- Setting it on a finalized row is therefore allowed and safe. Clearing it
-- un-archives. Neither can alter a single filled value.

alter table public.form_instances
  add column if not exists archived_at timestamptz;

comment on column public.form_instances.archived_at is
  'When set, the form is hidden from the active Form Monitoring list. Presentation only: it never changes status, and a finalized form stays finalized and immutable.';

/*
 * The active list is the common read and it wants only un-archived rows, so the
 * index is partial. A full index would be mostly dead weight — archiving is
 * rare by design.
 */
create index if not exists form_instances_active
  on public.form_instances (created_at desc)
  where archived_at is null;

-- ----------------------------------------------------------------- the view ---
--
-- The overview names its columns explicitly, so a new column has to be added
-- here too or the screen cannot see it. Recreated rather than altered because
-- Postgres will not add a column to the middle of an existing view.

drop view if exists public.form_instance_overview;

create view public.form_instance_overview
with (security_invoker = true) as
select
  i.id,
  i.template_id,
  t.key as template_key,
  t.name as template_name,
  t.short_name as template_short_name,
  t.layout_family,
  i.template_version_id,
  v.version as template_version,
  i.variant_key,
  i.employee_name,
  i.employee_role,
  i.location_id,
  i.location_name,
  i.created_by,
  i.created_by_role,
  i.source,
  i.status,
  i.form_date,
  i.follow_up_date,
  i.finalized_at,
  i.exported_at,
  i.archived_at,
  i.revises_instance_id,
  i.created_at,
  i.updated_at
from public.form_instances i
join public.form_templates t on t.id = i.template_id
join public.form_template_versions v on v.id = i.template_version_id;

/*
 * A dropped view loses its grants, so the deny-by-default posture is restated.
 * Row level security is enabled and FORCED on the underlying tables with no
 * policies at all, and `security_invoker` means the view reads with the
 * caller's rights rather than its owner's — so this revoke is belt and braces
 * on top of a view that already cannot leak. Restated because it would be very
 * easy for a future `drop view` to quietly hand `anon` a readable view.
 */
revoke all on public.form_instance_overview from anon, authenticated;
