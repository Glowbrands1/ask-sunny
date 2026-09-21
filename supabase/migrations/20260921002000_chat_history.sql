-- ---------------------------------------------------------------------------
-- ASK SUNNY CHAT HISTORY — the conversation, where the person can reach it.
--
-- WHAT THIS CHANGES. Conversations lived in the browser's IndexedDB and
-- nowhere else, so History existed on exactly one device. A manager who asked
-- Sunny something from the salon could not find it from home, and a new laptop
-- started empty with no way back. These two tables are the account-scoped copy.
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
--   creates one enum and two tables and secures them. That is all it does.
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
-- So there is no column, no index and no view here whose purpose is to serve
-- somebody else's conversation to an administrator. Adding one later is a
-- migration, a permission, a policy decision and a copy change — which is the
-- friction it should have.
--
-- ===========================================================================
-- THE BROWSER'S IDS ARE CORRELATION KEYS, NEVER OWNERSHIP
-- ===========================================================================
--
-- `conv_*` and `msg_*` are minted by `createId()` in the browser. They are
-- useful for exactly two things — matching a local record to the row it became,
-- and making a retry idempotent — and they are worth nothing as an
-- authorization subject, because the browser chose them.
--
-- Hence the uniqueness is `(user_id, client_conversation_id)`, not
-- `client_conversation_id` alone. The user id comes from the validated session
-- and is never read from a request body. Two people can hold the same local id
-- and neither can reach the other's row, because every statement the
-- application issues against these tables carries the caller's own `user_id`.
--
-- ADDITIVE ONLY. One enum, two tables, four indexes, the security posture.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------ the role -----
--
-- An enum rather than free text, for the reason every other vocabulary in this
-- schema is one: a typo becomes a rejected write rather than a role that
-- renders as neither side of the conversation. Two members, because a chat turn
-- is either the person or Sunny. A future system message would add a member
-- here; it would not widen a text column that had already accepted anything.

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
   * the estate's record of what happened and must outlive an account, so they
   * null the actor and keep the row. A conversation is not a record of the
   * business; it is a person's own working history, and when their account is
   * deleted there is no one it belongs to and no reason to keep it.
   */
  user_id uuid not null references auth.users (id) on delete cascade,

  /*
   * The title `titleForConversation()` derived from the first question. Bounded
   * to match `LIMITS.title`, so a browser cannot store a title the API would
   * refuse.
   */
  title text not null
    check (length(btrim(title)) > 0 and length(title) <= 300),

  /*
   * THE CONVERSATION'S OWN TIMES, not the row's.
   *
   * Defaulted for a conversation started after this shipped, and supplied by
   * the client for an imported one — because an imported thread that all reads
   * "today" has lost the thing History is sorted and grouped by. The API bounds
   * them: an unparseable or far-future value becomes now rather than a
   * conversation pinned to the top of the list forever.
   *
   * There is deliberately NO `updated_at` trigger. A trigger would overwrite a
   * preserved timestamp on the very insert that was trying to keep it.
   */
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * RESERVED, AND NOTHING WRITES IT YET.
   *
   * The product has no archive for conversations — the History panel deletes,
   * and that is the whole vocabulary. The column is here because archiving is
   * the obvious next semantic and adding it later would be a second migration
   * against a table people's history is already in. It is documented as unused
   * rather than left to look like a feature somebody forgot to wire up.
   */
  archived_at timestamptz,

  /*
   * THE BROWSER'S OWN ID FOR THIS THREAD — `conv_<base36>`.
   *
   * Opaque text. Never a foreign key, never joined across users, never
   * consulted for access. Two jobs: it is what an import matches against so a
   * second run adopts the row it already created instead of making another, and
   * it is what lets the browser keep addressing its own history by the id it
   * has always used, so the chat screen and the History panel did not have to
   * learn a second id scheme.
   */
  client_conversation_id text not null
    check (length(btrim(client_conversation_id)) > 0
           and length(client_conversation_id) <= 128),

  /*
   * SET ONLY BY THE ONE-TIME IMPORT, so "where did this come from" stays
   * answerable. A conversation created normally after this shipped leaves it
   * null; that is the difference between a thread the service recorded as it
   * happened and one a person chose to bring over from a device.
   */
  imported_at timestamptz,

  /*
   * THE IDEMPOTENCY KEY, and the reason a double-clicked Import, a refresh
   * mid-run, a retry after a network failure and a second attempt from another
   * tab all produce exactly one conversation.
   *
   * PER USER. Never global — see the header.
   */
  constraint chat_conversations_one_per_client_id
    unique (user_id, client_conversation_id)
);

comment on table public.chat_conversations is
  'One Ask Sunny conversation, owned by the authenticated person who had it. Readable only by its own user_id: there is no administrative viewer and no cross-user read in this phase. client_conversation_id is the browser''s own conv_* id, kept as an opaque correlation key for idempotent import and retry, and never as proof of ownership.';

