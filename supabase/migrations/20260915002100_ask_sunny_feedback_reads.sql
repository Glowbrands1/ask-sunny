-- ---------------------------------------------------------------------------
-- FEEDBACK AND USAGE — the read side.
--
-- EVERY AGGREGATE IS COMPUTED HERE, same rule as the adoption functions this
-- sits beside: the dashboard asks a question and receives an answer, never rows
-- to add up. A feedback list that grows for a year must not become a page that
-- loads a year of comments so a browser can count the fours.
--
-- ONE FILTER SIGNATURE, matching `analytics_totals` exactly, so a filter added
-- to the dashboard is added the same way everywhere and the feedback panel can
-- never disagree with the KPI row above it about which window it is describing.
--
-- HIDDEN FEEDBACK IS EXCLUDED FROM EVERY AGGREGATE AND FROM THE DEFAULT LIST,
-- and included only when a caller asks for it explicitly. That is what makes
-- hiding a moderation action rather than a deletion: the average stops counting
-- it the moment it is hidden, and it is still there to be found.
--
-- ADDITIVE ONLY: one view, seven functions, all new.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------- feedback, attributed ----
--
-- THE ONE PLACE FEEDBACK MEETS ITS TURN, so every panel agrees about which
-- role, salon, surface and topic a rating belongs to.
--
-- None of those four is stored on the feedback row. They are the event's, and
-- the event recorded them at the time from the account — which is both more
-- correct and less to keep in step. A rating left by a Salon Director who is
-- later promoted stays a Salon Director's rating, because `activity_events`
-- already froze the role for exactly that reason.

create or replace view public.feedback_attributed
with (security_invoker = true) as
select
  f.id,
  f.activity_event_id,
  f.user_id,
  f.rating,
  f.got_what_needed,
  f.comment,
  f.status,
  f.resolution_note,
  f.resolved_by,
  f.resolved_at,
  f.hidden_at,
  f.hidden_by,
  f.created_at,
  f.updated_at,
  f.client_conversation_id,
  f.client_message_id,
  /* From the turn, never from the feedback row — see the header. */
  e.occurred_at,
  e.feature,
  e.category,
  e.surface,
  e.turn_kind,
  e.succeeded,
  coalesce(e.actor_role, l.role) as role,
  coalesce(e.salon_id, l.salon_id) as salon_id,
  l.display_name,
  l.store_name,
  l.district_label
from public.ask_sunny_feedback f
join public.activity_events e on e.id = f.activity_event_id
left join public.leader_directory l on l.user_id = f.user_id;

comment on view public.feedback_attributed is
  'Feedback joined to the turn it is about, with role, salon, surface and topic taken from the event rather than copied onto the rating. security_invoker, so it grants nothing the underlying policies refuse.';

revoke all on public.feedback_attributed from anon, authenticated;

-- -------------------------------------------------- the feedback summary ---

