-- ---------------------------------------------------------------------------
-- ASK SUNNY FEEDBACK — a rating on the ANSWER, not on the conversation.
--
-- WHY THE ANSWER AND NOT THE CONVERSATION. A thread is a dozen turns across two
-- surfaces; "that conversation was a 2" says nothing anybody can act on. A
-- rating against one answer says WHICH answer, on WHICH screen, about WHICH
-- topic — which is the difference between "Sunny is weak on policy" and "the
-- Spa Engagement bar returns the wrong measure when the question names a
-- district". So the grain here is one turn, and every panel that aggregates
-- upward is computing a summary of that grain rather than storing a coarser one.
--
-- ===========================================================================
-- WHAT A TURN IS, GIVEN THAT CHAT IS STATELESS
-- ===========================================================================
--
-- There is no conversation table and no message table in this schema, and that
-- is not an oversight: `/api/chat` answers and forgets, and conversations live
-- in the browser's IndexedDB with client-minted ids. Those ids are useful for
-- support — they are what a manager's own history is keyed by — and they are
-- worth nothing as an authorization subject, because the browser chose them.
--
--   SO FEEDBACK IS KEYED TO `activity_events.id`. The server already writes one
--   row per answered turn carrying the actor, the role at the time, the salon
--   and whether it succeeded. Minting that id before the insert and returning
--   it with the answer turns it into the turn's server-side name — a thing the
--   caller received but did not choose.
--
-- That is what makes "you may not rate somebody else's answer" a real check
-- (`activity_events.actor_user_id = the session's user`) rather than a hope,
-- and it is why the feedback row needs no copy of the role or the salon: they
-- are one join away and they are already correct.
--
-- The browser's own ids are kept as OPAQUE TEXT beside it, so a complaint can
-- be traced back to the thread the person was actually reading. They are
-- deliberately not unique, not foreign keys, and never consulted for access.
--
-- ===========================================================================
-- WHAT THIS TABLE STORES THAT `activity_events` REFUSES TO
-- ===========================================================================
--
-- A COMMENT, IN THE USER'S OWN WORDS. `activity_events` has no column for text
-- and must not grow one — it records that a question was asked, never what was
-- asked, because managers ask Ask Sunny about named employees' attendance and
-- performance.
--
-- A comment is the opposite case and the distinction is worth stating so the
-- two are never conflated. The question is HR content captured incidentally;
-- the comment is a sentence somebody typed into a box labelled "what worked,
-- what was missing, or what should Sunny improve", knowing an administrator
-- would read it. It is volunteered feedback about the product.
--
-- It is still bounded (2000 characters) and it is still moderatable, because
-- people paste things into free-text boxes.
--
-- ADDITIVE ONLY: three enums, two columns on an existing table, one new table.
-- Nothing existing is altered, rewritten or dropped.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------- surfaces ----
--
-- WHERE ASK SUNNY WAS USED, as an enum for the reason every other vocabulary
-- here is one: a typo becomes a rejected write rather than a surface that
-- silently counts as nothing.
--
-- The members are the surfaces that exist, named after the routes they live on
-- rather than after the components that draw them — a component can be renamed
-- or extracted without rewriting history. `main_chat` and `overview` are the
-- two general ones; the five report families match `report_families.ts`
-- exactly; `google_reviews` is the reviews screen's bar.
--
-- `unknown` is the honest default for a turn whose caller did not say. It is
-- NOT a catch-all to route new surfaces into: a surface added later adds a
-- member here, and until it does its turns are visibly unattributed rather
-- than quietly filed under something plausible.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_surface') then
    create type public.activity_surface as enum (
      'main_chat',
      'overview',
      'salon_performance',
      'sales_totals',
      'bed_usage',
      'spa_wellness',
      'spa_engagement',
      'google_reviews',
      'unknown'
    );
  end if;
end
$$;

