-- THE FOLLOW-UP DECISIONS HAVE TO BE RECORDABLE.
--
-- `form_instance_events.kind` is an enum on purpose: a typo cannot invent a new
-- kind of history. The cost is that a new kind of event needs a migration, and
-- forgetting one is not a type error — the column maps to `string`, so it fails
-- at the insert, in production, taking the whole call down with it. That
-- happened once with 'archived'. These are added before the code that writes
-- them.
--
--   follow_up_started       a form that was not being tracked now has a date
--   follow_up_date_changed  the date moved (detail carries from/to)
--   followed_up             the conversation happened
--   follow_up_reopened      an explicit, audited undo of the above
--
-- Appended, never rewritten: recreating the type would mean dropping and
-- recreating the column that holds every form's history.

alter type public.form_event_kind add value if not exists 'follow_up_started';
alter type public.form_event_kind add value if not exists 'follow_up_date_changed';
alter type public.form_event_kind add value if not exists 'followed_up';
alter type public.form_event_kind add value if not exists 'follow_up_reopened';
