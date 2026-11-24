-- ADMIN ANALYTICS: A FORM STILL WITH HR IS NOT COUNTED YET
--
-- Owner, 23 Nov 2026: "are u sure this doesnt leak information, that other people cant see what a certain manager
-- created?". While a form waits for HR (pending, sent back or rejected) only its creator, its senders and HR may know
-- it exists. `activity_unified` counted every filed form for its creator and salon, so an administrator's adoption
-- figures rose by one the moment a manager sent a form, while Form Monitoring showed nothing new. A form now counts
-- once HR approves it (or if it never went to HR), on the day it was created, as before.
--
-- The view is restated exactly as production holds it (read with pg_get_viewdef, 23 Nov 2026), with one more
-- condition on the forms branch. Same columns, same order, same security_invoker; nothing else changes.
--
-- Not applied by the pull request: applied after merge.

create or replace view public.activity_unified
with (security_invoker = true) as
  select
    e.occurred_at,
    e.actor_user_id,
    e.actor_role,
    e.feature,
    e.category,
    e.salon_id,
    e.succeeded,
    e.surface,
    e.turn_kind
  from public.activity_events e

  union all

  -- Filed forms. A form still with HR is not counted yet.
  select
    i.created_at as occurred_at,
    case
      when i.created_by ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then i.created_by::uuid
      else null::uuid
    end as actor_user_id,
    null::public.app_user_role as actor_role,
    'forms'::public.activity_feature as feature,
    case
      when t.key = any (array['coaching'::text, 'follow-up-coaching'::text]) then 'coaching_form'::text
      when t.key = 'dpoa'::text then 'corrective_action'::text
      when t.key = 'policy-review'::text then 'policy_review'::text
      when t.key ~~ '%epp%'::text then 'epp'::text
      when t.category = 'hiring'::text then 'hiring_form'::text
      else null::text
    end::public.activity_category as category,
    s.id as salon_id,
    true as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.form_instances i
    join public.form_templates t on t.id = i.template_id
    left join public.salons s
      on i.location_id is not null and s.salon_number = regexp_replace(i.location_id, '^loc-'::text, ''::text)
  where ((t.key = any (array['coaching'::text, 'follow-up-coaching'::text, 'dpoa'::text, 'policy-review'::text]))
      or t.key ~~ '%epp%'::text
      or t.category = 'hiring'::text)
    and (i.hr_approval_state is null or i.hr_approval_state = 'approved')

  union all

  select
    d.created_at as occurred_at,
    d.uploaded_by as actor_user_id,
    null::public.app_user_role as actor_role,
    'knowledge'::public.activity_feature as feature,
    'document_upload'::public.activity_category as category,
    null::uuid as salon_id,
    true as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.knowledge_documents d

  union all

  select
    r.created_at as occurred_at,
    null::uuid as actor_user_id,
    null::public.app_user_role as actor_role,
    'reports'::public.activity_feature as feature,
    'report_upload'::public.activity_category as category,
    null::uuid as salon_id,
    r.status = 'succeeded'::public.report_ingestion_status as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.report_ingestions r;

-- Restated: deny by default on top of a security_invoker view.
revoke all on public.activity_unified from anon, authenticated;
