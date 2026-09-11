-- ---------------------------------------------------------------------------
-- ADOPTION ANALYTICS — the one event table, and only for what leaves no trace.
--
-- WHAT THIS IS FOR. Management needs to know who is actually using Ask Sunny,
-- from which salon, how often, and what for — and, more actionable than any of
-- those, WHO IS NOT. None of that was answerable, because the two halves of the
-- app record activity in opposite ways.
--
-- THE HALF THAT ALREADY RECORDS ITSELF. A filed form, an uploaded document and
-- an ingested workbook each leave a durable, timestamped, attributed row:
-- `form_instances.created_by/created_at`, `knowledge_documents.uploaded_by/
-- created_at`, `report_ingestions.created_at`. Those rows ARE the event log for
-- those actions. Copying them into a second table would mean two counts of one
-- act, drifting apart the first time one write path forgets the other.
--
--   SO THIS TABLE DOES NOT RECORD THEM. `activity_unified` below reads them
--   where they already live. That is the whole reason there is one small table
--   here rather than an analytics schema.
--
-- THE HALF THAT LEAVES NOTHING. `POST /api/chat` is stateless — it answers and
-- forgets, writing to no table in any schema. Knowledge search, a video play
-- and a Sales Totals analysis are the same: real work by a named person that
-- vanished the moment the response was sent. Every question about assistant
-- adoption was therefore unanswerable, not approximately but exactly: there was
-- no row to count. This table exists for those acts and no others.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD: the question. No prompt, no answer, no
-- excerpt, no hash of either — there is no column one could be put in, which is
-- a stronger guarantee than a policy that callers must remember. Managers ask
-- Ask Sunny about named employees' attendance and performance; that is HR
-- content, and an adoption dashboard needs to know THAT somebody asked, never
-- WHAT they asked. The category is classified from what the server itself did
-- when answering — whether it proposed a form, whether a report was attached,
-- whether company documents were cited — not from reading the text.
--
-- ADDITIVE ONLY. Two enums, one table, one view, indexes and policies. Nothing
-- existing is altered, rewritten or dropped.
-- ---------------------------------------------------------------------------

/*
 * WHICH PART OF THE APP THE ACT HAPPENED IN.
 *
 * An enum rather than free text, for the reason `app_user_role` is one: a typo
 * becomes a rejected write rather than a category that silently counts as
 * nothing. `forms`, `knowledge` and `reports` appear here even though this
 * table records only their unrecorded acts — a knowledge SEARCH lands here, a
 * knowledge UPLOAD does not — because the unified view spans both halves and
 * the vocabulary has to be the same on each side of the union.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_feature') then
    create type public.activity_feature as enum (
      'chat',
      'forms',
      'knowledge',
      'reports',
      'videos'
    );
  end if;
end
$$;

/*
 * WHAT THE PERSON WAS DOING, in the business's own vocabulary.
 *
 * Taken from the taxonomy the application already ships rather than invented
 * for this table: the form library's template keys (`coaching`, `dpoa`,
 * `policy-review`, the EPP family, the hiring family) and the permission names
 * that gate them. A category here is a thing a manager would recognise from the
 * product, which is the test for whether "What Ask Sunny is used for" is
 * reporting on the business or on the implementation.
 *
 * THE FOUR CHAT CATEGORIES ARE CLASSIFIED FROM THE SERVER'S OWN BEHAVIOUR, and
 * this is the part that has to stay honest:
 *
 *   form_request      the answer carried a form proposal or the form choices —
 *                     the turn was about producing a form
 *   daily_stats       the request arrived with a report context attached
 *   policy_question   the answer cited indexed company documents
 *   general_guidance  none of the above
 *
 * Each is a fact about what the handler did, observable at the moment it
 * returns. None of them requires looking at the question, which is what lets
 * the text stay unstored.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_category') then
    create type public.activity_category as enum (
      /* chat */
      'general_guidance',
      'policy_question',
      'daily_stats',
      'form_request',
      /* forms — the template families the library actually ships */
      'coaching_form',
      'corrective_action',
      'epp',
      'policy_review',
      'hiring_form',
      /* knowledge */
      'document_upload',
      'document_search',
      /* reports */
      'report_upload',
      'report_analysis',
      /* videos */
      'training_video'
    );
  end if;
