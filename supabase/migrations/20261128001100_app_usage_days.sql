-- ADMIN ANALYTICS: L10 MEETINGS, FORM MONITORING, AI TRAINING, GOOGLE REVIEWS AND CALENDAR
--
-- Pau, 28 Nov 2026: "add usage for the L10 all meetings and the form monitoring as well pls ... and backfill it",
-- "also add ai training", "add google reviews too and calendar".
--
-- Two kinds of record, and the view counts both:
--
--   1. WHAT ALREADY LEAVES A ROW, counted where it lives (so its history is there from the start):
--        Form Monitoring  archive / unarchive and every follow-up action (form_instance_events); a download is not
--                         counted, because the same PDF route serves the chat's form card
--        AI Training      a submitted assignment (ai_training_submissions)
--        Calendar         a reminder saved (calendar_reminders)
--
--   2. OPENING THE PAGE, which left no trace until now: one row per person, area (and L10 meeting) and Central day in
--      `app_usage_days`, so a page refreshed forty times is one day of use, not forty events. Written by the pages
--      (src/lib/analytics/app-usage.ts) through `record_app_usage`. L10 rows are also backfilled once from the
--      Leadership Hub's save history (source 'backfill'), matched to Ask Sunny accounts by email; see
--      docs/analytics-app-areas.md. Google Reviews and Calendar visits start from this release: nothing recorded them.
--
-- The view is restated exactly as production holds it (pg_get_viewdef, 28 Nov 2026) with four more branches. Same
-- columns, same order, same security_invoker.
--
-- Not applied by the pull request: applied after merge, after 20261128001000.

create table if not exists public.app_usage_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  area public.activity_feature not null
    check (area in ('l10', 'form_monitoring', 'ai_training', 'google_reviews', 'calendar')),
  -- The L10 meeting key ('stc-dm', 'stc-sd-one', ...); '' for the other areas.
  detail text not null default '' check (length(detail) <= 80),
  -- The Central calendar day, like every other day on this dashboard.
  day date not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  hits integer not null default 1 check (hits > 0),
  -- The role at the time, like activity_events.actor_role.
  actor_role public.app_user_role,
  source text not null default 'app' check (source in ('app', 'backfill')),
  primary key (user_id, area, detail, day)
);

create index if not exists app_usage_days_first_at_idx on public.app_usage_days (first_at);

comment on table public.app_usage_days is
  'One row per person, app area (and L10 meeting) and Central day the person opened that area. Counted by activity_unified as one event per row.';

alter table public.app_usage_days enable row level security;
revoke all on public.app_usage_days from anon, authenticated;

create or replace function public.record_app_usage(
  p_user   uuid,
  p_role   public.app_user_role,
  p_area   public.activity_feature,
  p_detail text default ''
)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
  insert into public.app_usage_days (user_id, area, detail, day, actor_role)
  values (p_user, p_area, coalesce(p_detail, ''), (now() at time zone 'America/Chicago')::date, p_role)
  on conflict (user_id, area, detail, day)
  do update set last_at = now(), hits = public.app_usage_days.hits + 1;
$$;

revoke all on function public.record_app_usage(uuid, public.app_user_role, public.activity_feature, text)
  from public, anon, authenticated;

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
  from public.report_ingestions r

  union all

  -- A day somebody opened L10, Form Monitoring, AI Training, Google Reviews or Calendar. The salon is the person's
  -- own (activity_attributed's fallback): opening a page is not about any one salon.
  select
    u.first_at as occurred_at,
    u.user_id as actor_user_id,
    u.actor_role,
    u.area as feature,
    case u.area
      when 'l10'::public.activity_feature then 'l10_meeting'::text
      when 'form_monitoring'::public.activity_feature then 'form_monitoring'::text
      when 'ai_training'::public.activity_feature then 'ai_training'::text
      when 'google_reviews'::public.activity_feature then 'google_reviews'::text
      else 'calendar'::text
    end::public.activity_category as category,
    null::uuid as salon_id,
    true as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.app_usage_days u

  union all

  -- Form Monitoring actions: archive, unarchive and the follow-ups. Not for a form still with HR (as above), and the
  -- salon is the person's own: an administrator following up a salon's form is not that salon using the app.
  select
    ev.created_at as occurred_at,
    case
      when ev.actor ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ev.actor::uuid
      else null::uuid
    end as actor_user_id,
    null::public.app_user_role as actor_role,
    'form_monitoring'::public.activity_feature as feature,
    'form_monitoring'::public.activity_category as category,
    null::uuid as salon_id,
    true as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.form_instance_events ev
    join public.form_instances fi on fi.id = ev.instance_id
  where ev.kind::text = any (array[
      'archived', 'unarchived', 'follow_up_started', 'follow_up_date_changed', 'follow_up_owner_changed',
      'followed_up', 'follow_up_reopened'
    ])
    and (fi.hr_approval_state is null or fi.hr_approval_state = 'approved')

  union all

  -- AI Training: a submitted assignment.
  select
    ts.created_at as occurred_at,
    case
      when ts.user_subject ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ts.user_subject::uuid
      else null::uuid
    end as actor_user_id,
    null::public.app_user_role as actor_role,
    'ai_training'::public.activity_feature as feature,
    'ai_training'::public.activity_category as category,
    null::uuid as salon_id,
    true as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.ai_training_submissions ts

  union all

  -- Calendar: a reminder saved (still counted if it was later deleted: it was used).
  select
    cr.created_at as occurred_at,
    case
      when cr.owner_subject ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then cr.owner_subject::uuid
      else null::uuid
    end as actor_user_id,
    null::public.app_user_role as actor_role,
    'calendar'::public.activity_feature as feature,
    'calendar'::public.activity_category as category,
    null::uuid as salon_id,
    true as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.calendar_reminders cr;

-- Restated: deny by default on top of a security_invoker view.
revoke all on public.activity_unified from anon, authenticated;

-- ------------------------------------------- usage by person, by area -----
--
-- "list all users per name ... not just by title": the per-person table needs each person's count in every area.
-- Filtered exactly as analytics_leaders filters a person's events (district and salon on the event; role and person
-- on the roster, which the page joins), so a person's areas add up to their Activity figure. One row per person and
-- area with any activity; people with none come from the roster.

create or replace function public.analytics_people_features(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (user_id uuid, feature text, events bigint)
language sql
stable
set search_path = public, extensions
as $$
  select
    a.actor_user_id as user_id,
    a.feature::text as feature,
    count(*) as events
  from public.activity_attributed a
  left join public.salon_directory s on s.salon_id = a.salon_id
  where a.occurred_at >= p_from
    and a.occurred_at <  p_to
    and a.actor_user_id is not null
    and (p_district is null or s.district_label = p_district)
    and (p_salon    is null or a.salon_id       = p_salon)
    and (p_actor    is null or a.actor_user_id  = p_actor)
  group by 1, 2;
$$;

revoke all on function public.analytics_people_features(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid)
  from anon, authenticated;