create or replace function public.analytics_feedback_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null,
  p_surface   public.activity_surface default null
)
returns table (
  responses      bigint,
  average_rating numeric,
  rating_1       bigint,
  rating_2       bigint,
  rating_3       bigint,
  rating_4       bigint,
  rating_5       bigint,
  outcome_yes    bigint,
  outcome_partially bigint,
  outcome_no     bigint,
  pending        bigint,
  in_review      bigint,
  resolved       bigint,
  dismissed      bigint,
  hidden         bigint
)
language sql
stable
set search_path = public, extensions
as $$
  select
    count(*) filter (where f.hidden_at is null)                    as responses,
    /*
     * NULL RATHER THAN ZERO WHEN NOTHING IS RATED. `avg` already returns null
     * over an empty set and it is left alone: a dashboard printing "0.0 stars"
     * for a period nobody rated is reporting a catastrophe that did not happen.
     * The screen renders "No data yet" against a null.
     *
     * Rounded to one decimal here rather than in the browser so every panel
     * that shows this figure shows the same digits.
     */
    round(avg(f.rating) filter (where f.hidden_at is null), 1)     as average_rating,
    count(*) filter (where f.hidden_at is null and f.rating = 1)   as rating_1,
    count(*) filter (where f.hidden_at is null and f.rating = 2)   as rating_2,
    count(*) filter (where f.hidden_at is null and f.rating = 3)   as rating_3,
    count(*) filter (where f.hidden_at is null and f.rating = 4)   as rating_4,
    count(*) filter (where f.hidden_at is null and f.rating = 5)   as rating_5,
    count(*) filter (where f.hidden_at is null and f.got_what_needed = 'yes')       as outcome_yes,
    count(*) filter (where f.hidden_at is null and f.got_what_needed = 'partially') as outcome_partially,
    count(*) filter (where f.hidden_at is null and f.got_what_needed = 'no')        as outcome_no,
    /*
     * THE MODERATION COUNTS INCLUDE HIDDEN ROWS DELIBERATELY. They are a queue
     * depth, not a quality measure — an administrator needs to know a hidden
     * item is still unresolved, and hiding a complaint is not the same as
     * answering it.
     */
    count(*) filter (where f.status = 'pending')   as pending,
    count(*) filter (where f.status = 'in_review') as in_review,
    count(*) filter (where f.status = 'resolved')  as resolved,
    count(*) filter (where f.status = 'dismissed') as dismissed,
    count(*) filter (where f.hidden_at is not null) as hidden
  from public.feedback_attributed f
  left join public.salon_directory s on s.salon_id = f.salon_id
  where f.created_at >= p_from
    and f.created_at <  p_to
    and (p_district is null or s.district_label = p_district)
    and (p_salon    is null or f.salon_id       = p_salon)
    and (p_role     is null or f.role           = p_role)
    and (p_actor    is null or f.user_id        = p_actor)
    and (p_surface  is null or f.surface        = p_surface);
$$;

comment on function public.analytics_feedback_summary is
  'One row summarising feedback in a window: volume, average, the five-band distribution and the outcome split, all excluding hidden rows; plus moderation queue depths, which include hidden rows because hiding a complaint does not answer it. average_rating is null when nothing was rated.';

-- ----------------------------------------------------- the feedback list ---

