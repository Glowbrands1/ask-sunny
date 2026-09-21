-- ---------------------------------------------------------------------------
-- ASK SUNNY CHAT HISTORY — the conversation, where the person can reach it.
--
-- WHAT THIS CHANGES. Conversations lived in the browser's IndexedDB and
-- nowhere else, so History existed on exactly one device. A manager who asked
-- Sunny something from the salon could not find it from home, and a new laptop
-- started empty with no way back. These tables are the account-scoped copy.
--
-- WHAT IT DOES NOT CHANGE, and this is the part worth being explicit about:
--
--   `activity_events` still holds NO question and NO answer text. It is the
--   adoption record and it stays text-free. Nothing here backfills it, reads it
--   for text, or gives it a column one could be put in.
--
--   `ask_sunny_feedback` is untouched. It remains keyed to the turn, and it
--   remains the source of truth for what anybody said about an answer.
--
--   No existing table, view, function, policy or grant is altered. This file
--   creates one enum, three tables, one trigger function and its trigger, and
--   secures them. That is all it does.
--
-- ===========================================================================
-- WHO MAY READ A CONVERSATION, IN THIS PHASE: ITS AUTHOR, AND NOBODY ELSE
-- ===========================================================================
--
-- There is no administrative viewer, no audit route, no cross-user read, and
-- no permission that would grant one. That is a deliberate scope boundary, not
-- an unfinished edge: the product currently tells every person "History is
-- private to your account" on the screen their history is drawn on, and until
-- that promise is deliberately renegotiated the technical behaviour has to
-- match it exactly.
--
-- ===========================================================================
-- THE BROWSER'S IDS ARE CORRELATION KEYS, NEVER OWNERSHIP
-- ===========================================================================
--
-- `conv_*` and `msg_*` are minted by `createId()` in the browser. They are
-- useful for exactly three things — matching a local record to the row it
-- became, making a retry idempotent, and telling a second device that a
-- conversation it still holds locally was deleted — and they are worth nothing
-- as an authorization subject, because the browser chose them.
--
-- Hence the uniqueness is `(user_id, client_conversation_id)`, not
-- `client_conversation_id` alone. The user id comes from the validated session
-- and is never read from a request body. Two people can hold the same local id
-- and neither can reach the other's row.
--
-- ===========================================================================
-- DELETION HAS TO SURVIVE A BROWSER THAT WAS NOT THERE WHEN IT HAPPENED
-- ===========================================================================
--
-- THE DEFECT THIS SCHEMA EXISTS TO PREVENT. The browser keeps its own copy of
-- history — deliberately, as rollback protection — and hydration merges the
-- account's copy with it as a UNION, so a momentary outage can never look like
-- "your account has no history". Those two facts together resurrect the dead:
--
--   Laptop A imports conversation X. Laptop B still holds X locally. The
--   person deletes X on Laptop A. A hard delete leaves the server with no
--   record that X ever existed — so when Laptop B next opens Ask Sunny, the
--   union adds X back, and it becomes importable again.
--
-- A delete that undoes itself on another device is not a delete, and the
-- History panel now promises it removes conversations "from your Ask Sunny
-- account and from this browser". So the server keeps a DURABLE, POSITIVE
-- record of the decision, in two shapes:
--
--   ONE CONVERSATION -> a TOMBSTONE. `deleted_at` is set, the turns are
--   destroyed, and the title is nulled — the row that remains carries the
--   person's own `conv_*` id and nothing they wrote. Every read excludes it;
--   the sync endpoint reports it so a stale browser can suppress its copy.
--
--   ALL OF IT -> a BOUNDARY. `chat_history_boundaries.history_cleared_at`
--   marks the moment, and every conversation CREATED at or before it is
--   suppressed everywhere. One row answers for a browser holding fifty stale
--   conversations, which is why Clear History does not need fifty tombstones.
--
-- A TOMBSTONE HOLDS NO CONTENT, AND THAT IS A CONSTRAINT RATHER THAN A HABIT.
-- `title` is derived from the person's first question, so a tombstone that
-- kept it would keep a sentence they asked to have deleted. The check below
-- makes a titled tombstone unrepresentable, and the trigger makes a tombstone
-- with turns unrepresentable.
--
-- ADDITIVE ONLY. One enum, three tables, indexes, one trigger, the security
-- posture. Nothing existing is altered, rewritten or dropped.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------ the role -----
--
-- An enum rather than free text, for the reason every other vocabulary in this
-- schema is one: a typo becomes a rejected write rather than a role that
-- renders as neither side of the conversation.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chat_message_role') then
    create type public.chat_message_role as enum (
      'user',
      'assistant'
    );
  end if;
