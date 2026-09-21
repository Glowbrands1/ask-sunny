import {
  CLIENT_ID_MAX_LENGTH,
  isClientConversationId,
  isClientMessageId,
  type IneligibleReason,
} from "./client-ids";

/**
 * ============================================================================
 * THE WIRE SHAPE OF A CONVERSATION, VALIDATED ONCE FOR BOTH SIDES
 * ============================================================================
 *
 * The browser builds this to save a thread; the route parses this to store one.
 * Both run the SAME function over the same untrusted-until-checked input, and
 * that is the point rather than a convenience.
 *
 * A validator the client did not share would let the import screen offer to
 * bring over twelve conversations and the server accept nine, with no honest
 * way to tell the person which three and why. Here the count the person is
 * shown is the count that will land, because the same rule produced both.
 *
 * The server does NOT trust the client for having run it. It runs it again over
 * the parsed body — the client's copy decides what to OFFER, the server's copy
 * decides what to STORE.
 *
 * ============================================================================
 * WHAT THE PAYLOAD MAY NOT CARRY
 * ============================================================================
 *
 * THERE IS NO `userId` FIELD, AND THERE MUST NEVER BE ONE. Ownership comes from
 * the validated server session and from nothing else — not a body field, not an
 * email, not a header, not an id the browser minted. The absence of the field
 * is the guarantee: a route cannot read what the type does not have, and a test
 * asserts no chat route reads one from a body.
 *
 * Nothing here carries a token, a cookie, a request header, a credential or a
 * key. `metadata` is an ALLOWLIST — unknown keys are dropped rather than
 * stored, so a field added to the browser's message type does not silently
 * start being persisted.
 */

/** Matches `LIMITS.title`, so a title this accepts is one the column takes. */
export const TITLE_MAX_LENGTH = 300;

/** Matches the `content` check on `chat_messages`. */
export const CONTENT_MAX_LENGTH = 100_000;

/**
 * Serialized bound on one message's metadata.
 *
 * Citations, follow-up chips and a form proposal are small; a thread that has
 * accumulated more than this in structured metadata on ONE turn is not a turn
 * this application produced. Bounded so a crafted local record cannot be used
 * to store bulk data in a jsonb column.
 */
export const METADATA_MAX_BYTES = 32_768;

/** Turns in one conversation. Far above any real thread; a bound, not a target. */
export const MESSAGES_PER_CONVERSATION_MAX = 500;

/**
 * Conversations one request may carry.
 *
 * The import sends batches rather than a whole history in one body, so a slow
 * or interrupted run resumes at a batch boundary instead of starting again.
 */
export const CONVERSATIONS_PER_REQUEST_MAX = 10;

/**
 * ============================================================================
 * HOW BIG ONE IMPORT REQUEST MAY BE, AND WHY IT IS THIS NUMBER
 * ============================================================================
 *
 * THE DEPLOYMENT CEILING IS 4.5 MB. A Vercel Node.js function rejects a larger
 * request body with a 413 before any of this code runs, so a limit above it
 * would not be a limit — it would be an error nobody here could explain.
 *
 * THIS IS WELL UNDER IT, deliberately, because the serialized JSON is not the
 * only thing in the request and the margin costs nothing: the import is already
 * chunked, so a smaller budget means one more round trip rather than a failure.
 *
 * COUNTING CONVERSATIONS WAS NOT ENOUGH, which is the correction. Ten
 * conversations is a bound on the wrong axis: one conversation may hold up to
 * `MESSAGES_PER_CONVERSATION_MAX` turns of up to `CONTENT_MAX_LENGTH`
 * characters each, which is tens of megabytes on its own. So the client packs
 * by BYTES as well as by count, and splits a single oversized conversation
 * across several requests by messages — see `chunkForImport`.
 *
 * A SINGLE MESSAGE ALWAYS FITS. Its content is bounded at 100 000 characters
 * and its metadata at 32 768 bytes, so the largest turn this application can
 * produce is around 132 KB — an order of magnitude inside this budget. Nothing
 * is ever truncated, and no conversation is ever unimportable for being long.
 */
export const IMPORT_MAX_REQUEST_BYTES = 3 * 1024 * 1024;

/** Turns one request may carry, across every conversation in it. */
export const MESSAGES_PER_REQUEST_MAX = 400;

