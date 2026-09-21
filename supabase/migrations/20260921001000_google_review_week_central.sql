-- ===========================================================================
-- THE GOOGLE REVIEWS REPORTING WEEK MOVES TO CENTRAL TIME
-- ===========================================================================
--
-- `public.google_review_week_start()` opened the week in `America/New_York`,
-- because it was written to match `BUSINESS_TIMEZONE` — the app-wide business
-- zone used for follow-up due dates and the Overview greeting. That was the
-- right default for a shared concern and the wrong one for this report.
--
-- The weekly Google review count is reconciled by hand against Google's own
-- console by people working Central. A week that opens an hour before their
-- Saturday ends is a week they cannot re-count and get the same answer: a
-- review left at 11:30 p.m. Central on a Saturday is already Sunday in Eastern,
-- so the database filed it into the NEXT week while the person counting filed
-- it into the one they were closing.
--
-- So the zone becomes a property of this report. `BUSINESS_TIMEZONE` is NOT
-- changed and nothing outside Google Reviews is touched by this migration —
-- follow-ups, the Overview and the analytics screens keep US Eastern.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE TO APPLY, AND WHY NOTHING IS BACKFILLED
-- ---------------------------------------------------------------------------
--
-- The week is FROZEN AT INSERT. `google_reviews.first_seen_week` and
-- `google_review_periods.period_start` are written once and are protected by
-- write-once triggers; nothing recomputes them on read. So replacing this
-- function changes what FUTURE reviews are assigned and leaves every existing
-- review exactly where it is — which is the intent. History that has already
-- been counted, reported on and reconciled must not silently re-file itself.
--
-- It is also safe in the narrower Postgres sense. The function is `immutable`,
-- and replacing an immutable function whose results change would corrupt any
-- index or generated column built on it — but nothing builds on this one. It is
-- called only inside the bodies of `ingest_google_reviews` and
-- `google_review_current_period`, at insert time. The verification block below
-- checks that assumption on the live database rather than trusting this note,
-- and refuses the migration if it has stopped being true.
--
-- And on the existing data the two zones happen not to disagree at all: every
-- stored review resolves to the same Sunday under Eastern and Central, because
-- none was first seen in the one-hour window (23:00-23:59 Central on a
-- Saturday) where the two can differ. The block below re-checks that at apply
-- time and reports it, so the claim is measured on whatever data is actually
-- there rather than asserted from an audit taken earlier.
--
-- `src/lib/reviews/timezone.ts` is the TypeScript half. The two MUST agree
-- about the zone; `src/lib/reviews/reporting-week.test.ts` reads THIS FILE as
-- text and asserts they do, so the pair cannot drift silently.

-- ------------------------------------------ nothing may be built on it ----
--
-- A guard, not a formality. If somebody later indexes this function or adds a
-- generated column over it, replacing it becomes a silent corruption rather
-- than a behaviour change, and this migration must stop rather than proceed.

do $$
declare
  v_dependents int;
begin
  select count(*)
    into v_dependents
    from pg_depend d
    join pg_proc p on p.oid = d.refobjid
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'google_review_week_start'
     and d.refclassid = 'pg_proc'::regclass
     and d.classid = 'pg_class'::regclass
     and d.deptype = 'n';

  if v_dependents > 0 then
    raise exception
      'google_review_week_start() now has % index or column dependent(s). Replacing an immutable function under one corrupts it — resolve the dependency before changing the reporting zone.',
      v_dependents;
  end if;
end;
$$;

-- ------------------------------------------------- the zone itself ---------
--
-- ONLY THE DEFAULT CHANGES. The body is character-for-character what it was:
-- the Sunday that opens the US retail week containing the instant, in the zone
-- given. Every caller — `ingest_google_reviews` in both its live and legacy
-- forms, and `google_review_current_period` — invokes it WITHOUT a zone, so
-- they all pick the new default up together and none of them needed editing.
-- `p_zone` stays a parameter so a caller that must ask about a specific zone
-- (the verification below, and the boundary tests) still can.

create or replace function public.google_review_week_start(
  p_at timestamptz,
  p_zone text default 'America/Chicago'
) returns date
language sql
immutable
set search_path = ''
as $$
  select ((p_at at time zone p_zone)::date
          - extract(dow from (p_at at time zone p_zone))::int);
$$;

comment on function public.google_review_week_start(timestamptz, text) is
  'The Sunday that opens the US retail week containing this instant, in the GOOGLE REVIEWS zone (America/Chicago, Central — not the app-wide BUSINESS_TIMEZONE). The reporting period key for a Google review, frozen at insert. Kept in step with src/lib/reviews/timezone.ts by reporting-week.test.ts.';

/*
 * `create or replace` preserves the function's existing ACL, so the original
 * revoke still stands. It is restated because a privilege this migration
 * assumed rather than asserted is one a later reader has to go and verify.
 */
revoke all on function public.google_review_week_start(timestamptz, text)
  from public, anon, authenticated;

-- ------------------------------------------------ what this did to history --
--
-- Measured, not assumed, and reported rather than acted on: this migration
-- does not write to `google_reviews` or `google_review_periods` at all.

do $$
declare
  v_reviews_moved int := 0;
  v_periods_moved int := 0;
begin
  select count(*)
    into v_reviews_moved
    from public.google_reviews r
   where public.google_review_week_start(r.first_seen_at, 'America/New_York')
      is distinct from
         public.google_review_week_start(r.first_seen_at, 'America/Chicago');

  select count(*)
    into v_periods_moved
    from public.google_reviews r
   where r.reporting_period_id is not null
     and (select p.period_start from public.google_review_periods p
           where p.id = r.reporting_period_id)
         is distinct from
         public.google_review_week_start(r.first_seen_at, 'America/Chicago');

  raise notice
    'Google Reviews week zone -> America/Chicago. Reviews whose first-seen week differs between the zones: %. Counted reviews whose frozen period differs from the Central week: % (left untouched by design — a frozen period is history).',
    v_reviews_moved, v_periods_moved;
end;
$$;