end
$$;

-- --------------------------------------------------- the conversation ------

create table if not exists public.chat_conversations (
  id uuid primary key default extensions.gen_random_uuid(),

  /*
   * WHOSE IT IS. The one fact everything else here rests on.
   *
   * `on delete cascade`, and the direction is the opposite of the choice made
   * in `activity_events` and `ask_sunny_feedback` — on purpose. Those two are
   * the estate's record of what happened and must outlive an account. A
   * conversation is not a record of the business; it is a person's own working
   * history, and when their account is deleted there is no one it belongs to.
   */
  user_id uuid not null references auth.users (id) on delete cascade,

  /*
   * The title `titleForConversation()` derived from the first question — so it
   * is the person's own words, and a tombstone must not keep it. NULLABLE for
   * exactly that reason; see the constraint below, which makes "deleted" and
   * "has a title" mutually exclusive.
   */
  title text
    check (title is null or (length(btrim(title)) > 0 and length(title) <= 300)),

  /*
   * THE CONVERSATION'S OWN TIMES, not the row's.
   *
   * Defaulted for a conversation started after this shipped, and supplied by
   * the client for an imported one — because an imported thread that all reads
   * "today" has lost the thing History is sorted and grouped by. The API bounds
   * them: an unparseable or far-future value becomes now.
   *
   * `created_at` IS ALSO THE CLEAR BOUNDARY'S SUBJECT. A conversation is
   * suppressed when it was CREATED at or before a clear — not when it was last
   * updated — so a stale browser cannot rescue one by continuing it after the
   * fact and pushing its `updated_at` past the line.
   *
   * There is deliberately NO `updated_at` trigger. A trigger would overwrite a
   * preserved timestamp on the very insert that was trying to keep it.
   */
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * RESERVED, AND NOTHING WRITES IT YET. The product has no archive for
   * conversations — the History panel deletes, and that is the whole
   * vocabulary. Documented as unused rather than left looking like a feature
   * somebody forgot to wire up.
   */
  archived_at timestamptz,

  /*
   * THE TOMBSTONE. Set when the person deleted this conversation.
   *
   * The row survives the delete so the DECISION survives it. Without this the
   * server would hold no evidence that the conversation ever existed, and a
   * second browser's stale copy would be indistinguishable from history the
   * account had simply never seen — which is exactly how a deleted thread
   * comes back.
   */
  deleted_at timestamptz,

  /*
   * THE BROWSER'S OWN ID FOR THIS THREAD — `conv_<base36>`.
   *
   * Opaque text. Never a foreign key, never joined across users, never
   * consulted for access. Three jobs: an import matches on it so a second run
   * adopts the row it already created, the browser keeps addressing its own
   * history by the id it has always used, and a tombstone names it so another
   * device knows which of its local conversations is gone.
   */
  client_conversation_id text not null
    check (length(btrim(client_conversation_id)) > 0
           and length(client_conversation_id) <= 128),

  /*
   * SET ONLY BY THE ONE-TIME IMPORT, so "where did this come from" stays
   * answerable. A conversation created normally after this shipped leaves it
   * null.
   */
  imported_at timestamptz,

  /*
   * THE IDEMPOTENCY KEY, and the reason a double-clicked Import, a refresh
   * mid-run, a retry after a network failure and a second tab saving the same
   * thread all produce exactly one conversation.
   *
   * PER USER. Never global — see the header.
   *
   * IT ALSO COVERS TOMBSTONES, deliberately: a deleted conversation keeps its
   * slot, so re-importing the same local record cannot create a second row
   * beside the tombstone. It resolves to the tombstone and is refused.
   */
  constraint chat_conversations_one_per_client_id
    unique (user_id, client_conversation_id),

  /*
   * A TOMBSTONE CARRIES NO TITLE, AND A LIVE CONVERSATION ALWAYS HAS ONE.
   *
   * One constraint for both halves, because they are the same rule read from
   * two ends. It makes "we deleted it but kept what she called it"
   * unrepresentable rather than merely discouraged.
   */
  constraint chat_conversations_tombstone_carries_no_title
    check ((deleted_at is null) = (title is not null)),

  /*
   * ============================================================
   * THE TARGET OF THE COMPOSITE FOREIGN KEY ON `chat_messages`
   * ============================================================
   *
   * Redundant against the primary key on its own — `id` is already unique, so
   * `(id, user_id)` cannot help but be. It exists because PostgreSQL requires
   * a UNIQUE or PRIMARY KEY constraint over exactly the referenced columns
   * before a foreign key may point at them, and the foreign key it enables is
   * what stops a message ever claiming a different owner from its conversation.
   * See `chat_messages_owner_matches_conversation` below.
   */
  constraint chat_conversations_id_user_key unique (id, user_id)
);

