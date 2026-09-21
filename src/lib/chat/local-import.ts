"use client";

import type { ChatConversation } from "@/types";
import type { IneligibleReason } from "./client-ids";
import { importConversationBatch } from "./client";
import {
  CONVERSATIONS_PER_REQUEST_MAX,
  IMPORT_MAX_REQUEST_BYTES,
  MESSAGES_PER_REQUEST_MAX,
  partitionConversations,
} from "./payload";
import { isFullyStored, isSuppressed, type HistoryState } from "./suppression";

/**
 * ============================================================================
 * THE ONE-TIME IMPORT OF A BROWSER'S OWN HISTORY
 * ============================================================================
 *
 * WHAT MAKES THIS SAFE IS WHERE IT IS CALLED FROM, not what it does. Nothing in
 * this module runs on mount, on sign-in, on hydration or on a timer. It runs
 * when somebody presses Import on a prompt that told them what would happen,
 * and the alternative — "Not now" — calls nothing at all.
 *
 * ============================================================================
 * WHAT IS EVEN OFFERED
 * ============================================================================
 *
 * A conversation has to pass four tests:
 *
 *   ELIGIBLE. Not one of the six seeded demo threads every production browser
 *   holds, and shaped like something `createId` actually minted.
 *
 *   NOT DELETED. The account holds no tombstone for it. A conversation the
 *   person deleted on another device is not history they lost — it is history
 *   they removed, and offering to put it back would undo the delete.
 *
 *   NOT BEHIND A CLEAR. Created after the last Clear History, if there was one.
 *
 *   NOT ALREADY FULLY STORED. "Already stored" is by MESSAGE COUNT rather than
 *   by existence, which is what makes a chunked import resumable: a run that
 *   stopped halfway through a long conversation leaves one that exists and is
 *   short, and offering it again is the only way the rest of it arrives.
 *
 * ============================================================================
 * CHUNKING, AND WHY COUNTING CONVERSATIONS WAS NOT ENOUGH
 * ============================================================================
 *
 * Ten conversations per request bounded the wrong axis. One conversation may
 * hold five hundred turns of a hundred thousand characters each — tens of
 * megabytes — and a Vercel function refuses a body over 4.5 MB with a 413
 * before any of this code runs. A person with one very long thread would have
 * been told, unhelpfully and permanently, that their history could not be
 * imported.
 *
 * So requests are packed by BYTES and by TURNS as well as by count, and a
 * conversation too large for one request is split by messages across several —
 * each slice carrying the offset at which it belongs, so chunk two lands after
 * chunk one instead of overwriting it.
 *
 * NOTHING IS EVER TRUNCATED. The largest single turn this application can
 * produce is around 132 KB, far inside one request, so every conversation can
 * be expressed as some number of chunks.
 */

export interface ImportSummary {
  /** Conversations now on the account because of this run. */
  imported: string[];
  /** What could not be brought over, and why. Reported rather than dropped. */
  declined: { id: string | null; reason: IneligibleReason }[];
  /**
   * Set when a request failed. What was already written stays written; pressing
   * Import again continues from where this stopped.
   */
  error: string | null;
}

/**
 * The conversations in this browser that are worth offering to import.
 *
 * `state` is null when the account could not be reached, and then nothing is
 * offered — a prompt that cannot say whether these are already stored, deleted
 * or cleared is a prompt asking somebody to approve something nobody can
 * describe correctly.
 */
export function eligibleForImport(
  local: ChatConversation[],
  state: HistoryState | null,
): ChatConversation[] {
  if (!state) return [];

  const { eligible } = partitionConversations(local);
  const eligibleIds = new Set(eligible.map((payload) => payload.clientConversationId));

  /*
   * The PAYLOADS say which ids passed validation; the CONVERSATIONS are what
   * gets sent, because the server re-parses them itself and re-parsing this
   * browser's normalised output would be the browser deciding what the server
   * sees.
   */
  return local.filter(
    (conversation) =>
      eligibleIds.has(conversation.id) &&
      !isSuppressed(conversation, state) &&
      !isFullyStored(conversation, state),
  );
}

/** One request's worth of conversations, each possibly a slice of a thread. */
export interface ImportChunk {
  conversations: (ChatConversation & { positionOffset?: number })[];
}

