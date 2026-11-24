-- ---------------------------------------------------------------------------
-- NO ARCHIVED FORMS (Pau, 23 Nov 2026): "the archived should not be
-- acknowledged as a form, all just should be finalized or drafted."
--
-- Form Monitoring no longer has an Archive / Restore action, an Archived shelf
-- or an Archived badge, and nothing in the app (the lists, the follow-up
-- queries, the chat and the agent loop) filters or marks `archived_at` any
-- more. A form is Draft or Finalized (and `revised`, as the database has it).
--
-- THIS CLEARS THE OLD FLAG, so a form the flag had hidden is listed like any
-- other: a finalized one is kept on file, a draft can be deleted from Form
-- Monitoring. Each cleared row gets an 'unarchived' event (the kind already
-- exists, 20260904003000) so its own history says what happened.
--
-- THE COLUMN STAYS. `form_instances.archived_at`, the view column that exposes
-- it (`form_instance_overview.archived_at`) and the `form_instances_active` /
-- follow-up partial indexes are left exactly as they are: dropping them means
-- recreating the overview view and rewriting every older migration's
-- assumptions for no gain, and a column that is always null is harmless.
-- `form_template_versions.archived_at` (a replaced template version) is a
-- different thing and is not touched.
--
-- Idempotent: a second run finds no archived rows and changes nothing.
-- Status, finalized_at and every filled value are untouched.
-- ---------------------------------------------------------------------------

insert into public.form_instance_events (instance_id, kind, actor, detail)
select id, 'unarchived', 'system:archive-removed', jsonb_build_object('was_archived_at', archived_at)
from public.form_instances
where archived_at is not null;

update public.form_instances
set archived_at = null
where archived_at is not null;