/**
 * THE METADATA ALLOWLIST — everything the chat surface needs to redraw a turn.
 *
 * `feedback` is the rating the person left on their own answer, kept so a
 * reopened thread shows the words they already wrote instead of an empty form —
 * exactly what it does today from IndexedDB. `ask_sunny_feedback` remains the
 * source of truth that analytics reads; this is a display copy, rewritten
 * whenever the conversation next syncs.
 *
 * `formInstanceRef` is a POINTER — an instance id, the proposal it came from,
 * and a label to show before the fetch lands. No field values, no status, no
 * follow-up date. `form_instances` is the authority and a copy here would be
 * stale in the most dangerous direction.
 *
 * `formHandoff` is legacy and read-only. It is allowed so a thread from before
 * Phase 2 round-trips unchanged rather than losing a field on the way through.
 */
export const METADATA_KEYS = [
  "mode",
  "coverage",
  "citations",
  "recommendedVideoIds",
  "followUpSuggestions",
  "formProposal",
  "formSelection",
  "formInstanceRef",
  "formHandoff",
  "error",
  "feedback",
] as const;

export interface MessagePayload {
  clientMessageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  position: number;
  turnId: string | null;
  metadata: Record<string, unknown>;
}

export interface ConversationPayload {
  clientConversationId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: MessagePayload[];
}

/**
 * Where in the thread this request's slice of turns begins.
 *
 * NEEDED ONLY BY A CHUNKED IMPORT. A conversation too large for one request is
 * split by messages, and each slice has to land at its place in the ORIGINAL
 * array rather than at the start — otherwise chunk two would overwrite chunk
 * one's positions and the thread would read as its own last few turns repeated.
 *
 * IT IS A BOUNDED SCALAR, NOT AN ORDER. The server still computes every
 * position itself, as `offset + index`, so the caller can say where a slice
 * starts and can never say what order the turns inside it are in. It is
 * validated against the same per-conversation ceiling as the array, so no
 * offset can push a position past what a thread could hold.
 */
export const POSITION_OFFSET_MAX = MESSAGES_PER_CONVERSATION_MAX;

export type ConversationParse =
  | { ok: true; payload: ConversationPayload }
  | { ok: false; reason: IneligibleReason };

/** UUIDs as Postgres generates them, for `turn_id`. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** How far ahead of this clock a supplied timestamp may be before it is now. */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * A timestamp the caller supplied, made safe without being made useless.
 *
 * PRESERVED WHERE VALID, because an imported thread whose every turn reads
 * "today" has lost what History is sorted and grouped by — the whole reason a
 * person wanted their old conversations back.
 *
 * CLAMPED WHERE NOT. An unparseable value falls back; a value beyond this
 * clock's tolerance becomes now, so a wrong browser clock cannot pin a
 * conversation to the top of the History panel permanently.
 */
export function normaliseTimestamp(
  value: unknown,
  fallback: string,
  now: number = Date.now(),
): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed > now + CLOCK_SKEW_MS) return new Date(now).toISOString();
  return new Date(parsed).toISOString();
}

/**
 * The allowlist, applied.
 *
 * Unknown keys are DROPPED rather than rejected: a browser running an older or
 * newer build than the server is the ordinary case during a deploy, and losing
 * an unrecognised presentation field is the right outcome where refusing the
 * whole conversation would not be.
 *
 * `undefined` is dropped too — `JSON.stringify` would drop it anyway, and
 * storing `null` for "the browser did not set this" invents a value.
 */
export function safeMetadata(message: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const key of METADATA_KEYS) {
    const value = message[key];
    if (value === undefined) continue;
    metadata[key] = value;
  }
  return metadata;
}

function metadataWithinBound(metadata: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(metadata).length <= METADATA_MAX_BYTES;
  } catch {
    // Circular or otherwise unserialisable: not something this application
    // produced, and not something to store.
    return false;
  }
}

/**
 * Reads one conversation from whatever the caller supplied, or says why it
 * cannot.
 *
 * THE WHOLE THREAD IS DECLINED WHEN ONE TURN IS MALFORMED, rather than the
 * turn. A conversation missing its third message is not a smaller version of
 * itself — it is a record that reads as though something was never said, which
 * is worse than not having imported it. The reason is reported so the person
 * is told, rather than left with a silently shorter history.
 *
 * `position` comes from the ARRAY INDEX, never from the caller and never from
 * `createdAt`: the browser holds a thread as an ordered array, two turns can
 * share a millisecond, and a question transposed with its own answer is the one
 * corruption that would look like Sunny answering before being asked.
 */