-- ----------------------------------------------------------- turn kinds ----
--
-- WHETHER THE TURN CARRIED A QUESTION OR ONLY AN ACKNOWLEDGEMENT.
--
-- THE PROBLEM THIS SOLVES, stated plainly because the fix looks like a detail
-- and is not: in a conversational assistant the single most common "question"
-- is "yes". Then "yes please", then "thank you". Counting those as inquiries
-- puts a content-free turn at the top of every topic ranking and pushes the
-- thing leaders actually needed down the page — a dashboard reporting on the
-- shape of dialogue rather than on the business.
--
-- CLASSIFIED IN MEMORY, STORED AS ONE ENUM VALUE. The text is matched against a
-- fixed table inside the request handler and discarded when it returns. This
-- column says WHICH KIND of turn it was; it does not say, and cannot say, what
-- the turn contained. The privacy guarantee in `activity_events` is unchanged:
-- there is still nowhere for text to go.
--
-- An acknowledgement is still a recorded event and still counts as usage —
-- somebody was using the product. It is excluded from the topic breakdowns,
-- which is a different question from "was there activity".

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_turn_kind') then
    create type public.activity_turn_kind as enum (
      /* A real question, which is what the topic panels count. */
      'question',
      /* "yes", "thanks", "today" — a continuation, not an inquiry. */
      'acknowledgement',
      /* Not a chat turn at all: an upload, an ingestion, a video play. */
      'not_applicable'
    );
  end if;
end
$$;

-- -------------------------------------------- the two new event columns ----
--
-- NULLABLE WITH NO BACKFILL, and that is deliberate rather than lazy.
--
-- Every event written before this migration happened on a surface nobody
-- recorded. Defaulting them to `main_chat` would manufacture a fact — the
-- Overview band and the five report bars existed and were used, and filing
-- their history under the chat tab would make the first "where is Ask Sunny
-- used?" chart confidently wrong. A null reads as "not recorded", and the
-- dashboard says so.

alter table public.activity_events
  add column if not exists surface public.activity_surface;

alter table public.activity_events
  add column if not exists turn_kind public.activity_turn_kind;

comment on column public.activity_events.surface is
  'Where in the application the act happened. Null on events recorded before surface tracking shipped — read as "not recorded", never defaulted to a surface that would invent history.';

comment on column public.activity_events.turn_kind is
  'Whether a chat turn carried a question or only an acknowledgement ("yes", "thanks"). Classified in memory from the text, which is then discarded; this column holds the classification and never the words. Null on events recorded before it shipped.';

/* "Where are people using Ask Sunny", over a window. */
create index if not exists activity_events_surface
  on public.activity_events (surface, occurred_at desc);

-- --------------------------------------- the two views carry them too ------
--
-- APPENDED TO THE END OF BOTH VIEWS, which is the one shape `create or replace
-- view` permits: existing columns keep their names, types and positions, so
-- every query already written against these views is untouched.
--
-- WHY THE VIEWS AND NOT A JOIN AT READ TIME. `analytics_topics` needs the turn
-- kind in order to leave acknowledgements out of a topic count, and
-- `activity_attributed` is the only thing it reads. The obvious alternative —
-- join back to `activity_events` on time, feature, category and actor — has no
-- unique key behind it: two questions from one person in the same second about
-- the same topic are one row each in the source and four after the join. The
-- count would be silently wrong in exactly the busy periods the panel exists to
-- describe, which is the worst kind of wrong to ship.
--
-- The three branches that are not chat supply `not_applicable` and a null
-- surface, because a filed form, an uploaded document and an ingested workbook
-- did not happen "on" an Ask Sunny surface and are not turns. Saying so
-- explicitly is better than a null that has to be interpreted.

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
    true as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.form_instances i
  join public.form_templates t on t.id = i.template_id
  left join public.salons s
    on i.location_id is not null
   and s.salon_number = regexp_replace(i.location_id, '^loc-', '')
  where t.key in ('coaching', 'follow-up-coaching', 'dpoa', 'policy-review')
     or t.key like '%epp%'
     or t.category = 'hiring'

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
    r.status = 'succeeded' as succeeded,
    null::public.activity_surface as surface,
    'not_applicable'::public.activity_turn_kind as turn_kind
  from public.report_ingestions r;

