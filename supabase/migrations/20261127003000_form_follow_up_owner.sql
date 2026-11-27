-- ---------------------------------------------------------------------------
-- WHO OWNS A FORM'S FOLLOW-UP (the owner, 27 Nov 2026, approved "ok to all"):
-- the creator of a form can hand its follow-up to someone else (e.g. the DM).
--
--   form_instances.follow_up_owner   the account (`app_users.id`, as text like
--                                    `created_by`) who does the follow-up; null
--                                    means the creator, exactly as before.
--
-- Only someone who may already open that form may own it: the code offers and
-- accepts only accounts whose own forms access covers the form's salon
-- (`src/lib/forms/follow-up-owner.ts`, the same `actorMaySeeInstance` rule the
-- forms pages use), and who may edit that form's template. The owner then sees
-- the follow-up on their Calendar with the employee's name, and gets the due and
-- overdue bells (`follow-up-notices.ts`); the creator keeps both.
--
-- Additive only: one nullable column, one event kind, and the overview view
-- extended AT ITS END (`create or replace` may only add columns there). Until
-- this is applied the code reads every form as owned by its creator and the
-- owner picker's save answers that it could not be saved.
--
-- Not applied by the pull request: it is applied after merge.
-- ---------------------------------------------------------------------------

alter table public.form_instances
  add column if not exists follow_up_owner text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'form_instances_follow_up_owner_length') then
    alter table public.form_instances add constraint form_instances_follow_up_owner_length check (
      follow_up_owner is null or length(follow_up_owner) between 1 and 200
    );
  end if;
end $$;

-- The owner's calendar and bells read their own follow-ups.
create index if not exists form_instances_follow_up_owner
  on public.form_instances (follow_up_owner)
  where follow_up_owner is not null;

-- The form's history says who handed the follow-up to whom (detail carries from/to).
alter type public.form_event_kind add value if not exists 'follow_up_owner_changed';

-- ------------------------------------------------------- the overview view ---

-- Every existing column keeps its name, type and order, as
-- 20261123001000_forms_hr_approval.sql defined them; the owner is added last.
create or replace view public.form_instance_overview
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
  i.updated_at,
  lower(extensions.unaccent(i.employee_name)) as employee_name_folded,
  i.hr_approval_state,
  i.hr_approval_requested_at,
  t.required_permission,
  i.hr_approval_requested_by,
  i.hr_approval_senders,
  i.follow_up_owner
from public.form_instances i
join public.form_templates t on t.id = i.template_id
join public.form_template_versions v on v.id = i.template_version_id;

-- Restated, as every redefinition of this view does: deny by default on top of a security_invoker view.
revoke all on public.form_instance_overview from anon, authenticated;