export function parseConversation(
  value: unknown,
  now: number = Date.now(),
): ConversationParse {
  const source = record(value);
  if (!source) return { ok: false, reason: "malformed_record" };

  const id = source.id ?? source.clientConversationId;
  if (typeof id === "string" && id.startsWith("conv-seed-")) {
    return { ok: false, reason: "demo_seed" };
  }
  if (!isClientConversationId(id, now)) {
    return { ok: false, reason: "malformed_conversation_id" };
  }

  const rawTitle = typeof source.title === "string" ? source.title.trim() : "";
  if (!rawTitle) return { ok: false, reason: "malformed_record" };
  const title = rawTitle.slice(0, TITLE_MAX_LENGTH);

  const rawMessages = source.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (rawMessages.length > MESSAGES_PER_CONVERSATION_MAX) {
    return { ok: false, reason: "malformed_record" };
  }

  const createdAt = normaliseTimestamp(source.createdAt, new Date(now).toISOString(), now);
  const updatedAt = normaliseTimestamp(source.updatedAt, createdAt, now);

  /*
   * WHERE THIS SLICE SITS IN THE THREAD. Zero for an ordinary save, which is
   * every save that is not a chunk of an oversized import.
   */
  const rawOffset = source.positionOffset;
  const offset =
    typeof rawOffset === "number" && Number.isInteger(rawOffset) && rawOffset >= 0
      ? rawOffset
      : 0;
  if (offset > POSITION_OFFSET_MAX) return { ok: false, reason: "malformed_record" };
  if (offset + rawMessages.length > MESSAGES_PER_CONVERSATION_MAX) {
    return { ok: false, reason: "malformed_record" };
  }

  const messages: MessagePayload[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < rawMessages.length; index += 1) {
    const raw = record(rawMessages[index]);
    if (!raw) return { ok: false, reason: "malformed_record" };

    const messageId = raw.id ?? raw.clientMessageId;
    if (!isClientMessageId(messageId, now)) {
      return { ok: false, reason: "malformed_message_id" };
    }
    /*
     * A thread cannot contain the same turn twice. Postgres would reject the
     * second insert on the per-conversation unique constraint anyway; catching
     * it here means the person is told the record is malformed instead of the
     * import failing halfway with a constraint name.
     */
    if (seen.has(messageId)) return { ok: false, reason: "malformed_record" };
    seen.add(messageId);

    if (raw.role !== "user" && raw.role !== "assistant") {
      return { ok: false, reason: "malformed_record" };
    }

    /*
     * An empty string is legitimate: a failed turn stores its reason in
     * `metadata.error` and renders as a distinct state, and the message exists
     * because the person still asked. A non-string is not.
     */
    if (typeof raw.content !== "string") {
      return { ok: false, reason: "malformed_record" };
    }
    if (raw.content.length > CONTENT_MAX_LENGTH) {
      return { ok: false, reason: "malformed_record" };
    }

    const metadata = safeMetadata(raw);
    if (!metadataWithinBound(metadata)) {
      return { ok: false, reason: "malformed_record" };
    }

    messages.push({
      clientMessageId: messageId,
      role: raw.role,
      content: raw.content,
      createdAt: normaliseTimestamp(raw.createdAt, createdAt, now),
      /*
       * FROM THE ARRAY INDEX, PLUS THIS SLICE'S OFFSET. Never from the caller,
       * and never from `createdAt` — two turns can share a millisecond, and a
       * question transposed with its own answer is the one corruption that
       * would look like Sunny replying before being asked.
       */
      position: offset + index,
      /*
       * Stored only when it is actually a uuid. `turn_id` is not a foreign key
       * — see the migration — so a malformed one would otherwise be persisted
       * as text-shaped nonsense that no join could ever use.
       */
      turnId: typeof raw.turnId === "string" && UUID.test(raw.turnId) ? raw.turnId : null,
      metadata,
    });
  }

  return {
    ok: true,
    payload: { clientConversationId: id, title, createdAt, updatedAt, messages },
  };
}

/**
 * The conversations in a local history that are eligible to be stored, and the
 * ones that are not with the reason why.
 *
 * Used by the browser to decide what to OFFER — which is why the seeded threads
 * never even appear in an import prompt — and by the route to decide what to
 * STORE.
 */
export function partitionConversations(
  values: unknown[],
  now: number = Date.now(),
): {
  eligible: ConversationPayload[];
  declined: { id: string | null; reason: IneligibleReason }[];
} {
  const eligible: ConversationPayload[] = [];
  const declined: { id: string | null; reason: IneligibleReason }[] = [];

  for (const value of values) {
    const parsed = parseConversation(value, now);
    if (parsed.ok) {
      eligible.push(parsed.payload);
      continue;
    }
    const source = record(value);
    const id = source && typeof source.id === "string" ? source.id : null;
    declined.push({
      // Bounded before it is ever put in a response or a log line.
      id: id ? id.slice(0, CLIENT_ID_MAX_LENGTH) : null,
      reason: parsed.reason,
    });
  }

  return { eligible, declined };
}
