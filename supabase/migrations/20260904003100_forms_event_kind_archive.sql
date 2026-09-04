-- ARCHIVING IS A DECISION SOMEBODY MADE, SO IT HAS TO BE RECORDABLE.
--
-- `form_instance_events.kind` is an enum, not free text — deliberately, so a
-- typo cannot invent a new kind of history. The consequence is that a new kind
-- of event needs a migration, and archiving is one: `archiveInstance` records
-- who hid a form from the active list and who put it back, which is exactly the
-- question asked later when a form is missing from Form Monitoring.
--
-- Without these two values the insert fails and the archive call fails with it,
-- which is how this was caught.
--
-- Added as separate statements rather than a recreated type: rewriting an enum
-- means dropping and recreating the column that uses it, and there is no reason
-- to touch existing history to append to it.

alter type public.form_event_kind add value if not exists 'archived';
alter type public.form_event_kind add value if not exists 'unarchived';