comment on table public.chat_conversations is
  'One Ask Sunny conversation, owned by the authenticated person who had it. Readable only by its own user_id: there is no administrative viewer and no cross-user read in this phase. A deleted conversation becomes a tombstone — deleted_at set, turns destroyed, title nulled — so that an intentional delete is not undone by a second browser''s stale local copy.';

comment on column public.chat_conversations.client_conversation_id is
  'The browser-minted conv_* id. Correlation only — unique per user, never joined across users, never consulted for access. Also what a tombstone names so a stale browser can suppress its own copy.';

comment on column public.chat_conversations.deleted_at is
  'The tombstone. Set when the person deleted this conversation; the turns are destroyed and the title nulled by the same act. Every read excludes it, and the sync endpoint reports the id so another device stops showing it.';

comment on column public.chat_conversations.imported_at is
  'Set when the row came from a person''s explicit one-time import of browser-local history. Null for conversations recorded by the service as they happened.';

comment on column public.chat_conversations.archived_at is
  'Reserved. Nothing writes this yet — the History panel deletes and does not archive.';

comment on column public.chat_conversations.created_at is
  'When the conversation started. Also what a Clear History boundary is compared against, so continuing a stale conversation after a clear cannot rescue it.';

/* The History panel's only query: my live conversations, most recent first. */
create index if not exists chat_conversations_user_updated
  on public.chat_conversations (user_id, updated_at desc)
  where deleted_at is null;

/* "What did I delete", which every hydrating browser asks once. */
create index if not exists chat_conversations_user_deleted
  on public.chat_conversations (user_id, deleted_at)
  where deleted_at is not null;

-- -------------------------------------------------------- the messages -----