comment on view public.activity_unified is
  'Every recorded act in one shape: the activity_events table for what leaves no other trace, plus form_instances, knowledge_documents and report_ingestions read where they already live. Carries the surface and turn kind for recorded turns; the other three branches are not turns and say so. security_invoker, so it grants nothing the underlying policies refuse.';

create or replace view public.activity_attributed
with (security_invoker = true) as
select
  e.occurred_at,
  e.actor_user_id,
  coalesce(e.actor_role, u.role)   as role,
  e.feature,
  e.category,
  coalesce(e.salon_id, u.salon_id) as salon_id,
  e.succeeded,
  e.surface,
  e.turn_kind
from public.activity_unified e
left join public.leader_directory u on u.user_id = e.actor_user_id;

comment on view public.activity_attributed is
  'activity_unified with a salon and a role resolved for every row: the event''s own salon where it names one, otherwise the actor''s salon from their account. The single source every analytics function reads.';

revoke all on public.activity_unified     from anon, authenticated;
revoke all on public.activity_attributed  from anon, authenticated;

-- --------------------------------------------------------- the feedback ----

do $$
begin
  if not exists (select 1 from pg_type where typname = 'feedback_status') then
    create type public.feedback_status as enum (
      'pending',
      'in_review',
      'resolved',
      'dismissed'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'feedback_outcome') then
    /*
     * "Did you get what you needed?" — three answers, not two.
     *
     * `partially` is the one that earns its place: an answer that was right but
     * incomplete is the most common real failure and the most fixable, and a
     * yes/no control forces it into whichever neighbour the person is feeling
     * charitable about. Two of those readings are wrong and neither is
     * recoverable afterwards.
     */
    create type public.feedback_outcome as enum (
      'yes',
      'partially',
      'no'
    );
  end if;
end
$$;

create table if not exists public.ask_sunny_feedback (
  id uuid primary key default extensions.gen_random_uuid(),

  /*
   * THE TURN THIS IS ABOUT.
   *
   * `on delete cascade`: feedback about an answer that no longer exists as an
   * event is unattributable — it cannot be joined to a role, a salon, a surface
   * or a topic, so every panel here would silently drop it anyway. This is the
   * one place a cascade is right, and it is scoped to a row the application
   * itself wrote moments earlier.
   *
   * NOT NULL. There is no such thing as feedback about no particular answer;
   * the whole design rests on the grain being one turn.
   */
  activity_event_id uuid not null
    references public.activity_events (id) on delete cascade,

  /*
   * WHO IS SPEAKING.
   *
   * `on delete set null` rather than cascade, opposite to the line above and
   * for a reason worth keeping: an administrator resolving a complaint is
   * acting on the complaint, and deleting the person's account must not delete
   * the record that Ask Sunny got something wrong. The attribution is what is
   * lost; the finding survives.
   */
  user_id uuid references auth.users (id) on delete set null,

  /*
   * THE RATING. 1-5, constrained rather than trusted — this arrives from a
   * browser, and a check constraint is the last place a 0 or a 7 can be
   * stopped before it starts moving an average nobody can explain.
   */
  rating smallint not null check (rating between 1 and 5),

  got_what_needed public.feedback_outcome not null,

  /*
   * THE COMMENT. Required by the product, bounded by the column.
   *
   * 2000 characters is long enough for somebody to describe what went wrong
   * with an example, and short enough that a paste of an entire report into
   * the box is refused at the boundary rather than stored.
   */
  comment text not null
    check (length(btrim(comment)) > 0 and length(comment) <= 2000),

  /*
   * THE BROWSER'S OWN IDS, for tracing a complaint back to the thread the
   * person was reading. Opaque, not unique, not joined, never consulted for
   * access — see the header.
   */
  client_conversation_id text check (client_conversation_id is null or length(client_conversation_id) <= 128),
  client_message_id      text check (client_message_id is null or length(client_message_id) <= 128),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* ----------------------------------------------------- moderation ---- */

  status public.feedback_status not null default 'pending',

  /*
   * WHY IT WAS RESOLVED OR DISMISSED — an internal note, never shown to the
   * person who left the feedback. Bounded for the same reason the comment is.
   */
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,

  /*
   * HIDING IS A SOFT DELETE, AND THERE IS NO HARD ONE.
   *
   * An administrator needs to be able to take an abusive or mistakenly-pasted
   * comment out of the feedback list. They must not be able to make it as if
   * nobody ever complained — which is what a DELETE would do, and what makes
   * "we had no complaints about that release" a sentence nobody can check.
   *
   * So hiding sets a timestamp and a hand. The row stays, the rating stays out
   * of the displayed averages, and the audit answer to "what was hidden, by
   * whom, when" is a select rather than an archaeology exercise.
   */
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id) on delete set null,

  /*
   * ONE RATING PER PERSON PER ANSWER.
   *
   * The constraint the product needs is "a rating is an opinion, and a person
   * has one opinion about one answer at a time" — so changing your mind is an
   * UPDATE. Without this a double-click is two rows and the average moves
   * twice for one opinion.
   *
   * A null `user_id` (the account was later deleted) is excluded by Postgres's
   * own null semantics in a unique constraint, which is the behaviour we want:
   * two orphaned rows are history, not a duplicate to reject.
   */
  constraint ask_sunny_feedback_one_per_user_per_turn
    unique (activity_event_id, user_id)
);

