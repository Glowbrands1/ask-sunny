import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AuthError } from "@/lib/auth/types";
import type { ChatConversation, ChatMessage } from "@/types";
import { CONVERSATION_REFUSED, ChatStoreError } from "./errors";
import { isClientConversationId } from "./client-ids";
import type { ConversationPayload } from "./payload";

/**
 * ============================================================================
 * READING AND WRITING A PERSON'S OWN CHAT HISTORY
 * ============================================================================
 *
 * THE ONE RULE EVERYTHING HERE RESTS ON: every statement carries the caller's
 * own `user_id`, taken from the validated server session and from nowhere else.
 * Not from a body, not from an email, not from a header, not from the `conv_*`
 * id the browser minted — those are correlation keys and prove nothing.
 *
 * SCOPED IN THE STATEMENT, NOT AFTER IT. `eq("user_id", userId)` is on the
 * query rather than a filter applied to its result, which is the difference
 * between a rule the database enforces on every row it considers and a step a
 * future edit can forget. It is also why `(user_id, client_conversation_id)` is
 * the unique key: there is no lookup in this file that can resolve a
 * conversation without naming whose it is.
 *
 * WHAT A FORGED `conv_*` BUYS: nothing. It names a row the caller does not own,
 * the scoped lookup finds no row for them, and the read is refused with the
 * same sentence a genuinely missing conversation gets — so the endpoint cannot
 * be used to learn which ids are real. This is the pattern `assertOwnTurn` in
 * `lib/feedback/store.ts` established, applied to a different resource.
 *
 * ============================================================================
 * THERE IS NO CROSS-USER READ IN THIS FILE
 * ============================================================================
 *
 * Not behind a permission, not behind a role check, not behind a flag. Every
 * exported function takes `userId` as its first argument and uses it. An
 * administrative viewer would be a new function, a new route, a new permission
 * and a change to the privacy wording the History panel shows — which is the
 * friction it should have, and is out of scope here.
 *
 * ============================================================================
 * IT IS THE SECRET-KEY CLIENT, AND `server-only` IS WHY THAT IS SAFE
 * ============================================================================
 *
 * `getSupabaseAdmin()` bypasses row level security by design; the tables are
 * enabled, forced and policy-less so nothing else can reach them at all. The
 * `import "server-only"` at the top of this file makes importing it from a
 * client component a BUILD ERROR rather than a code-review question, which is
 * what keeps that key out of the browser bundle.
 */

/** Conversations one list read returns, most recently updated first. */
export const MAX_CONVERSATIONS = 50;

/** A hard ceiling on one read, so a pathological history cannot exhaust memory. */
const MAX_MESSAGES_PER_READ = 5_000;

interface ConversationRow {
  id: string;
  client_conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  conversation_id: string;
  client_message_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  position: number;
  turn_id: string | null;
  metadata: Record<string, unknown> | null;
}

function unavailable(action: string): never {
  /*
   * The Postgres message can quote row contents — and rows here hold what
   * somebody asked Sunny about a named employee. It is never surfaced and never
   * logged from this module; an operator gets the detail from Supabase's own
   * logs, where it is already access-controlled.
   */
  throw new ChatStoreError(
    `Ask Sunny could not ${action} just now. Your conversation is still on this device — please try again.`,
  );
}

/**
 * Rebuilds the shape the chat surface has always rendered.
 *
 * THE BROWSER'S ID IS THE ID. A conversation read back from Postgres presents
 * as `conv_*`, not as the row's uuid, so the History panel, the chat screen and
 * the Overview band did not have to learn a second identifier — and a thread
 * started on another device opens here by exactly the same code path as one
 * started in this browser.
 *
 * `attachedDocumentIds` is always empty, and honestly so: chat has no
 * attachment system, the field is set to `[]` at both creation sites and never
 * populated, and inventing storage for it here would be inventing a feature.
 */
function toConversation(row: ConversationRow, messages: MessageRow[]): ChatConversation {
  return {
    id: row.client_conversation_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachedDocumentIds: [],
    messages: messages.map((message) => {
      const metadata = (message.metadata ?? {}) as Record<string, unknown>;
      return {
        ...metadata,
        id: message.client_message_id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
        ...(message.turn_id ? { turnId: message.turn_id } : {}),
      } as ChatMessage;
    }),
  };
}

/**
 * Orders a thread the way it was written.
 *
 * `position` first, because that is the array index the browser actually held.
 * `created_at` and then the row id break a tie deterministically, so two
 * concurrent appends that landed on the same position render in the same order
 * on every device instead of shuffling between reads.
 */
function inThreadOrder(a: MessageRow, b: MessageRow): number {
  if (a.position !== b.position) return a.position - b.position;
  const byTime = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (Number.isFinite(byTime) && byTime !== 0) return byTime;
  return a.client_message_id.localeCompare(b.client_message_id);
}

