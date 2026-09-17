-- ---------------------------------------------------------------------------
-- THE FEEDBACK QUEUE SHOWS OPEN WORK BY DEFAULT.
--
-- REPORTED: "i want the reviews gone if i resolved them". The queue listed
-- every status, so everything an administrator dealt with stayed on the page
-- wearing a green chip. A work queue that never empties is one people stop
-- opening, and "what is still pending" — the question this page exists to
-- answer — was the one it answered worst.
--
-- NOTHING IS DELETED AND NOTHING STOPS COUNTING. This changes which rows the
-- LIST returns and nothing else: `analytics_feedback_summary` is untouched, so
-- the average, the distribution, the outcome split and all four queue depths
-- still count every rating in the window exactly as they did. A resolved
-- complaint is still a complaint that happened, and the figures still say so.
--
-- WHY A NEW PARAMETER RATHER THAN A PREDICATE ON THE OLD ONE. "Open" is a SET
-- of statuses — pending and in_review — and `p_status` is a single value, so
-- there was no way to express it. `p_statuses` takes an array: null means every
-- status, and the application passes the two open ones by default.
--
-- THE OLD SIGNATURE IS DROPPED, deliberately. `create or replace function`
-- cannot change an argument list: it would leave the old function standing
-- beside the new one as an overload, and a call matching both through defaults
-- would fail with "function is not unique" — at read time, on a live dashboard.
-- One name, one signature.
--
-- ===========================================================================
-- WHICH IS WHY `p_status` SURVIVES ON THE NEW SIGNATURE, UNUSED BY THIS APP
-- ===========================================================================
--
-- Dropping it outright would make this migration and its deploy a coordinated
-- pair: apply first and the code already in production calls a function that no
-- longer exists; deploy first and the new code calls one that does not exist
-- yet. Either order breaks the Feedback tab for the length of a build, over a
-- filter default.
--
-- Keeping the old parameter on the new signature removes the window entirely.
-- The currently deployed code passes `p_status` and gets exactly what it got
-- before; the new code passes `p_statuses` and gets the open queue; neither
-- knows about the other. The migration is therefore safe to apply on its own,
-- before anything is deployed, which is the property that makes it safe at all.
--
-- It is vestigial from the moment the new build ships and should be dropped by
-- a later migration once nothing calls it — deliberately NOT in this one, since
-- the whole point is that this one needs no coordination.
-- ---------------------------------------------------------------------------

drop function if exists public.analytics_feedback_list(
  timestamptz, timestamptz, text, uuid, public.app_user_role, uuid,
  public.activity_surface, public.feedback_status, public.feedback_outcome,
  smallint, boolean, text, integer, integer
);

create or replace function public.analytics_feedback_list(
  p_from      timestamptz,
  p_to        timestamptz,
  p_district  text    default null,
  p_salon     uuid    default null,
  p_role      public.app_user_role default null,
  p_actor     uuid    default null,
  p_surface   public.activity_surface default null,
  /*
   * WHICH STATUSES TO RETURN. Null means every one of them.
   *
   * An array rather than a single value because the default view is a set —
   * pending and in_review, the work that is still somebody's. A caller wanting
   * one status passes an array of one, which keeps a single code path here
   * rather than a value parameter and a set parameter disagreeing about
   * precedence.
   */
  p_statuses  public.feedback_status[] default null,
  /*
   * COMPATIBILITY ONLY — see the header. The build currently in production
   * passes this; nothing in the new build does. Honoured when `p_statuses` is
   * absent so the old caller keeps working unchanged, and ignored the moment a
   * caller supplies the array.
   */
  p_status    public.feedback_status default null,
  p_outcome   public.feedback_outcome default null,
  p_rating    smallint default null,
  p_include_hidden boolean default false,
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
      /*
       * `cardinality` rather than `p_statuses is null` alone, so an empty array
       * is treated as "no filter" too. A caller that builds the list from a UI
       * and ends up with none selected gets everything rather than nothing —
       * an empty queue that looks identical to a finished one is the worse
       * failure of the two.
       */
      and (
        case
          /*
           * The array wins where it is given. An EMPTY array is "no filter"
           * rather than "nothing": a caller that builds the list from a UI and
           * ends up with none selected should see everything, because an empty
           * queue that looks identical to a finished one is the worse failure.
           */
          when p_statuses is not null and cardinality(p_statuses) > 0
            then f.status = any (p_statuses)
          /* Otherwise the deprecated single value, if the caller sent one. */
          when p_statuses is null and p_status is not null
            then f.status = p_status
          else true
        end
      )
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
     * THE TOTAL TRAVELS WITH THE PAGE, so the count and the rows cannot
     * describe different filters — "showing 25 of 0" is the classic outcome of
     * computing them separately.
     */
    (select count(*) from filtered) as total_count
  from filtered f
  left join public.leader_directory rb on rb.user_id = f.resolved_by
  left join public.leader_directory hb on hb.user_id = f.hidden_by
  order by f.created_at desc, f.id
  limit  greatest(1, least(coalesce(p_limit, 25), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.analytics_feedback_list is
  'A filtered, paginated page of feedback with the turn it is about and the administrator who acted on it. p_statuses selects which statuses to return and null means all of them; the application passes the open ones by default so the queue shows work rather than history. Hidden rows are excluded unless p_include_hidden. total_count is the size of the filtered set and travels on every row.';

/*
 * EXECUTE REVOKED FROM THE BROWSER-HELD ROLES, on the new signature.
 *
 * The drop above took the old function's grants with it, so this is not
 * belt-and-braces — without it the recreated function would carry Postgres's
 * default EXECUTE to PUBLIC, and on a Supabase project to `anon` and
 * `authenticated` as well. This function reads named leaders' complaints.
 */
revoke all on function public.analytics_feedback_list(timestamptz, timestamptz, text, uuid, public.app_user_role, uuid, public.activity_surface, public.feedback_status[], public.feedback_status, public.feedback_outcome, smallint, boolean, text, integer, integer) from public, anon, authenticated;
