-- ---------------------------------------------------------------------------
-- RATING IS VOLUNTARY, SO THE WORDS BESIDE IT ARE OPTIONAL
--
-- WHAT CHANGED ABOVE THIS LAYER. Ask Sunny used to ask for a rating after every
-- answer and hold the next question until one arrived — a gate that, in the
-- Forms flow, stopped a manager mid-task: "Which form do you need?" is an
-- answer, so the cards under it and the composer beside it were both held until
-- somebody rated the question they had just been asked. Rating is now one
-- passive "Rate this conversation" action that nothing waits on.
--
-- WHY THAT MAKES THESE TWO COLUMNS WRONG AS THEY STAND. `got_what_needed` and
-- `comment` were `not null`, and the comment additionally had to be non-empty.
-- That was the right trade while every answer demanded a rating: if somebody
-- must fill the form in, make the form worth having, because a 1-star with no
-- words is a dead end. It is the wrong trade for a voluntary control — a
-- required field on a form nobody has to open is not a richer record, it is the
-- reason the form gets abandoned and the record is nothing at all.
--
-- WHAT IS NOT BEING DONE, and it is the tempting alternative: defaulting the
-- outcome to 'yes', or storing an empty string for the comment. Both would put
-- opinions nobody expressed into the same averages the dashboard reports as
-- what leaders said. Absent has to read as absent.
--
-- ===========================================================================
-- EVERY EXISTING ROW IS UNTOUCHED, AND EVERY READER ALREADY COPES
-- ===========================================================================
--
-- Relaxing a constraint cannot invalidate a row that satisfied the stricter
-- one, so nothing here rewrites data and nothing needs backfilling.
--
-- The analytics functions were already written in a shape that handles a null:
--
--   `analytics_feedback_summary` counts outcomes with
--   `count(*) filter (where ... f.got_what_needed = 'yes')` and friends, so a
--   null is counted under none of the three while still counting as a response
--   and still moving `avg(rating)`. That is the correct reading: somebody
--   rated, and did not answer that question.
--
--   `analytics_feedback_list` filters on `p_outcome is null or
--   f.got_what_needed = p_outcome`, so the unfiltered view returns these rows
--   and filtering BY an outcome excludes them, which is what an administrator
--   asking "show me the 'no' answers" means.
--
--   The comment search uses `f.comment ilike '%...%'`, which is null-safe in
--   the direction that matters: a row with no comment never matches a search
--   for text, and the `p_search is null` branch still returns it.
--
-- ADDITIVE AND REVERSIBLE: two `drop not null`s and one check constraint
-- replaced by a looser one. No column is dropped, no data is rewritten, and the
-- 2000-character bound — the one that stops somebody pasting a report into the
-- box — is kept exactly as it was.
-- ---------------------------------------------------------------------------

alter table public.ask_sunny_feedback
  alter column got_what_needed drop not null;

alter table public.ask_sunny_feedback
  alter column comment drop not null;

-- THE BOUND SURVIVES; THE FLOOR DOES NOT.
--
-- The original constraint said `length(btrim(comment)) > 0 and length(comment)
-- <= 2000`. Only the first half is being given up. A null comment is "said
-- nothing", which is now allowed; an empty string is a different thing arriving
-- by accident, and the application writes null rather than '' precisely so the
-- two are never confused. The check still refuses the empty string so that a
-- future caller cannot introduce a third state that means the same as null.
--
-- DROPPED BY WHAT IT SAYS, NOT BY WHAT IT IS CALLED. `ask_sunny_feedback_comment_check`
-- is the name Postgres generates for a column-level check, and a `drop
-- constraint if exists` naming it would SILENTLY DO NOTHING against a project
-- where it had been named anything else — leaving the old floor in place while
-- this migration reported success, and every wordless rating failing at the
-- boundary. So the constraint is found by its definition.
do $$
declare
  victim text;
begin
  for victim in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'ask_sunny_feedback'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%btrim(comment)%'
  loop
    execute format('alter table public.ask_sunny_feedback drop constraint %I', victim);
  end loop;
end
$$;

alter table public.ask_sunny_feedback
  add constraint ask_sunny_feedback_comment_check
  check (
    comment is null
    or (length(btrim(comment)) > 0 and length(comment) <= 2000)
  );

comment on column public.ask_sunny_feedback.got_what_needed is
  'Optional. Null when the person rated the conversation and did not answer this question — counted as a response, counted under none of the three outcomes.';

comment on column public.ask_sunny_feedback.comment is
  'Optional free text, bounded to 2000 characters. Null when the person rated and wrote nothing; never an empty string.';
