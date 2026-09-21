import type { ChatConversation } from "@/types";
import { ChatSyncFailure } from "./client";

/**
 * ============================================================================
 * KEEPING THE ACCOUNT'S COPY IN STEP, WITHOUT EVER PUTTING THE THREAD AT RISK
 * ============================================================================
 *
 * The contract this exists to hold, in the order it matters:
 *
 *   A FAILED SAVE COSTS NOTHING THAT WAS ON SCREEN. The question the person
 *   typed and the answer Sunny gave are already in React state and already in
 *   IndexedDB before this is ever called. Nothing here writes to either, and
 *   nothing here can remove either. The worst outcome of a total server outage
 *   is the product behaving exactly as it did before this phase.
 *
 *   A RETRY NEVER DUPLICATES. Each save sends the WHOLE thread and the server
 *   matches it on `(user_id, client_conversation_id)` and each turn on
 *   `(conversation_id, client_message_id)`. So re-sending is convergence, not
 *   accumulation — which is what makes an aggressive retry safe at all.
 *
 *   ONE SAVE AT A TIME, AND THE LATEST SNAPSHOT WINS. Queueing a conversation
 *   that is already queued REPLACES what was waiting rather than adding to it,
 *   so a fast conversation produces one save per pause instead of one per
 *   keystroke-worth of state change. And because saves run sequentially, two
 *   writes for the same thread can never be in flight at once and race.
 *
 * ============================================================================
 * WHY IT RETRIES SOME FAILURES AND NOT OTHERS
 * ============================================================================
 *
 * A 503 is a database that was briefly unreachable: the same request will work
 * shortly, and backing off is right. A 400 is a conversation the server will
 * never accept — a seeded demo thread, a malformed record — and retrying it is
 * an invisible loop. A 401 or 403 means the session has ended or the person
 * lacks the permission; the honest response is to stop, stay local, and let the
 * surface say so.
 *
 * `ChatSyncFailure` carries that decision from the fetch layer rather than
 * having this module re-derive it from a status code, so there is one place
 * that knows which failures are worth a second attempt.
 */

export type ConversationSyncStatus = "pending" | "synced" | "error";

export interface ConversationSyncOptions {
  save: (conversation: ChatConversation) => Promise<void>;
  /** Injectable so backoff is testable without waiting for real seconds. */
  delay?: (ms: number) => Promise<void>;
  /** Attempts per conversation before it is left as an error for a person to retry. */
  maxAttempts?: number;
}

export interface ConversationSync {
  /** Queue the current state of a conversation. Replaces any pending snapshot. */
  queue(conversation: ChatConversation): void;
  /** Re-arm everything that gave up, for a "Try again" control. */
  retryFailed(): void;
  /** Forget a conversation that no longer exists locally. */
  forget(id: string): void;
  /** Forget everything — what clearing the whole history calls. */
  reset(): void;
  status(id: string): ConversationSyncStatus | undefined;
  /**
   * Every conversation's state in one object.
   *
   * Returned whole rather than read one id at a time so a subscriber does not
   * need the current conversation list to build it — which is what kept a ref
   * being written during render.
   */
  statuses(): Record<string, ConversationSyncStatus>;
  /** True when anything is waiting or failed — what a surface renders from. */
  hasFailures(): boolean;
  subscribe(listener: () => void): () => void;
  /** Resolves when nothing is in flight or waiting. A test seam. */
  settled(): Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 4;

/** 0.5s, 1s, 2s, 4s. Short enough to recover a blip, long enough not to flood. */
function backoffMs(attempt: number): number {
  return 500 * 2 ** Math.max(0, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createConversationSync(
  options: ConversationSyncOptions,
): ConversationSync {
  const { save, delay = sleep, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;

  /** The newest snapshot waiting to be saved, per conversation. */
  const pending = new Map<string, ChatConversation>();
  /** The snapshot that failed, kept so "Try again" has something to send. */
  const failed = new Map<string, ChatConversation>();
  const statuses = new Map<string, ConversationSyncStatus>();
  const listeners = new Set<() => void>();

  let running = false;
  let settledWaiters: (() => void)[] = [];

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function setStatus(id: string, status: ConversationSyncStatus): void {
    if (statuses.get(id) === status) return;
    statuses.set(id, status);
    notify();
  }

  function releaseSettled(): void {
    const waiters = settledWaiters;
    settledWaiters = [];
    for (const waiter of waiters) waiter();
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;

    try {
      while (pending.size > 0) {
        const [id, queued] = pending.entries().next().value as [
          string,
          ChatConversation,
        ];
        pending.delete(id);
        /* Reassigned below when a newer snapshot supersedes a failed attempt. */
        let conversation = queued;

        let attempt = 0;
        for (;;) {
          attempt += 1;
          try {
            await save(conversation);
            failed.delete(id);
            /*
             * A NEWER SNAPSHOT ARRIVED WHILE THIS ONE WAS IN FLIGHT, so the
             * account's copy is already behind again. Reporting "synced" here
             * would be true of the version that was sent and misleading about
             * the conversation, which is what the person is actually asking
             * about.
             */
            setStatus(id, pending.has(id) ? "pending" : "synced");
            break;
          } catch (error) {
            const retryable =
              error instanceof ChatSyncFailure ? error.retryable : true;

            if (!retryable || attempt >= maxAttempts) {
              /*
               * GIVING UP IS NOT LOSING ANYTHING. The thread is in React state
               * and in IndexedDB; this only means the account's copy is stale,
               * and the surface says so with a way to try again.
               */
              failed.set(id, conversation);
              setStatus(id, "error");
              break;
            }

            await delay(backoffMs(attempt));
            /* A newer snapshot supersedes the one that failed. */
            const newer = pending.get(id);
            if (newer) {
              pending.delete(id);
              conversation = newer;
            }
          }
        }
      }
    } finally {
      running = false;
      if (pending.size === 0) releaseSettled();
    }
  }

  return {
    queue(conversation) {
      pending.set(conversation.id, conversation);
      setStatus(conversation.id, "pending");
      void pump();
    },

    retryFailed() {
      if (failed.size === 0) return;
      for (const [id, conversation] of failed) {
        pending.set(id, conversation);
        setStatus(id, "pending");
      }
      failed.clear();
      void pump();
    },

    forget(id) {
      pending.delete(id);
      failed.delete(id);
      if (statuses.delete(id)) notify();
    },

    reset() {
      pending.clear();
      failed.clear();
      const had = statuses.size > 0;
      statuses.clear();
      if (had) notify();
    },

    status(id) {
      return statuses.get(id);
    },

    statuses() {
      return Object.fromEntries(statuses);
    },

    hasFailures() {
      return failed.size > 0;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    settled() {
      if (!running && pending.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        settledWaiters.push(resolve);
      });
    },
  };
}
