-- ===========================================================================
-- A SEARCH THAT NEVER CAME BACK MUST NOT LEAVE FIFTEEN LISTINGS SAYING
-- "SEARCHING" FOREVER
-- ===========================================================================
--
-- A discovery run marks every listing it covers as `searching` BEFORE it starts,
-- so the review table shows work in progress rather than the previous run's
-- answer presented as if it were current. That is right.
--
-- What was missing is the other half. When the Actor run ends as ABORTED,
-- TIMED-OUT or FAILED, the run is recorded as failed and the listings are left
-- exactly where they were put: `searching`. Nothing ever moves them back.
--
-- The consequence is worse than a stale label:
--
--   THE TABLE LIES. Fifteen rows read "Searching" with no run anywhere.
--
--   THE RECOVERY IS BLOCKED. A rediscovery searches what is unresolved —
--   never searched, ambiguous, not found. A listing stuck in `searching` is in
--   none of those, so the button that exists to retry the failure is offered
--   zero listings and does nothing. The one action that would fix the problem
--   is the one the problem disables.
--
-- This happened: a discovery run on 2026-09-19 ended ABORTED and left all
-- fifteen listings stranded.
--
-- ===========================================================================
-- WHY CLEARING EVERY `searching` ROW IS SAFE
-- ===========================================================================
--
-- `google_review_apify_runs` carries a partial unique index over the live run,
-- so AT MOST ONE RUN EXISTS AT A TIME. A row sitting in `searching` therefore
-- belongs to the run that just ended — there is no second run whose listings
-- this could be stealing. That is what lets this take no arguments and stay
-- correct: it does not need to know which listings a failed run covered,
-- because every `searching` row is one of them.
--
-- IT TOUCHES NOTHING BUT THAT ONE COLUMN, and only rows in that one state. A
-- listing that got as far as `candidate_found`, `ambiguous`, `not_found` or
-- `profile_issue` has an ANSWER, and an answer survives a later run failing.

create or replace function public.google_review_apify_clear_searching()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_cleared integer;
begin
  update public.google_review_locations
     set discovery_status = 'not_searched'
   where discovery_status = 'searching';

  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

comment on function public.google_review_apify_clear_searching() is
  'Returns every listing stranded in `searching` to `not_searched` after a discovery run ended without reporting. Safe with no arguments because the run ledger permits only one live run, so every `searching` row belongs to the run that just ended. Touches only discovery_status, and only rows in that state: a listing that reached an answer keeps it.';

revoke all on function public.google_review_apify_clear_searching() from anon, authenticated;

/*
 * THE FIFTEEN STRANDED BY THE ABORTED RUN, released here as part of the fix.
 * Idempotent: on a database where nothing is stuck this updates no row.
 */
select public.google_review_apify_clear_searching();
