-- ---------------------------------------------------------------------------
-- RATINGS COUNT OPEN FEEDBACK ONLY.
--
-- ASKED FOR DIRECTLY: resolved and dismissed feedback should not count in the
-- ratings. It already left the default queue; now it leaves the figures too.
--
-- ===========================================================================
-- WHAT THIS CHANGES ABOUT WHAT THE NUMBERS MEAN
-- ===========================================================================
--
-- The Conversation Feedback panel stops describing "what leaders said about Ask
-- Sunny in this period" and starts describing "what leaders said that nobody
-- has dealt with yet". Those are different measures and the second is the one
-- asked for, so the screen's wording changes with it — a figure whose meaning
-- moved silently is worse than one that moved.
--
-- The consequence worth stating plainly: the average now moves when an
-- ADMINISTRATOR acts, not only when a leader rates. Resolving a 1-star raises
-- it. That is correct for a backlog measure and wrong for a quality one, and it
-- means this panel can no longer answer "how good were our answers last month"
-- — a fully triaged month reports nothing at all.
--
-- ===========================================================================
-- THE QUEUE DEPTHS ARE DELIBERATELY UNCHANGED
-- ===========================================================================
--
-- `pending`, `in_review`, `resolved`, `dismissed` and `hidden` still count every
-- row. They are a record of work, not of sentiment: "14 resolved" must keep
-- meaning fourteen things were dealt with, or the one number that survives this
-- change loses its meaning too.
--
-- ONE DEFINITION, IN ONE PLACE. `feedback_counts_toward_ratings` is what both
-- functions test, so the headline average and the per-surface averages cannot
-- drift into disagreeing about which rows they describe — which is exactly the
-- kind of inconsistency that makes a dashboard untrusted.
--
-- ADDITIVE: one new function, two replaced in place. No schema change, no data
-- change, nothing dropped.
-- ---------------------------------------------------------------------------

/*
 * WHETHER A RATING COUNTS TOWARD THE FIGURES.
 *
 * Open and not hidden. `immutable` because it reads nothing outside its
 * arguments, which lets Postgres inline it into the filters below rather than
 * calling it per row.
 */
create or replace function public.feedback_counts_toward_ratings(
  p_status    public.feedback_status,
  p_hidden_at timestamptz
)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_hidden_at is null and p_status in ('pending', 'in_review');
$$;

comment on function public.feedback_counts_toward_ratings is
  'Whether one feedback row counts toward the rating figures: open (pending or in_review) and not hidden. The single definition both analytics_feedback_summary and analytics_surfaces test, so the headline average and the per-surface averages describe the same rows.';

revoke all on function public.feedback_counts_toward_ratings(public.feedback_status, timestamptz)
  from public, anon, authenticated;

-- -------------------------------------------------------- the summary ------

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
    /*
     * EVERY RATING FIGURE BELOW COUNTS OPEN, UNHIDDEN FEEDBACK ONLY — see
     * `feedback_counts_toward_ratings`. The queue depths further down count
     * every row, because they describe work rather than sentiment.
     */
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at)) as responses,
    /*
     * NULL RATHER THAN ZERO WHEN NOTHING QUALIFIES. `avg` returns null over an
     * empty set and it is left alone: a panel printing "0.0 stars" for a period
     * whose feedback has all been dealt with is reporting a catastrophe that
     * did not happen. The screen renders "No open feedback" against a null.
     */
    round(avg(f.rating) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at)), 1) as average_rating,
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at) and f.rating = 1) as rating_1,
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at) and f.rating = 2) as rating_2,
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at) and f.rating = 3) as rating_3,
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at) and f.rating = 4) as rating_4,
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at) and f.rating = 5) as rating_5,
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at) and f.got_what_needed = 'yes')       as outcome_yes,
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at) and f.got_what_needed = 'partially') as outcome_partially,
    count(*) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at) and f.got_what_needed = 'no')        as outcome_no,
    /*
     * THE QUEUE DEPTHS COUNT EVERYTHING, hidden rows included. They are the
     * record of what was dealt with: "14 resolved" must keep meaning fourteen
     * things were dealt with, and hiding a complaint is not answering it.
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
  'One row summarising feedback in a window. The rating figures — volume, average, the five-band distribution and the outcome split — count OPEN, unhidden feedback only, so resolved and dismissed ratings leave them; the panel describes outstanding feedback rather than everything said. The four queue depths and the hidden count include every row, because they record work rather than sentiment. average_rating is null when nothing qualifies.';

-- ------------------------------------------------------- the surfaces ------

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
    /*
     * THE SAME DEFINITION THE HEADLINE USES. A per-surface average computed
     * over a different set from the one above it is how two numbers on one page
     * come to disagree, and there is no way for a reader to tell which is
     * describing what.
     */
    count(f.id) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at)) as rated,
    round(avg(f.rating) filter (where public.feedback_counts_toward_ratings(f.status, f.hidden_at)), 1) as average_rating
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
  'Where Ask Sunny is being used, with the rating each surface earns from its OPEN feedback — the same rows the headline average describes, so the two cannot disagree. Reads activity_events directly because only recorded turns have a surface.';

revoke all on function public.analytics_feedback_summary(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid, public.activity_surface) from public, anon, authenticated;
revoke all on function public.analytics_surfaces(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid) from public, anon, authenticated;