end
$$;

create table if not exists public.activity_events (
  id uuid primary key default extensions.gen_random_uuid(),

  /*
   * WHEN, as the server saw it. Defaulted rather than required so a caller
   * cannot backdate activity by passing a timestamp, which would let a bug —
   * or anybody holding the secret key — reshape an adoption trend.
   */
  occurred_at timestamptz not null default now(),

  /*
   * WHO, as an auth user id.
   *
   * `on delete set null` rather than cascade: deleting a person must not delete
   * the record that the estate was active. The act happened; the attribution is
   * what is lost, and an event with no actor still counts toward usage.
   *
   * NULLABLE for exactly that reason, and for machine-driven acts (an emailed
   * workbook has no person behind it).
   */
  actor_user_id uuid references auth.users (id) on delete set null,

  /*
   * THE ROLE AS IT WAS AT THE TIME, copied deliberately rather than joined.
   *
   * A Salon Director promoted to District Manager in March did not retroactively
   * ask March's questions as a DM. Joining `app_users` live would rewrite every
   * historical "usage by role" split on the day somebody is promoted. This is
   * the one denormalised column here and it is denormalised on purpose.
   */
  actor_role public.app_user_role,

  feature public.activity_feature not null,
  category public.activity_category not null,

  /*
   * WHERE, by the authoritative account relationship — never inferred from what
   * somebody typed. Written from `app_users.scope_primary_area_id`, which is
   * `loc-<salon_number>`; `salon_id` is resolved against `salons` at write time
   * where that salon is known to reporting, and `location_ref` keeps the raw
   * scope id so an event is still attributable when it is not.
   */
  salon_id uuid references public.salons (id) on delete set null,
  location_ref text,

  /*
   * Whether the act succeeded. An answer that errored is still usage — somebody
   * tried — so it is recorded and counted separately rather than dropped, which
   * is what makes an answer rate honest instead of flattering.
   */
  succeeded boolean not null default true,

  /* Server-measured, where the handler measures it. Never guessed. */
  latency_ms integer check (latency_ms is null or latency_ms >= 0),

  created_at timestamptz not null default now()
);

comment on table public.activity_events is
  'Adoption events for acts that leave no other trace: chat questions, knowledge searches, video plays, report analyses. Carries NO prompt, answer or question text — there is no column for one. Forms, document uploads and report ingestions are NOT recorded here; they are counted from their own tables through activity_unified.';

comment on column public.activity_events.actor_role is
  'The actor role at the time of the act. Denormalised on purpose so a later promotion does not rewrite historical usage-by-role.';

comment on column public.activity_events.category is
  'What the person was doing, in the product''s own vocabulary. For chat this is classified from what the server did when answering — proposed a form, read an attached report, cited documents — never from the question text.';

/* The dashboard's own access pattern: a window, newest first, then grouped. */
create index if not exists activity_events_occurred_at
  on public.activity_events (occurred_at desc);

/* "Who has not started yet" and the per-leader drill-down. */
create index if not exists activity_events_actor
  on public.activity_events (actor_user_id, occurred_at desc);

/* By Location, and the inactive-salon list. */
create index if not exists activity_events_salon
  on public.activity_events (salon_id, occurred_at desc);

/* Usage Types, and the feature-usage split. */
create index if not exists activity_events_category
  on public.activity_events (category, occurred_at desc);

-- --------------------------------------------------------- the union -------
--
-- ONE SHAPE OVER BOTH HALVES, so a query does not have to know which acts
-- happen to leave a durable row and which needed a table of their own. Every
-- branch supplies the same seven columns and nothing that reads analytics ever
-- touches a source table directly.
--
-- A SECURITY-INVOKER VIEW. It runs with the privileges of whoever selects from
-- it, so it cannot become a way around the policies on the tables underneath —
-- the pattern the reporting views already use here.

