-- ---------------------------------------------------------------------------
-- ADOPTION ANALYTICS — the read side. Directories, one attributed view, and
-- five grouped functions.
--
-- EVERY AGGREGATE IS COMPUTED IN THE DATABASE. The dashboard asks five
-- questions and receives five small answers; it never receives rows to add up.
-- That is a requirement rather than a preference — "how many forms did each of
-- fifteen salons file" must not become fifteen thousand rows crossing the wire
-- so a browser can count them.
--
-- ADDITIVE ONLY: three views and five functions, all new.
-- ---------------------------------------------------------------------------

-- -------------------------------------------------- the salon directory ----
--
-- WHICH DISTRICT A SALON IS IN, as one row per salon.
--
-- District is not a column on `salons`. It arrives as `district_label` on
-- `salon_period_attributes`, which is stated PER REPORTING PERIOD — a salon can
-- carry a different label in March and in September, and both rows are kept
-- because both were true. A dashboard filter needs one answer, so this takes
-- the most recent non-superseded one and nothing else invents a district.
--
-- A salon that reporting has never described keeps a null district rather than
-- a placeholder: "no district on record" is a fact, and "Unassigned" would be a
-- category somebody would eventually try to manage.

create or replace view public.salon_directory
with (security_invoker = true) as
select distinct on (s.id)
  s.id            as salon_id,
  s.salon_number,
  s.store_name,
  a.district_label,
  a.region_label
from public.salons s
left join public.salon_period_attributes a
  on a.salon_id = s.id
 and a.superseded_by_ingestion_id is null
left join public.report_periods p on p.id = a.period_id
order by s.id, p.period_end desc nulls last;

comment on view public.salon_directory is
  'One row per salon with its current district and region, taken from the most recent non-superseded salon_period_attributes row. The authoritative salon list for analytics, including salons with no activity at all.';

-- ------------------------------------------------- the leader directory ----
--
-- WHO A PERSON IS, AND WHICH SALON THEY BELONG TO — from the account, never
-- from anything they typed.
--
-- `app_users.scope_primary_area_id` holds `loc-<salon_number>`, which is the
-- application's own authoritative account-to-location relationship. It is the
-- only thing joined on here. A District Manager covering several salons has one
-- primary area and keeps their personal usage attributed to it, exactly as
-- asked; the wider coverage stays available in `scope_also_covers_area_ids` for
-- a filter that wants it, and is deliberately not used to duplicate one
-- person's activity across every salon they cover.

create or replace view public.leader_directory
with (security_invoker = true) as
select
  u.id                     as user_id,
  u.display_name,
  u.email,
  u.role,
  u.status,
  u.scope_level,
  u.scope_primary_area_id,
  u.created_at             as joined_at,
  s.id                     as salon_id,
  s.store_name,
  d.district_label
from public.app_users u
left join public.salons s
  on u.scope_primary_area_id is not null
 and s.salon_number = regexp_replace(u.scope_primary_area_id, '^loc-', '')
left join public.salon_directory d on d.salon_id = s.id;

comment on view public.leader_directory is
  'Every application user with their role, status and primary salon resolved from scope_primary_area_id. The authoritative user roster for analytics, including people who have never used the product.';

-- ------------------------------------------------ attribution, once --------
--
-- THE ONE PLACE AN EVENT IS GIVEN A SALON AND A ROLE, so every panel agrees.
--
-- SALON. An event's own `salon_id` wins where it has one — a form filed against
-- a named location is about that location. Where it has none, the event falls
-- back to THE ACTOR'S OWN SALON from their account. That fallback is doing most
-- of the work and it is the authoritative relationship rather than a guess:
-- fewer than half of the filed forms name a location, and a chat question never
-- will, so without it "usage by salon" would describe a small and arbitrary
-- subset of the estate.
--
-- ROLE. The role recorded at the time wins; the account's current role is the
-- fallback for the rows that come from tables which never recorded one. So a
-- promotion does not rewrite history where history was recorded, and the rows
-- that never knew still get an answer.

create or replace view public.activity_attributed
with (security_invoker = true) as
select
  e.occurred_at,
  e.actor_user_id,
  coalesce(e.actor_role, u.role)   as role,
  e.feature,
  e.category,
  coalesce(e.salon_id, u.salon_id) as salon_id,
  e.succeeded
from public.activity_unified e
left join public.leader_directory u on u.user_id = e.actor_user_id;

comment on view public.activity_attributed is
  'activity_unified with a salon and a role resolved for every row: the event''s own salon where it names one, otherwise the actor''s salon from their account. The single source every analytics function reads.';

revoke all on public.salon_directory      from anon, authenticated;
revoke all on public.leader_directory     from anon, authenticated;
revoke all on public.activity_attributed  from anon, authenticated;