create table if not exists public.chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),

  conversation_id uuid not null,

  /*
   * DENORMALISED ON PURPOSE, and it is load-bearing rather than convenient.
   *
   * Every statement this application issues against messages can then carry the
   * caller's own id directly, so "show me a message" is scoped by the reader in
   * the statement itself rather than by a join the next query might forget.
   */
  user_id uuid not null references auth.users (id) on delete cascade,

  role public.chat_message_role not null,

  /*
   * WHAT WAS SAID. This is the sensitive column in this migration and it is
   * worth naming as such: managers ask Sunny about named employees' attendance
   * and performance, so this holds HR content, and the access rule above is the
   * whole protection. The bound is generous enough for the longest detailed
   * answer the model produces and small enough that a pasted workbook is
   * refused at the boundary rather than stored.
   *
   * A FAILED TURN IS AN EMPTY STRING, not a null: the chat surface stores the
   * failure in `metadata.error` and renders it as a distinct state, and the
   * message still exists because the person still asked.
   */
  content text not null check (length(content) <= 100000),

  created_at timestamptz not null default now(),

  /*
   * THE ORDER, STATED RATHER THAN INFERRED.
   *
   * The browser holds a thread as an ARRAY and that array has an order.
   * `created_at` is minted per message and two turns can share a millisecond —
   * an assistant message and the user message after it most easily of all — so
   * sorting by time alone can transpose a question and its answer. This carries
   * the array index, and reads sort on (position, created_at, client_message_id)
   * which is a TOTAL order: no two rows in one conversation can tie on all
   * three, because the third is unique within the conversation.
   *
   * DELIBERATELY NOT UNIQUE per conversation. A unique constraint here would
   * turn two concurrent appends from two devices into a LOST MESSAGE rather
   * than an ordering question, and losing somebody's question is far worse than
   * ordering two simultaneous ones deterministically. Idempotency is not this
   * column's job — `client_message_id` does that, exactly.
   */
  position integer not null check (position >= 0),

  /*
   * THE BROWSER'S OWN ID FOR THIS TURN — `msg_<base36>`.
   *
   * The message-level idempotency key. A conversation is saved by re-sending
   * the whole thread, so this is what makes that safe: a message already stored
   * is recognised and updated in place rather than added again.
   */
  client_message_id text not null
    check (length(btrim(client_message_id)) > 0
           and length(client_message_id) <= 128),

  /*
   * THE SERVER'S NAME FOR THE TURN THIS ANSWERED — `activity_events.id`.
   *
   * NOT A FOREIGN KEY, and that is a correction rather than an oversight. A
   * conversation being imported from a browser may name a turn whose event row
   * has since been removed, or one recorded against a database this deployment
   * has never seen. A foreign key would make an analytics row that no longer
   * exists reject a person's own history — an absurd trade, and exactly the
   * kind of import poisoning that is hardest to diagnose afterwards.
   */
  turn_id uuid,

  /*
   * WHAT THE CHAT SURFACE NEEDS TO REDRAW THE TURN, AND NOTHING ELSE.
   *
   * An allowlist, applied in the API: answer mode, coverage, citations,
   * recommended video ids, follow-up suggestions, the form proposal or the form
   * choices, the pointer to a created form, the failure state, and the rating
   * the person themselves left.
   *
   * WHAT MAY NEVER GO IN: a token, a cookie, a request header, a credential, a
   * key, or a copy of a form's field values. `formInstanceRef` stays a POINTER
   * because `form_instances` is the source of truth and a copy here would be
   * stale in the most dangerous direction.
   */
  metadata jsonb not null default '{}'::jsonb,

  /*
   * ONE ROW PER BROWSER MESSAGE PER CONVERSATION. The constraint that makes a
   * re-sent thread converge instead of accumulating.
   */
  constraint chat_messages_one_per_client_id
    unique (conversation_id, client_message_id),

  /*
   * ========================================================================
   * A MESSAGE CANNOT CLAIM AN OWNER ITS CONVERSATION DOES NOT HAVE
   * ========================================================================
   *
   * DEFENCE IN DEPTH, AND THE THREAT IS A BUG RATHER THAN AN ATTACKER. Every
   * statement this application issues is scoped by the session's own user id,
   * and that is the rule doing the work. But all of it runs under the secret
   * key, which holds `service_role` and bypasses row level security by design —
   * so if a future edit ever assembled a message row with one person's
   * conversation and another's id, nothing in the database would have stopped
   * it. The row would satisfy both single-column foreign keys: the conversation
   * exists, and the user exists.
   *
   * THIS COMPOSITE FOREIGN KEY MAKES THAT PAIR UNREPRESENTABLE. It references
   * `chat_conversations (id, user_id)` — so the message's `user_id` is checked
   * against the conversation's `user_id` by the same lookup that checks the
   * conversation exists, on every insert and every update of either column.
   * There is no ordering, no trigger and no application code involved.
   *
   * IT ALSO REPLACES THE PLAIN `conversation_id` FOREIGN KEY rather than
   * sitting beside it. A second key over a prefix of these columns would
   * enforce a strictly weaker version of the same thing and buy a second index
   * to maintain. `on delete cascade` is preserved here, so deleting a
   * conversation row still takes its turns with it.
   */
  constraint chat_messages_owner_matches_conversation
    foreign key (conversation_id, user_id)
    references public.chat_conversations (id, user_id)
    on delete cascade
);

comment on table public.chat_messages is
  'The turns of one Ask Sunny conversation, owned by the same person as the conversation — which the composite foreign key to chat_conversations (id, user_id) makes a property of the schema rather than of the code. Holds question and answer text, which activity_events deliberately does not.';

comment on column public.chat_messages.position is
  'The thread''s own order, from the browser''s array index. Not unique: two concurrent appends must both survive with a deterministic order rather than one being rejected. Reads sort on (position, created_at, client_message_id), which is a total order.';

comment on column public.chat_messages.turn_id is
  'activity_events.id for the turn this answered, where one was recorded. Deliberately NOT a foreign key: an imported conversation may name an event row that no longer exists, and a missing analytics row must never reject a person''s own history.';

comment on column public.chat_messages.client_message_id is
  'The browser-minted msg_* id. The message-level idempotency key for a re-sent thread. Correlation only, never consulted for access.';

/* Reading one thread in order — the only query messages are ever read by. */
create index if not exists chat_messages_conversation_position
  on public.chat_messages (conversation_id, position, created_at);

