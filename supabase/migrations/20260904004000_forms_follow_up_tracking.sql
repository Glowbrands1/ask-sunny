-- A FOLLOW-UP IS NOT A FORM STATUS.
--
-- `form_instances.status` says what the DOCUMENT is — draft, finalized,
-- revised. It is the thing `forms_guard_finalized_values()` keys the
-- immutability rule off, and it must never come to mean anything else.
--
-- Whether the CONVERSATION happened is a different question with a different
-- lifecycle, and it is the one managers actually work from: a coaching form
-- that was signed three weeks ago and never followed up is finalized and
-- outstanding at the same time. So follow-up tracking is operational metadata
-- ALONGSIDE the record, never a fourth status:
--
--   follow_up_date    already existed — when the conversation is due
--   followed_up_at    when it actually happened
--   followed_up_by    who says so
--
-- Nothing else is stored, because everything else is derivable. "Open",
-- "Overdue" and "Followed up" are computed from these three columns and the
-- current business date, which means no nightly job exists to flip a row from
-- open to overdue, and no row can be stale in the way a cached state would be.
-- See `src/lib/forms/follow-up.ts` for the derivation and
-- `src/lib/forms/business-date.ts` for which "today" it is measured against.
--
-- A NOTE COLUMN IS DELIBERATELY NOT ADDED. What was said belongs in the
-- form's own history, so the reason for a date change travels in the
-- `form_instance_events.detail` of the event that changed it rather than in a
-- column that only ever holds the most recent sentence.

alter table public.form_instances
  add column if not exists followed_up_at timestamptz,
  add column if not exists followed_up_by text;

comment on column public.form_instances.followed_up_at is
  'When the follow-up conversation actually happened. Null while outstanding. Operational metadata: it never changes status and never touches a filled value.';

comment on column public.form_instances.followed_up_by is
  'Who marked the follow-up complete. Carries the same unverified demo: prefix as created_by while there is no identity provider.';

/*
 * TWO INVARIANTS, IN THE DATABASE RATHER THAN IN A ROUTE.
 *
 * The point of marking a follow-up complete is being able to answer "what was
 * scheduled, when did it happen, and who says so". Each of these makes one of
 * those answers impossible to lose:
 */
do $$
begin
  -- Completion is never anonymous.
  if not exists (
    select 1 from pg_constraint where conname = 'form_instances_followed_up_actor'
  ) then
    alter table public.form_instances
      add constraint form_instances_followed_up_actor
      check ((followed_up_at is null) = (followed_up_by is null));
  end if;

  -- And it never happens to a form nobody scheduled, so "the date it was due"
  -- is always there to compare against.
  if not exists (
    select 1 from pg_constraint where conname = 'form_instances_followed_up_needs_date'
  ) then
    alter table public.form_instances
      add constraint form_instances_followed_up_needs_date
      check (followed_up_at is null or follow_up_date is not null);
  end if;
end
$$;

/*
 * THE ATTENTION QUERY, indexed for the shape it actually has.
 *
 * Both the Overview card and the monitoring pills ask the same thing: which
 * un-archived forms have a follow-up date and have not been followed up. That
 * is a small slice of the table by design — most rows are either done or never
 * tracked — so the index is partial and carries the date it is ordered by.
 */
create index if not exists form_instances_follow_up_outstanding
  on public.form_instances (follow_up_date)
  where follow_up_date is not null
    and followed_up_at is null
    and archived_at is null;

-- ----------------------------------------------------------------- the view ---
--
-- Recreated rather than altered: the overview names its columns explicitly, so
-- a new column is invisible to the screens until it is listed here, and
-- Postgres will not add one to the middle of an existing view.

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
  i.followed_up_at,
  i.followed_up_by,
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
 * A dropped view loses its grants, so the deny-by-default posture is restated —
 * belt and braces on top of a `security_invoker` view over tables whose row
 * level security is enabled and FORCED with no policies at all. Restated every
 * time because it would be very easy for a future `drop view` to quietly hand
 * `anon` something readable.
 */
revoke all on public.form_instance_overview from anon, authenticated;