comment on column public.chat_conversations.client_conversation_id is
  'The browser-minted conv_* id. Correlation only — unique per user, never joined across users, never consulted for access.';

comment on column public.chat_conversations.imported_at is
  'Set when the row came from a person''s explicit one-time import of browser-local history. Null for conversations recorded by the service as they happened.';

comment on column public.chat_conversations.archived_at is
  'Reserved. Nothing writes this yet — the History panel deletes and does not archive.';

/* The History panel's only query: my conversations, most recent first. */
create index if not exists chat_conversations_user_updated
  on public.chat_conversations (user_id, updated_at desc);

-- -------------------------------------------------------- the messages -----

create table if not exists public.chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),

  conversation_id uuid not null
    references public.chat_conversations (id) on delete cascade,

  /*
   * DENORMALISED ON PURPOSE, and it is load-bearing rather than convenient.
   *
   * Every statement this application issues against messages can then carry the
   * caller's own id directly, so "show me a message" is scoped by the reader in
   * the statement itself rather than by a join the next query might forget. It
   * also means a half-written insert cannot land a message in somebody else's
   * thread: the two columns would disagree, and the application writes both
   * from one validated session.
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
   * `createdAt` is minted by `nowIso()` per message and two turns can share a
   * millisecond — an assistant message and the user message that follows it
   * most easily of all — so sorting by time alone can transpose a question and
   * its answer. This carries the array index, and reads sort on it.
   *
   * DELIBERATELY NOT UNIQUE per conversation. A unique constraint here would
   * turn two concurrent appends from two open tabs into a LOST MESSAGE rather
   * than an ambiguous order, and losing somebody's question is far worse than
   * ordering two simultaneous ones arbitrarily. Idempotency is not this
   * column's job — that is `client_message_id` below, which does it exactly.
   */
  position integer not null check (position >= 0),

  /*
   * THE BROWSER'S OWN ID FOR THIS TURN — `msg_<base36>`.
   *
   * The message-level idempotency key. A conversation is saved by re-sending
   * the whole thread, so this is what makes that safe: a message already stored
   * is recognised and skipped, and a retry after a failed or half-completed
   * write adds only what is genuinely missing. Opaque, never consulted for
   * access.
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
   *
   * It is validated as a uuid by the API and stored as null when it is not one,
   * so the join to `ask_sunny_feedback` still works wherever the event survives.
   */
  turn_id uuid,

  /*
   * WHAT THE CHAT SURFACE NEEDS TO REDRAW THE TURN, AND NOTHING ELSE.
   *
   * An allowlist, applied in the API and not merely intended here: answer mode,
   * coverage, citations, recommended video ids, follow-up suggestions, the form
   * proposal or the form choices, the pointer to a created form, the failure
   * state, and the rating the person themselves left.
   *
   * WHAT MAY NEVER GO IN: a token, a cookie, a request header, a credential, a
   * key, or a copy of a form's field values. `formInstanceRef` stays a POINTER
   * — an instance id and a label — because `form_instances` is the source of
   * truth for a form and a copy here would be stale in the most dangerous
   * direction, looking authoritative while being wrong.
   */
  metadata jsonb not null default '{}'::jsonb,

  /*
   * ONE ROW PER BROWSER MESSAGE PER CONVERSATION. The constraint that makes a
   * re-sent thread converge instead of accumulating.
   */
  constraint chat_messages_one_per_client_id
    unique (conversation_id, client_message_id)
);

comment on table public.chat_messages is
  'The turns of one Ask Sunny conversation, owned by the same person as the conversation. Holds question and answer text, which activity_events deliberately does not. metadata carries only what the chat surface needs to redraw a turn — never a token, header, credential or a copy of a form''s field values.';

comment on column public.chat_messages.position is
  'The thread''s own order, from the browser''s array index. Not unique: two concurrent appends must both survive with an arbitrary order rather than one being rejected. Reads sort on (position, created_at, id).';

comment on column public.chat_messages.turn_id is
  'activity_events.id for the turn this answered, where one was recorded. Deliberately NOT a foreign key: an imported conversation may name an event row that no longer exists, and a missing analytics row must never reject a person''s own history.';

comment on column public.chat_messages.client_message_id is
  'The browser-minted msg_* id. The message-level idempotency key for a re-sent thread. Correlation only, never consulted for access.';

/* Reading one thread in order — the only query messages are ever read by. */
create index if not exists chat_messages_conversation_position
  on public.chat_messages (conversation_id, position, created_at);

/* "What is already stored for me", which the import and the sync both ask. */
create index if not exists chat_messages_user
  on public.chat_messages (user_id, created_at desc);

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

alter table public.chat_conversations enable row level security;
alter table public.chat_conversations force  row level security;
alter table public.chat_messages      enable row level security;
alter table public.chat_messages      force  row level security;

revoke all on public.chat_conversations from anon, authenticated;
revoke all on public.chat_messages      from anon, authenticated;