comment on table public.ask_sunny_feedback is
  'One rating, outcome and comment per user per answered Ask Sunny turn, keyed to activity_events.id. Carries no question text and no answer text — the role, salon, surface and topic come from the joined event. Hiding is a soft delete; there is no hard one.';

comment on column public.ask_sunny_feedback.activity_event_id is
  'The server-minted turn id, returned to the browser with the answer. The authorization subject: a caller may only write feedback for an event whose actor_user_id is their own.';

comment on column public.ask_sunny_feedback.hidden_at is
  'Set when an administrator hides a comment from the analytics display. The row is never deleted, so "what was hidden and by whom" stays answerable.';

/* The feedback feed: newest first, within a window, excluding hidden. */
create index if not exists ask_sunny_feedback_created_at
  on public.ask_sunny_feedback (created_at desc);

/* The moderation queue, which is almost always filtered to one status. */
create index if not exists ask_sunny_feedback_status
  on public.ask_sunny_feedback (status, created_at desc);

/* The join every aggregate makes. */
create index if not exists ask_sunny_feedback_event
  on public.ask_sunny_feedback (activity_event_id);

/* "Has this person already rated this answer" on the write path. */
create index if not exists ask_sunny_feedback_user
  on public.ask_sunny_feedback (user_id, created_at desc);

/*
 * `updated_at` moves on its own. A caller that forgets to set it would leave
 * an edited comment looking untouched, and "when was this last changed" is
 * exactly the question a moderation queue is for.
 */
create or replace function public.ask_sunny_feedback_touch()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.ask_sunny_feedback_touch() from public, anon, authenticated;

drop trigger if exists ask_sunny_feedback_touch on public.ask_sunny_feedback;
create trigger ask_sunny_feedback_touch
  before update on public.ask_sunny_feedback
  for each row execute function public.ask_sunny_feedback_touch();

-- ------------------------------------------------------------- security ----
--
-- The same posture as every other table in this schema, for the same measured
-- reason: Supabase's default privileges hand `anon` and `authenticated` full
-- DML on any new table in `public`, so both are REVOKED and nothing is granted
-- back. Forced, so the policies bind the owner too.
--
-- NO POLICY IS DEFINED, AND THAT IS THE POLICY. RLS enabled with no policy
-- denies every role that does not bypass it. All access is server-side under
-- the secret key, behind `authorizeRequest` — which is where the two rules that
-- actually matter live, because neither can be expressed as a row predicate
-- over a browser-held key:
--
--   a user may write feedback only for an event they are the actor of
--   only an administrator may read anybody's feedback but their own
--
-- Writing `using (false)` here would say the same thing in more words and
-- invite somebody to "fix" it later by loosening the predicate.

alter table public.ask_sunny_feedback enable row level security;
alter table public.ask_sunny_feedback force  row level security;

revoke all on public.ask_sunny_feedback from anon, authenticated;