function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    /* Unserialisable is not something this application produced. */
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Splits one oversized conversation into slices that each fit a request.
 *
 * Every slice carries the same conversation envelope — id, title, timestamps —
 * so the row is created by whichever slice arrives first and merely re-upserted
 * by the rest. `positionOffset` is where its turns belong in the original
 * array, which the server adds to each turn's index.
 */
function sliceConversation(
  conversation: ChatConversation,
): (ChatConversation & { positionOffset: number })[] {
  const slices: (ChatConversation & { positionOffset: number })[] = [];
  /* The envelope without its turns, measured once. */
  const envelope = sizeOf({ ...conversation, messages: [] });

  let index = 0;
  while (index < conversation.messages.length) {
    const messages: ChatConversation["messages"] = [];
    let bytes = envelope;

    while (index < conversation.messages.length) {
      const message = conversation.messages[index]!;
      const messageBytes = sizeOf(message);
      /*
       * ALWAYS TAKE AT LEAST ONE. A turn larger than the whole budget cannot
       * exist — content and metadata are both bounded well inside it — but a
       * loop that could take zero would spin forever if one ever did, and a
       * conversation nobody can import is worse than a request that is refused
       * and says so.
       */
      if (messages.length > 0 && bytes + messageBytes > IMPORT_MAX_REQUEST_BYTES) break;
      if (messages.length >= MESSAGES_PER_REQUEST_MAX) break;

      messages.push(message);
      bytes += messageBytes;
      index += 1;
    }

    slices.push({
      ...conversation,
      messages,
      positionOffset: index - messages.length,
    });
  }

  return slices;
}

/**
 * Packs the candidates into requests that fit, splitting any that do not.
 *
 * Exported so the sizing can be tested directly against the same bounds the
 * deployment enforces, rather than inferred from a successful run.
 */
export function chunkForImport(candidates: ChatConversation[]): ImportChunk[] {
  const chunks: ImportChunk[] = [];
  let current: ImportChunk = { conversations: [] };
  let bytes = 0;
  let messages = 0;

  function flush(): void {
    if (current.conversations.length > 0) chunks.push(current);
    current = { conversations: [] };
    bytes = 0;
    messages = 0;
  }

  for (const conversation of candidates) {
    const size = sizeOf(conversation);

    /* Too big for any request on its own: send it as its own slices. */
    if (size > IMPORT_MAX_REQUEST_BYTES || conversation.messages.length > MESSAGES_PER_REQUEST_MAX) {
      flush();
      for (const slice of sliceConversation(conversation)) {
        chunks.push({ conversations: [slice] });
      }
      continue;
    }

    const wouldExceed =
      current.conversations.length >= CONVERSATIONS_PER_REQUEST_MAX ||
      bytes + size > IMPORT_MAX_REQUEST_BYTES ||
      messages + conversation.messages.length > MESSAGES_PER_REQUEST_MAX;

    if (wouldExceed) flush();

    current.conversations.push(conversation);
    bytes += size;
    messages += conversation.messages.length;
  }

  flush();
  return chunks;
}

/**
 * Sends the candidates, request by request, and reports honestly.
 *
 * A FAILED REQUEST STOPS THE RUN rather than skipping past it. Continuing would
 * report a partial import as a complete one, and a person cannot see the
 * difference between "nine of twelve arrived" and "twelve arrived" by looking
 * at a History panel they have never seen full. So the summary carries the
 * error, the prompt stays available, and Import resumes — idempotently, because
 * every write is matched on the browser's own ids.
 */
export async function importLocalHistory(
  candidates: ChatConversation[],
): Promise<ImportSummary> {
  const summary: ImportSummary = { imported: [], declined: [], error: null };
  const imported = new Set<string>();

  for (const chunk of chunkForImport(candidates)) {
    try {
      const result = await importConversationBatch(chunk.conversations);
      /* A sliced conversation is reported once, not once per slice. */
      for (const id of result.imported) imported.add(id);
      summary.declined.push(...result.declined);
    } catch (error) {
      summary.error =
        error instanceof Error && error.message
          ? error.message
          : "Ask Sunny could not finish importing. Nothing on this device was changed.";
      summary.imported = [...imported];
      return summary;
    }
  }

  summary.imported = [...imported];
  return summary;
}