/* "How much of this conversation is already stored", which a resumed import asks. */
create index if not exists chat_messages_user
  on public.chat_messages (user_id, created_at desc);

-- ------------------------------------------- a tombstone keeps no turns ----
--
-- SOFT-DELETING A CONVERSATION DESTROYS ITS CONTENT, IN THE DATABASE.
--
-- The application does this too, and this makes it true of every path — a
-- future route, a manual correction, a backfill. Without it "soft delete" would
-- quietly mean "hide", and a conversation somebody deleted would still be
-- sitting in `chat_messages` with every word of it intact. That is the
-- difference between a tombstone and a filing cabinet.
--
-- BEFORE rather than AFTER, so the turns are gone by the time the row is
-- committed as deleted, and only on the TRANSITION, so an ordinary update of
-- an already-deleted row does no work.

create or replace function public.chat_conversations_purge_on_delete()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.chat_messages where conversation_id = old.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.chat_conversations_purge_on_delete() from public;
revoke execute on function public.chat_conversations_purge_on_delete() from anon, authenticated;

drop trigger if exists chat_conversations_purge_on_delete on public.chat_conversations;
create trigger chat_conversations_purge_on_delete
  before update on public.chat_conversations
  for each row execute function public.chat_conversations_purge_on_delete();

-- ------------------------------------------------- the clear boundary ------
--
-- ONE ROW PER PERSON, ANSWERING FOR EVERY CONVERSATION THEY EVER HAD.
--
-- Clear History could have written a tombstone per conversation, and for a
-- browser holding fifty stale threads that would be fifty rows to carry
-- forever — and still no answer for the fifty-first, which that browser holds
-- and the account never saw because it was never imported.
--
-- A BOUNDARY ANSWERS FOR ALL OF THEM AT ONCE. Anything CREATED at or before
-- this instant is suppressed: not shown, not importable, not synced. Anything
-- created after it is ordinary history and works normally, which is what makes
-- Clear History a line in time rather than a permanent ban.

create table if not exists public.chat_history_boundaries (
  /*
   * PRIMARY KEY, so there is exactly one boundary per person and a second
   * clear updates it rather than racing a duplicate into existence.
   */
  user_id uuid primary key references auth.users (id) on delete cascade,

  /*
   * THE MOMENT. Server-set, never accepted from a caller — a client-supplied
   * boundary would let a browser suppress history it did not clear, or move the
   * line backwards to resurrect what somebody did.
   */
  history_cleared_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_history_boundaries is
  'One row per person: the instant they last cleared their Ask Sunny history. Every conversation created at or before it is suppressed everywhere — hidden, unimportable and unsynced — so a browser holding stale local copies cannot resurrect them one at a time. Server-set; a caller can never supply or move it.';

comment on column public.chat_history_boundaries.history_cleared_at is
  'Compared against chat_conversations.created_at and against a local record''s own createdAt. Set from the server clock when Clear History runs.';

-- ------------------------------------------------------------- security ----
--
-- The same posture as every other table in this schema, for the same measured
-- reason: Supabase's default privileges hand `anon` and `authenticated` full
-- DML on any new table in `public`, so both are REVOKED and nothing is granted
-- back. Enabled AND forced, so the policies bind the table owner too and a
-- later migration running as owner cannot read around them.
--
-- NO POLICY IS DEFINED, AND THAT IS THE POLICY. RLS enabled with no policy
-- denies every role that does not bypass it. All access is server-side under
-- the secret key, behind `authorizeRequest` and an explicit per-resource
-- ownership check — which is where the rule that actually matters lives,
-- because it cannot be expressed as a row predicate over a browser-held key:
--
--   a person may read, continue and delete their own conversations, and there
--   is no request they can make that returns anybody else's
--
-- Writing `using (false)` would say the same thing in more words and invite
-- somebody to "fix" it later by loosening the predicate. And the publishable
-- key is in every browser: a `select` policy here, however narrow, would put
-- chat content one crafted PostgREST query away from the client bundle.

alter table public.chat_conversations      enable row level security;
alter table public.chat_conversations      force  row level security;
alter table public.chat_messages           enable row level security;
alter table public.chat_messages           force  row level security;
alter table public.chat_history_boundaries enable row level security;
alter table public.chat_history_boundaries force  row level security;

revoke all on public.chat_conversations      from anon, authenticated;
revoke all on public.chat_messages           from anon, authenticated;
revoke all on public.chat_history_boundaries from anon, authenticated;