/* ------------------------------------------------------------------ reads -- */

/**
 * This person's history. Never anybody else's — there is no argument through
 * which another user's id could reach this query.
 */
export async function listOwnConversations(
  userId: string,
  limit: number = MAX_CONVERSATIONS,
): Promise<ChatConversation[]> {
  const supabase = getSupabaseAdmin();

  const { data: conversationRows, error: conversationError } = await supabase
    .from("chat_conversations")
    .select("id, client_conversation_id, title, created_at, updated_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), MAX_CONVERSATIONS));

  if (conversationError) unavailable("load your history");

  const conversations = (conversationRows ?? []) as ConversationRow[];
  if (conversations.length === 0) return [];

  const { data: messageRows, error: messageError } = await supabase
    .from("chat_messages")
    .select(
      "conversation_id, client_message_id, role, content, created_at, position, turn_id, metadata",
    )
    /*
     * SCOPED BY THE READER AS WELL AS BY THE CONVERSATION. The conversation ids
     * were just read under this person's own id so the `in` is already safe —
     * and the second predicate is here anyway, because a read of message
     * content should not depend on a previous query having been written
     * correctly.
     */
    .eq("user_id", userId)
    .in(
      "conversation_id",
      conversations.map((row) => row.id),
    )
    .limit(MAX_MESSAGES_PER_READ);

  if (messageError) unavailable("load your history");

  const byConversation = new Map<string, MessageRow[]>();
  for (const message of (messageRows ?? []) as MessageRow[]) {
    const bucket = byConversation.get(message.conversation_id) ?? [];
    bucket.push(message);
    byConversation.set(message.conversation_id, bucket);
  }

  return conversations.map((row) =>
    toConversation(row, (byConversation.get(row.id) ?? []).sort(inThreadOrder)),
  );
}

/**
 * One conversation, by the browser's own id, for the person who owns it.
 *
 * REFUSES IDENTICALLY for a conversation that does not exist, one that belongs
 * to somebody else, and an id that is not the shape this application mints. A
 * caller learns nothing from the difference, because there is no difference to
 * read.
 */
export async function getOwnConversation(
  userId: string,
  clientConversationId: string,
): Promise<ChatConversation> {
  if (!isClientConversationId(clientConversationId)) {
    throw new AuthError("forbidden", CONVERSATION_REFUSED);
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id, client_conversation_id, title, created_at, updated_at")
    .eq("user_id", userId)
    .eq("client_conversation_id", clientConversationId)
    .maybeSingle();

  /*
   * A DATABASE FAILURE IS NOT A REFUSAL — the same distinction `assertOwnTurn`
   * draws. Telling somebody their own conversation is not theirs because
   * Supabase was briefly unreachable is both wrong and alarming.
   */
  if (error) unavailable("open that conversation");
  if (!data) throw new AuthError("forbidden", CONVERSATION_REFUSED);

  const row = data as ConversationRow;

  const { data: messageRows, error: messageError } = await supabase
    .from("chat_messages")
    .select(
      "conversation_id, client_message_id, role, content, created_at, position, turn_id, metadata",
    )
    .eq("user_id", userId)
    .eq("conversation_id", row.id)
    .limit(MAX_MESSAGES_PER_READ);

  if (messageError) unavailable("open that conversation");

  return toConversation(row, ((messageRows ?? []) as MessageRow[]).sort(inThreadOrder));
}

/**
 * Which of this person's local conversations are already stored for them.
 *
 * What the import screen diffs against, so a second run offers only what is
 * genuinely missing — and so "Import" after a half-finished run resumes rather
 * than starting again. Ids only: no titles, no content, nothing that would make
 * this a way to read a conversation.
 */
export async function ownClientConversationIds(userId: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("chat_conversations")
    .select("client_conversation_id")
    .eq("user_id", userId)
    .limit(MAX_CONVERSATIONS * 10);

  if (error) unavailable("check your history");

  return ((data ?? []) as { client_conversation_id: string }[]).map(
    (row) => row.client_conversation_id,
  );
}

/* ----------------------------------------------------------------- writes -- */

export interface SaveOptions {
  /** True when this came from a person's explicit one-time import. */
  imported?: boolean;
}

/**
 * Stores a conversation and its turns, idempotently.
 *
 * ============================================================================
 * THE WHOLE THREAD IS SENT EVERY TIME, AND THAT IS WHAT MAKES IT SAFE
 * ============================================================================
 *
 * A save is not "append what is new" — the browser has no reliable way to know
 * what the server already took when a request timed out mid-flight. It sends
 * the thread as it stands, and the two unique constraints turn that into
 * convergence: the conversation is matched on `(user_id, client_conversation_id)`
 * and each turn on `(conversation_id, client_message_id)`, so a double-clicked
 * Import, a refresh mid-run, a retry after a network failure and a second tab
 * saving the same thread all end at one conversation with one copy of each turn.
 *
 * TURNS ARE UPSERTED RATHER THAN IGNORED ON CONFLICT, because a turn does
 * change after it is first written: the person rates the answer, and a form
 * they confirmed attaches its instance pointer. Ignoring the conflict would
 * freeze a message at the moment it was first synced.
 *
 * `position` IS REWRITTEN FROM THE ARRAY on every save, so the order the
 * browser holds stays the order Postgres holds.
 */
export async function saveOwnConversation(
  userId: string,
  payload: ConversationPayload,
  options: SaveOptions = {},
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: lookupError } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("client_conversation_id", payload.clientConversationId)
    .maybeSingle();

  if (lookupError) unavailable("save that conversation");

  let conversationId = (existing as { id: string } | null)?.id ?? null;

  if (conversationId) {
    const { error } = await supabase
      .from("chat_conversations")
      .update({ title: payload.title, updated_at: payload.updatedAt })
      .eq("id", conversationId)
      /*
       * BOTH PREDICATES, ALWAYS. The id was just read under this person's own
       * scope, so the second is redundant today — and an update that can only
       * ever touch a row the caller owns should say so in the statement rather
       * than rely on the statement above it having been written correctly.
       */
      .eq("user_id", userId);

    if (error) unavailable("save that conversation");
  } else {
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({
        /*
         * FROM THE SESSION. There is no field on `ConversationPayload` through
         * which a caller could have supplied this, which is the guarantee —
         * a route cannot read what the type does not have.
         */
        user_id: userId,
        client_conversation_id: payload.clientConversationId,
        title: payload.title,
        created_at: payload.createdAt,
        updated_at: payload.updatedAt,
        imported_at: options.imported ? new Date().toISOString() : null,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      /*
       * A UNIQUE VIOLATION HERE IS A RACE, NOT A FAULT: two tabs saved the same
       * new thread at once, or a retry overtook a request that had in fact
       * landed. The row the other writer created is the right one, so this
       * re-reads it and carries on — which is the behaviour that makes a
       * double-clicked Import produce one conversation rather than an error.
       */
      const { data: raced, error: raceError } = await supabase
        .from("chat_conversations")
        .select("id")
        .eq("user_id", userId)
        .eq("client_conversation_id", payload.clientConversationId)
        .maybeSingle();

      if (raceError || !raced) unavailable("save that conversation");
      conversationId = (raced as { id: string }).id;
    } else {
      conversationId = (data as { id: string } | null)?.id ?? null;
    }
  }

  if (!conversationId) unavailable("save that conversation");

  if (payload.messages.length === 0) return;

  const { error: messageError } = await supabase.from("chat_messages").upsert(
    payload.messages.map((message) => ({
      conversation_id: conversationId,
      /* From the session, for the same reason as the conversation above. */
      user_id: userId,
      client_message_id: message.clientMessageId,
      role: message.role,
      content: message.content,
      created_at: message.createdAt,
      position: message.position,
      turn_id: message.turnId,
      metadata: message.metadata,
    })),
    { onConflict: "conversation_id,client_message_id" },
  );

  if (messageError) unavailable("save that conversation");
}

/**
 * Deletes one of this person's conversations, or refuses.
 *
 * The messages go with it through `on delete cascade`. The refusal is the same
 * sentence a missing conversation gets, so a caller sweeping ids learns nothing
 * about which of them exist.
 */
export async function deleteOwnConversation(
  userId: string,
  clientConversationId: string,
): Promise<void> {
  if (!isClientConversationId(clientConversationId)) {
    throw new AuthError("forbidden", CONVERSATION_REFUSED);
  }

  const supabase = getSupabaseAdmin();

  /*
   * OWNERSHIP IS ESTABLISHED BEFORE ANYTHING IS DESTROYED, and separately from
   * the delete, so "that was not yours" and "that did not exist" are answered
   * before a destructive statement runs rather than inferred from how many rows
   * it happened to remove.
   */
  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("client_conversation_id", clientConversationId)
    .maybeSingle();

  if (error) unavailable("delete that conversation");
  if (!data) throw new AuthError("forbidden", CONVERSATION_REFUSED);

  const { error: deleteError } = await supabase
    .from("chat_conversations")
    .delete()
    .eq("id", (data as { id: string }).id)
    .eq("user_id", userId);

  if (deleteError) unavailable("delete that conversation");
}

/**
 * Clears this person's whole history from their account.
 *
 * SCOPED BY `user_id` AND NOTHING ELSE, which is the only shape this statement
 * may ever have: a delete on these tables without that predicate would be a
 * truncate of everybody's history wearing a feature's name.
 */
export async function deleteAllOwnConversations(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("chat_conversations")
    .delete()
    .eq("user_id", userId);

  if (error) unavailable("clear your history");
}