create or replace view public.activity_unified
with (security_invoker = true) as

  /* The acts with no other record. */
  select
    e.occurred_at,
    e.actor_user_id,
    e.actor_role,
    e.feature,
    e.category,
    e.salon_id,
    e.succeeded
  from public.activity_events e

  union all

  /*
   * FILED FORMS, counted where they already live.
   *
   * `created_by` is text holding an auth user id, so it is cast only when it
   * looks like one: the demo actor prefix and any legacy value resolve to a
   * null actor rather than failing the whole view. Those rows still count as
   * activity; they are simply not attributed to a person.
   *
   * The category comes from the template key — the library's own taxonomy —
   * and an unrecognised key is left out rather than bucketed into a category it
   * does not belong to.
   */
  select
    i.created_at as occurred_at,
    case
      when i.created_by ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then i.created_by::uuid
      else null
    end as actor_user_id,
    null::public.app_user_role as actor_role,
    'forms'::public.activity_feature as feature,
    case
      when t.key in ('coaching', 'follow-up-coaching') then 'coaching_form'
      when t.key = 'dpoa' then 'corrective_action'
      when t.key = 'policy-review' then 'policy_review'
      when t.key like '%epp%' then 'epp'
      when t.category = 'hiring' then 'hiring_form'
    end::public.activity_category as category,
    s.id as salon_id,
    true as succeeded
  from public.form_instances i
  join public.form_templates t on t.id = i.template_id
  /*
   * The salon, where the form names one. `location_id` is `loc-<salon_number>`
   * and is present on well under half the rows, so this is a left join: a form
   * with no location still counts toward the estate and toward its author, and
   * simply does not appear under a salon.
   */
  left join public.salons s
    on i.location_id is not null
   and s.salon_number = regexp_replace(i.location_id, '^loc-', '')
  where t.key in ('coaching', 'follow-up-coaching', 'dpoa', 'policy-review')
     or t.key like '%epp%'
     or t.category = 'hiring'

  union all

  /* Knowledge uploads, already attributed by `uploaded_by`. */
  select
    d.created_at as occurred_at,
    d.uploaded_by as actor_user_id,
    null::public.app_user_role as actor_role,
    'knowledge'::public.activity_feature as feature,
    'document_upload'::public.activity_category as category,
    null::uuid as salon_id,
    true as succeeded
  from public.knowledge_documents d

  union all

  /*
   * INGESTED WORKBOOKS, AND THE ONE THING THEY CANNOT SAY.
   *
   * `report_ingestions` carries no actor column, because ingestion is machine
   * work — a pipeline credential or a forwarded email, not a person. So these
   * rows count toward estate activity and toward "Reports Analyzed", and their
   * actor is null by nature rather than by accident. Attributing them to a
   * leader would be the dashboard inventing an adoption fact.
   */
  select
    r.created_at as occurred_at,
    null::uuid as actor_user_id,
    null::public.app_user_role as actor_role,
    'reports'::public.activity_feature as feature,
    'report_upload'::public.activity_category as category,
    null::uuid as salon_id,
    r.status = 'succeeded' as succeeded
  from public.report_ingestions r;

comment on view public.activity_unified is
  'Every recorded act in one shape: the activity_events table for what leaves no other trace, plus form_instances, knowledge_documents and report_ingestions read where they already live. security_invoker, so it grants nothing the underlying policies refuse.';

-- ------------------------------------------------------------- security ----
--
-- Same posture as every other table here, and for the same measured reason:
-- Supabase's default privileges hand `anon` and `authenticated` full DML on any
-- new table in `public`, so both are REVOKED first and nothing is granted back.
--
-- Forced, so the policies bind the table owner too and a later migration
-- running as owner cannot read around them.
--
-- NOBODY READS THIS WITH A BROWSER-HELD KEY. The analytics screens are
-- server-rendered and admin-gated in the application, and reach the data with
-- the secret key — which holds `service_role` and bypasses RLS by design. There
-- is therefore no "authenticated may select" policy: adoption data names every
-- leader and how little they have used the product, and the publishable key is
-- in every browser.

alter table public.activity_events enable row level security;
alter table public.activity_events force  row level security;

revoke all on public.activity_events   from anon, authenticated;
revoke all on public.activity_unified  from anon, authenticated;

/*
 * NO POLICY IS DEFINED, AND THAT IS THE POLICY.
 *
 * RLS enabled with no policy denies every role that does not bypass it. Writing
 * `using (false)` would say the same thing in more words and invite somebody to
 * "fix" it later by loosening the predicate.
 */