-- ------------------------------------------------------ the aggregates -----
--
-- All five take the same filter signature, so a filter added to the dashboard
-- is added once to each function rather than reasoned about five different
-- ways. Every parameter is nullable and null means "do not filter by this".
--
-- `search_path` is pinned on each, per this project's existing rule: an
-- unpinned function resolves names against whatever the caller's path happens
-- to be, which is how a trojan table in another schema gets read instead.

create or replace function public.analytics_totals(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (
  events        bigint,
  active_users  bigint,
  active_salons bigint,
  forms         bigint,
  documents     bigint,
  reports       bigint,
  chat_events   bigint,
  failures      bigint
)
language sql
stable
set search_path = public, extensions
as $$
  select
    count(*)                                                     as events,
    count(distinct a.actor_user_id)                              as active_users,
    count(distinct a.salon_id)                                   as active_salons,
    count(*) filter (where a.feature = 'forms')                  as forms,
    count(*) filter (where a.category = 'document_upload')       as documents,
    count(*) filter (where a.feature = 'reports')                as reports,
    count(*) filter (where a.feature = 'chat')                   as chat_events,
    count(*) filter (where not a.succeeded)                      as failures
  from public.activity_attributed a
  left join public.salon_directory s on s.salon_id = a.salon_id
  where a.occurred_at >= p_from
    and a.occurred_at <  p_to
    and (p_district is null or s.district_label = p_district)
    and (p_salon    is null or a.salon_id       = p_salon)
    and (p_role     is null or a.role           = p_role)
    and (p_actor    is null or a.actor_user_id  = p_actor);
$$;

comment on function public.analytics_totals is
  'One row of headline figures for a window. active_users and active_salons count DISTINCT values and ignore nulls, so unattributed activity raises the event count without inflating either.';

create or replace function public.analytics_trend(
  p_from      timestamptz,
  p_to        timestamptz,
  p_bucket    text    default 'day',
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (bucket_start date, events bigint, active_users bigint)
language sql
stable
set search_path = public, extensions
as $$
  /*
   * The bucket is whitelisted rather than interpolated: `date_trunc` takes a
   * text unit, and passing a caller's string straight through is how a filter
   * control becomes an injection point. Anything unrecognised falls to 'day'.
   */
  select
    date_trunc(
      case when p_bucket in ('day', 'week', 'month') then p_bucket else 'day' end,
      a.occurred_at
    )::date as bucket_start,
    count(*) as events,
    count(distinct a.actor_user_id) as active_users
  from public.activity_attributed a
  left join public.salon_directory s on s.salon_id = a.salon_id
  where a.occurred_at >= p_from
    and a.occurred_at <  p_to
    and (p_district is null or s.district_label = p_district)
    and (p_salon    is null or a.salon_id       = p_salon)
    and (p_role     is null or a.role           = p_role)
    and (p_actor    is null or a.actor_user_id  = p_actor)
  group by 1
  order by 1;
$$;

comment on function public.analytics_trend is
  'Events per day, week or month across the window. Returns only buckets that have activity; a gap is an absence of events and the caller fills the calendar.';

create or replace function public.analytics_breakdown(
  p_dimension text,
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (key text, events bigint, active_users bigint, active_salons bigint)
language sql
stable
set search_path = public, extensions
as $$
  /*
   * ONE FUNCTION FOR THE THREE SPLITS that differ only in which column they
   * group by — role, category and feature. Three near-identical functions would
   * be three places for a filter to fall out of step.
   */
  select
    case p_dimension
      when 'role'     then a.role::text
      when 'feature'  then a.feature::text
      else                 a.category::text
    end as key,
    count(*) as events,
    count(distinct a.actor_user_id) as active_users,
    count(distinct a.salon_id) as active_salons
  from public.activity_attributed a
  left join public.salon_directory s on s.salon_id = a.salon_id
  where a.occurred_at >= p_from
    and a.occurred_at <  p_to
    and (p_district is null or s.district_label = p_district)
    and (p_salon    is null or a.salon_id       = p_salon)
    and (p_role     is null or a.role           = p_role)
    and (p_actor    is null or a.actor_user_id  = p_actor)
  group by 1
  having case p_dimension
      when 'role'     then a.role::text
      when 'feature'  then a.feature::text
      else                 a.category::text
    end is not null
  order by events desc;
$$;

comment on function public.analytics_breakdown is
  'Usage split by role, category or feature. The dimension is matched against a fixed set; anything else groups by category.';

create or replace function public.analytics_leaders(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (
  user_id       uuid,
  display_name  text,
  role          public.app_user_role,
  status        public.app_user_status,
  salon_id      uuid,
  store_name    text,
  district_label text,
  events        bigint,
  forms         bigint,
  documents     bigint,
  chat_events   bigint,
  top_category  text,
  last_active   timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  /*
   * EVERY LEADER, INCLUDING THE ONES WITH NOTHING.
   *
   * A LEFT JOIN from the directory, not an aggregate over events: a person who
   * has never opened Ask Sunny produces no event rows, so an inner join would
   * silently drop exactly the people this dashboard exists to surface. They come
   * back with zeros and a null last_active.
   */
  with scoped as (
    select a.*
    from public.activity_attributed a
    left join public.salon_directory s on s.salon_id = a.salon_id
    where a.occurred_at >= p_from
      and a.occurred_at <  p_to
      and (p_district is null or s.district_label = p_district)
      and (p_salon    is null or a.salon_id       = p_salon)
  )
  select
    l.user_id,
    l.display_name,
    l.role,
    l.status,
    l.salon_id,
    l.store_name,
    l.district_label,
    count(e.occurred_at)                                      as events,
    count(e.occurred_at) filter (where e.feature = 'forms')    as forms,
    count(e.occurred_at) filter (where e.category = 'document_upload') as documents,
    count(e.occurred_at) filter (where e.feature = 'chat')     as chat_events,
    (
      select x.category::text
      from scoped x
      where x.actor_user_id = l.user_id
      group by x.category
      order by count(*) desc, x.category::text
      limit 1
    ) as top_category,
    max(e.occurred_at) as last_active
  from public.leader_directory l
  left join scoped e on e.actor_user_id = l.user_id
  where (p_district is null or l.district_label = p_district)
    and (p_salon    is null or l.salon_id       = p_salon)
    and (p_role     is null or l.role           = p_role)
    and (p_actor    is null or l.user_id        = p_actor)
  group by l.user_id, l.display_name, l.role, l.status,
           l.salon_id, l.store_name, l.district_label
  order by events desc, l.display_name;
$$;

comment on function public.analytics_leaders is
  'Per-leader adoption for the window, LEFT JOINed from the user directory so leaders with no activity are returned with zeros — the rows an adoption push actually needs.';

create or replace function public.analytics_locations(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null
)
returns table (
  salon_id       uuid,
  salon_number   text,
  store_name     text,
  district_label text,
  events         bigint,
  active_leaders bigint,
  assigned_leaders bigint,
  forms          bigint,
  reports        bigint,
  top_category   text,
  last_active    timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  /*
   * EVERY SALON, INCLUDING THE SILENT ONES — the same argument as the leader
   * function, and the reason this reads from `salon_directory` rather than from
   * the events. "NE Kearney has filed nothing this month" is the row management
   * came here for, and it exists only in the directory.
   */
  with scoped as (
    select a.*
    from public.activity_attributed a
    where a.occurred_at >= p_from
      and a.occurred_at <  p_to
      and (p_role  is null or a.role          = p_role)
      and (p_actor is null or a.actor_user_id = p_actor)
  )
  select
    d.salon_id,
    d.salon_number,
    d.store_name,
    d.district_label,
    count(e.occurred_at)                                    as events,
    count(distinct e.actor_user_id)                         as active_leaders,
    (
      select count(*) from public.leader_directory l
      where l.salon_id = d.salon_id
        and (p_role is null or l.role = p_role)
    )                                                       as assigned_leaders,
    count(e.occurred_at) filter (where e.feature = 'forms')  as forms,
    count(e.occurred_at) filter (where e.feature = 'reports') as reports,
    (
      select x.category::text
      from scoped x
      where x.salon_id = d.salon_id
      group by x.category
      order by count(*) desc, x.category::text
      limit 1
    ) as top_category,
    max(e.occurred_at) as last_active
  from public.salon_directory d
  left join scoped e on e.salon_id = d.salon_id
  where (p_district is null or d.district_label = p_district)
    and (p_salon    is null or d.salon_id       = p_salon)
  group by d.salon_id, d.salon_number, d.store_name, d.district_label
  order by events desc, d.store_name;
$$;

comment on function public.analytics_locations is
  'Per-salon adoption for the window, LEFT JOINed from the salon directory so salons with no activity are returned with zeros. assigned_leaders is the roster count, which is what makes "active leaders" readable as a fraction.';

/*
 * EXECUTE IS REVOKED FROM THE BROWSER-HELD ROLES.
 *
 * These functions answer "which named leader has used the product least", which
 * is management information. Only the server, holding the secret key, calls
 * them — the same posture as the tables they read.
 */
revoke all on function public.analytics_totals(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid)    from anon, authenticated;
revoke all on function public.analytics_trend(timestamptz, timestamptz, text, text, uuid, public.app_user_role, uuid) from anon, authenticated;
revoke all on function public.analytics_breakdown(text, timestamptz, timestamptz, text, uuid, public.app_user_role, uuid) from anon, authenticated;
revoke all on function public.analytics_leaders(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid)   from anon, authenticated;
revoke all on function public.analytics_locations(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid) from anon, authenticated;
