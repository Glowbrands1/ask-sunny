"use client";

import type { ChatConversation } from "@/types";
import type { IneligibleReason } from "./client-ids";
import { importConversationBatch } from "./client";
import { CONVERSATIONS_PER_REQUEST_MAX, partitionConversations } from "./payload";

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
 * Only conversations that are BOTH eligible AND missing from the account.
 *
 * Eligible excludes the six seeded demo threads that the store writes into
 * every browser, in both modes, because the `chat_conversations` persist effect
 * has no demo-mode guard. `conv-seed-1 … conv-seed-6` are fabricated: nobody
 * asked them and Sunny never answered them. They are filtered here so they are
 * never counted in a prompt, and refused again server-side so a stale client
 * build cannot smuggle one through.
 *
 * ============================================================================
 * RESUMABLE BY CONSTRUCTION
 * ============================================================================
 *
 * Batches of ten, each one idempotent server-side. A refresh, a crash, a
 * dropped connection or a second press of Import re-sends what may already be
 * there and converges on one conversation with one copy of each turn — so
 * "resume" needs no checkpoint, no cursor and no cleanup. It is just Import
 * again.
 */

export interface ImportSummary {
  /** Conversations now on the account because of this run. */
  imported: string[];
  /** What could not be brought over, and why. Reported rather than dropped. */
  declined: { id: string | null; reason: IneligibleReason }[];
  /**
   * Set when a batch failed. The conversations already written stay written;
   * pressing Import again continues from where this stopped.
   */
  error: string | null;
}

/**
 * The conversations in this browser that are worth offering to import.
 *
 * `storedIds` is what the account already holds, so a second run offers only
 * what is genuinely missing and a person who has already imported sees no
 * prompt at all.
 */
export function eligibleForImport(
  local: ChatConversation[],
  storedIds: readonly string[],
): ChatConversation[] {
  const stored = new Set(storedIds);
  const { eligible } = partitionConversations(local);
  const eligibleIds = new Set(eligible.map((payload) => payload.clientConversationId));

  /*
   * The PAYLOADS say which ids passed validation; the CONVERSATIONS are what
   * gets sent, because the server re-parses them itself and re-parsing its own
   * normalised output would be this browser deciding what the server sees.
   */
  return local.filter(
    (conversation) =>
      eligibleIds.has(conversation.id) && !stored.has(conversation.id),
  );
}

/** Splits a list into batches the import endpoint will accept. */
function batches<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Sends the candidates, batch by batch, and reports honestly.
 *
 * A FAILED BATCH STOPS THE RUN rather than skipping past it. Continuing would
 * report a partial import as a complete one, and a person cannot see the
 * difference between "nine of twelve arrived" and "twelve arrived" by looking
 * at a History panel they have never seen full. So the summary carries the
 * error, the prompt stays available, and Import resumes.
 */
export async function importLocalHistory(
  candidates: ChatConversation[],
): Promise<ImportSummary> {
  const summary: ImportSummary = { imported: [], declined: [], error: null };

  for (const batch of batches(candidates, CONVERSATIONS_PER_REQUEST_MAX)) {
    try {
      const result = await importConversationBatch(batch);
      summary.imported.push(...result.imported);
      summary.declined.push(...result.declined);
    } catch (error) {
      summary.error =
        error instanceof Error && error.message
          ? error.message
          : "Ask Sunny could not finish importing. Nothing on this device was changed.";
      return summary;
    }
  }

  return summary;
}