create or replace function public.analytics_feedback_list(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null,
  p_surface   public.activity_surface default null,
  p_status    public.feedback_status  default null,
  p_outcome   public.feedback_outcome default null,
  p_rating    smallint default null,
  /*
   * Hidden items are OUT unless asked for. An administrator reviewing what has
   * been hidden is a deliberate act with its own filter, not the default view.
   */
  p_include_hidden boolean default false,
  /*
   * Free-text search over the comment.
   *
   * `ilike` with the term escaped, rather than full-text search: the corpus is
   * short comments in the hundreds, an administrator searching "DPOA" wants a
   * substring rather than a stemmed lexeme, and a tsvector index here would be
   * machinery for a problem nobody has. `%` and `_` in the term are escaped so
   * a search for "100%" is a search for "100%".
   */
  p_search    text    default null,
  p_limit     integer default 25,
  p_offset    integer default 0
)
returns table (
  id uuid,
  activity_event_id uuid,
  rating smallint,
  got_what_needed public.feedback_outcome,
  comment text,
  status public.feedback_status,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by_name text,
  hidden_at timestamptz,
  hidden_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  occurred_at timestamptz,
  surface public.activity_surface,
  category public.activity_category,
  feature public.activity_feature,
  succeeded boolean,
  role public.app_user_role,
  display_name text,
  store_name text,
  district_label text,
  client_conversation_id text,
  client_message_id text,
  total_count bigint
)
language sql
stable
set search_path = public, extensions
as $$
  with filtered as (
    select f.*
    from public.feedback_attributed f
    left join public.salon_directory s on s.salon_id = f.salon_id
    where f.created_at >= p_from
      and f.created_at <  p_to
      and (p_include_hidden or f.hidden_at is null)
      and (p_district is null or s.district_label = p_district)
      and (p_salon    is null or f.salon_id       = p_salon)
      and (p_role     is null or f.role           = p_role)
      and (p_actor    is null or f.user_id        = p_actor)
      and (p_surface  is null or f.surface        = p_surface)
      and (p_status   is null or f.status         = p_status)
      and (p_outcome  is null or f.got_what_needed = p_outcome)
      and (p_rating   is null or f.rating          = p_rating)
      and (
        p_search is null
        or btrim(p_search) = ''
        or f.comment ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
  )
  select
    f.id,
    f.activity_event_id,
    f.rating,
    f.got_what_needed,
    f.comment,
    f.status,
    f.resolution_note,
    f.resolved_at,
    rb.display_name as resolved_by_name,
    f.hidden_at,
    hb.display_name as hidden_by_name,
    f.created_at,
    f.updated_at,
    f.occurred_at,
    f.surface,
    f.category,
    f.feature,
    f.succeeded,
    f.role,
    f.display_name,
    f.store_name,
    f.district_label,
    f.client_conversation_id,
    f.client_message_id,
    /*
     * THE TOTAL TRAVELS WITH THE PAGE. A separate count function would be a
     * second round trip and a second chance for the two to describe different
     * filters — "showing 25 of 0" is the classic outcome. Identical on every
     * row of the page; the caller reads it off the first.
     */
    (select count(*) from filtered) as total_count
  from filtered f
  left join public.leader_directory rb on rb.user_id = f.resolved_by
  left join public.leader_directory hb on hb.user_id = f.hidden_by
  order by f.created_at desc, f.id
  /* Bounded regardless of what the caller asks for. */
  limit  greatest(1, least(coalesce(p_limit, 25), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.analytics_feedback_list is
  'A filtered, paginated page of feedback with the turn it is about and the administrator who acted on it. Hidden rows are excluded unless p_include_hidden. total_count is the size of the filtered set and travels on every row so the page and its count cannot disagree.';

-- -------------------------------------------------------- one feedback -----
--
-- THE DETAIL VIEW, and what it deliberately does not return.
--
-- It returns the rating, the comment, the moderation state and the turn's own
-- metadata — surface, topic, when, whether the answer errored. It does NOT
-- return the question or the answer, because neither is stored anywhere in this
-- schema and this function is not the place to start. An administrator
-- investigating a 1-star rating gets the shape of the turn and the user's own
-- account of it, which is what they can act on.

create or replace function public.analytics_feedback_detail(p_id uuid)
returns table (
  id uuid,
  activity_event_id uuid,
  rating smallint,
  got_what_needed public.feedback_outcome,
  comment text,
  status public.feedback_status,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by_name text,
  hidden_at timestamptz,
  hidden_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  occurred_at timestamptz,
  surface public.activity_surface,
  category public.activity_category,
  feature public.activity_feature,
  turn_kind public.activity_turn_kind,
  succeeded boolean,
  latency_ms integer,
  role public.app_user_role,
  display_name text,
  store_name text,
  district_label text,
  client_conversation_id text,
  client_message_id text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    f.id,
    f.activity_event_id,
    f.rating,
    f.got_what_needed,
    f.comment,
    f.status,
    f.resolution_note,
    f.resolved_at,
    rb.display_name,
    f.hidden_at,
    hb.display_name,
    f.created_at,
    f.updated_at,
    f.occurred_at,
    f.surface,
    f.category,
    f.feature,
    f.turn_kind,
    f.succeeded,
    e.latency_ms,
    f.role,
    f.display_name,
    f.store_name,
    f.district_label,
    f.client_conversation_id,
    f.client_message_id
  from public.feedback_attributed f
  join public.activity_events e on e.id = f.activity_event_id
  left join public.leader_directory rb on rb.user_id = f.resolved_by
  left join public.leader_directory hb on hb.user_id = f.hidden_by
  where f.id = p_id;
$$;

comment on function public.analytics_feedback_detail is
  'One feedback item with its turn''s metadata for the detail panel. Returns no question and no answer text: neither is stored in this schema.';

-- ------------------------------------------------------------ surfaces -----

create or replace function public.analytics_surfaces(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (
  surface public.activity_surface,
  events bigint,
  active_users bigint,
  rated bigint,
  average_rating numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select
    e.surface,
    count(*)                        as events,
    count(distinct e.actor_user_id) as active_users,
    count(f.id) filter (where f.hidden_at is null) as rated,
    round(avg(f.rating) filter (where f.hidden_at is null), 1) as average_rating
  from public.activity_events e
  left join public.leader_directory u on u.user_id = e.actor_user_id
  left join public.salon_directory s
    on s.salon_id = coalesce(e.salon_id, u.salon_id)
  left join public.ask_sunny_feedback f on f.activity_event_id = e.id
  where e.occurred_at >= p_from
    and e.occurred_at <  p_to
    /* Null surfaces are pre-tracking history and are not a surface. */
    and e.surface is not null
    and (p_district is null or s.district_label = p_district)
    and (p_salon    is null or coalesce(e.salon_id, u.salon_id) = p_salon)
    and (p_role     is null or coalesce(e.actor_role, u.role)   = p_role)
    and (p_actor    is null or e.actor_user_id  = p_actor)
  group by e.surface
  order by events desc;
$$;

comment on function public.analytics_surfaces is
  'Where Ask Sunny is being used, with the rating each surface earns. Reads activity_events directly rather than activity_unified because only recorded turns have a surface — a filed form did not happen "on" one.';

-- ------------------------------------------------- when it is being used ---
--
-- DAY OF WEEK AND HOUR OF DAY, IN THE BUSINESS TIMEZONE.
--
-- The zone is an argument rather than a constant, supplied by the application
-- from the same `NEXT_PUBLIC_BUSINESS_TIMEZONE` every other date decision
-- reads. Hard-coding 'America/New_York' here would be a second business
-- timezone in a second place, which is exactly the failure `business-date.ts`
-- was written to prevent — two parts of one product disagreeing about what day
-- it is, both internally consistent.
--
-- An unrecognised zone would make `at time zone` raise, so it is validated
-- against `pg_timezone_names` and falls back rather than failing the page.

create or replace function public.analytics_when(
  p_from      timestamptz,
  p_to        timestamptz,
  p_timezone  text    default 'America/New_York',
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (day_of_week integer, hour_of_day integer, events bigint)
language sql
stable
set search_path = public, extensions
as $$
  with zone as (
    select case
      when exists (select 1 from pg_timezone_names where name = p_timezone)
        then p_timezone
      else 'America/New_York'
    end as tz
  ),
  local as (
    select a.occurred_at at time zone (select tz from zone) as local_at
    from public.activity_attributed a
    left join public.salon_directory s on s.salon_id = a.salon_id
    where a.occurred_at >= p_from
      and a.occurred_at <  p_to
      and (p_district is null or s.district_label = p_district)
      and (p_salon    is null or a.salon_id       = p_salon)
      and (p_role     is null or a.role           = p_role)
      and (p_actor    is null or a.actor_user_id  = p_actor)
  )
  select
    extract(dow  from local_at)::integer as day_of_week,
    extract(hour from local_at)::integer as hour_of_day,
    count(*) as events
  from local
  group by 1, 2
  order by 1, 2;
$$;

comment on function public.analytics_when is
  'Activity by day of week (0=Sunday) and hour, in the business timezone the application supplies. An unknown zone falls back to US Eastern rather than raising, so a misconfigured variable cannot take the page down.';

-- --------------------------------------------------------------- topics ----
--
-- WHAT LEADERS ASK ABOUT, with the acknowledgements taken out.
--
-- `turn_kind = 'acknowledgement'` is excluded from the counts, which is the
-- whole reason that column exists: "yes" is the most frequent thing anybody
-- says to an assistant and it is not a topic. Rows recorded before the column
-- shipped have a null kind and are COUNTED — they are real questions whose kind
-- was never assessed, and dropping them would silently shrink history.
--
-- IT READS THE KIND OFF THE UNIFIED VIEW rather than joining back to
-- `activity_events` for it. The obvious join — match on time, feature, category
-- and actor — has no unique key behind it: two questions from one person in the
-- same second about the same topic are one row each in the source and four rows
-- after the join, and the count would be silently wrong in exactly the busy
-- periods this panel exists to describe. The view carries the column instead,
-- so there is nothing to fan out.
--
-- NO EXAMPLE TEXT. The screenshot this panel is modelled on prints a verbatim
-- question beside each topic; this schema has no column one could come from and
-- must not grow one. `last_asked` is what replaces it: a timestamp answers
-- "is this still happening?", which is the question the example was really
-- being read for.

create or replace function public.analytics_topics(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (
  category public.activity_category,
  events bigint,
  active_users bigint,
  acknowledgements bigint,
  last_asked timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  select
    a.category,
    count(*) filter (where a.turn_kind is distinct from 'acknowledgement') as events,
    count(distinct a.actor_user_id) filter (where a.turn_kind is distinct from 'acknowledgement') as active_users,
    count(*) filter (where a.turn_kind = 'acknowledgement') as acknowledgements,
    max(a.occurred_at) filter (where a.turn_kind is distinct from 'acknowledgement') as last_asked
  from public.activity_attributed a
  left join public.salon_directory s on s.salon_id = a.salon_id
  where a.occurred_at >= p_from
    and a.occurred_at <  p_to
    and (p_district is null or s.district_label = p_district)
    and (p_salon    is null or a.salon_id       = p_salon)
    and (p_role     is null or a.role           = p_role)
    and (p_actor    is null or a.actor_user_id  = p_actor)
  group by a.category
  having count(*) filter (where a.turn_kind is distinct from 'acknowledgement') > 0
  order by events desc;
$$;

comment on function public.analytics_topics is
  'Topic counts with acknowledgement turns ("yes", "thanks") excluded and reported separately. last_asked replaces the verbatim example the reference dashboard prints: no question text is stored in this schema.';

-- -------------------------------------------------- extraction accuracy ----
--
-- WHAT IS ACTUALLY KNOWN ABOUT REPORT EXTRACTION, WHICH IS RUNS AND OUTCOMES.
--
-- The reference dashboard shows an average accuracy STAR RATING per extraction
-- engine, collected from managers approving extracted stats in a chat. Ask
-- Sunny has no such flow and no such column: ingestion is machine work behind a
-- credential, and nobody is asked to grade it.
--
-- So this returns the real thing — runs per parser, how many succeeded, how
-- many facts and salons they produced, how many raised warnings — and the
-- screen prints "No data yet" where a rating would go. Returning a fabricated
-- average, or silently relabelling "succeeded" as "accurate", would be the
-- dashboard inventing a quality measure out of a liveness one. A parse can
-- succeed and still read the wrong column.

create or replace function public.analytics_extraction_runs(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  parser_key text,
  runs bigint,
  succeeded bigint,
  failed bigint,
  with_warnings bigint,
  facts bigint,
  salons bigint,
  last_run timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  select
    r.parser_key,
    count(*)                                            as runs,
    count(*) filter (where r.status = 'succeeded')      as succeeded,
    count(*) filter (where r.status = 'failed')         as failed,
    count(*) filter (where cardinality(r.warnings) > 0) as with_warnings,
    coalesce(sum(r.fact_count), 0)                      as facts,
    coalesce(sum(r.salon_count), 0)                     as salons,
    max(r.created_at)                                   as last_run
  from public.report_ingestions r
  where r.created_at >= p_from
    and r.created_at <  p_to
  group by r.parser_key
  order by runs desc, r.parser_key;
$$;

comment on function public.analytics_extraction_runs is
  'Report ingestion runs per parser in a window, with outcomes and volumes. Deliberately returns no accuracy rating: nothing in this product asks a person to grade an extraction, and a success rate is a liveness measure, not an accuracy one.';

-- ------------------------------------------------------------- security ----
--
-- EXECUTE REVOKED FROM THE BROWSER-HELD ROLES, on every function.
--
-- `public` as well as `anon` and `authenticated`, all three, per this project's
-- standing rule: Postgres grants EXECUTE to PUBLIC on creation, and on a
-- Supabase project the default privileges ALSO grant it to `anon` and
-- `authenticated` directly, so revoking `public` alone leaves the door open.
--
-- These functions read named leaders' complaints about the product and the
-- administrator who resolved them. Only the server, holding the secret key,
-- calls them.

revoke all on function public.analytics_feedback_summary(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid, public.activity_surface) from public, anon, authenticated;
revoke all on function public.analytics_feedback_list(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid, public.activity_surface, public.feedback_status, public.feedback_outcome, smallint, boolean, text, integer, integer) from public, anon, authenticated;
revoke all on function public.analytics_feedback_detail(uuid) from public, anon, authenticated;
revoke all on function public.analytics_surfaces(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid) from public, anon, authenticated;
revoke all on function public.analytics_when(timestamptz, timestamptz, text, text, uuid, public.app_user_role, uuid) from public, anon, authenticated;
revoke all on function public.analytics_topics(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid) from public, anon, authenticated;
revoke all on function public.analytics_extraction_runs(timestamptz, timestamptz) from public, anon, authenticated;
