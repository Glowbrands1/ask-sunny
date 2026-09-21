"use client";

import type { ChatConversation } from "@/types";
import type { IneligibleReason } from "./client-ids";
import type { HistoryState } from "./suppression";

/**
 * TALKING TO THE HISTORY ENDPOINTS FROM THE BROWSER.
 *
 * ONE SEAM, for the same reason `lib/feedback/client.ts` is one: several
 * surfaces write conversations, and if each knew the URL then the day the
 * endpoint grows a field is the day most of them quietly stop sending it.
 *
 * NOTHING HERE DECIDES WHO YOU ARE. There is no id, email or token in any of
 * these calls — the session travels as the HTTP-only Supabase cookie the
 * browser cannot read, and the server resolves it. A helper that took a user id
 * would be a helper somebody could pass a different one to.
 */

/**
 * Whether a failed call is worth trying again.
 *
 * The distinction is the whole reason this class exists rather than a bare
 * `Error`. A 503 means the database was briefly unreachable and the same
 * request will work in a moment; a 400 means this conversation will never be
 * accepted and retrying it forever would be a loop nobody can see. A 401 means
 * the session ended, and the right response is to stop and stay local — not to
 * hammer an endpoint that will keep refusing.
 */
export class ChatSyncFailure extends Error {
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ChatSyncFailure";
    this.status = status;
    this.retryable = retryable;
  }
}

async function failureFrom(response: Response): Promise<ChatSyncFailure> {
  let message = "Ask Sunny could not reach your account history.";
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      message = payload.error;
    }
  } catch {
    /* A body that is not JSON tells us nothing useful; the status already did. */
  }

  /*
   * 5xx and 429 are worth retrying. 4xx is not: the request is wrong, the
   * session is gone, or the conversation is one the server will not store, and
   * none of those improve by being asked again.
   */
  const retryable = response.status >= 500 || response.status === 429;
  return new ChatSyncFailure(message, response.status, retryable);
}

/** A network error — offline, a dropped connection — is always worth retrying. */
function offline(error: unknown): ChatSyncFailure {
  return new ChatSyncFailure(
    error instanceof Error && error.message
      ? "Ask Sunny could not reach your account history."
      : "Ask Sunny could not reach your account history.",
    0,
    true,
  );
}

/** This person's own history. The server has no way to return anybody else's. */
export async function fetchOwnConversations(): Promise<ChatConversation[]> {
  let response: Response;
  try {
    response = await fetch("/api/chat/conversations");
  } catch (error) {
    throw offline(error);
  }
  if (!response.ok) throw await failureFrom(response);

  const payload = (await response.json()) as { conversations?: ChatConversation[] };
  return payload.conversations ?? [];
}

/**
 * Saves one conversation, whole.
 *
 * THE WHOLE THREAD, EVERY TIME — not a delta. The browser cannot know what a
 * request that timed out mid-flight actually stored, and the server's
 * per-message uniqueness turns a full re-send into convergence. A delta would
 * need the browser to be right about that, and it cannot be.
 */
export async function saveOwnConversation(
  conversation: ChatConversation,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation }),
    });
  } catch (error) {
    throw offline(error);
  }
  if (!response.ok) throw await failureFrom(response);
}

/** Deletes one of this person's conversations from their account. */
export async function deleteOwnConversation(id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    throw offline(error);
  }
  if (!response.ok) throw await failureFrom(response);
}

/** Clears this person's whole account history. */
export async function clearOwnConversations(): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/chat/conversations", { method: "DELETE" });
  } catch (error) {
    throw offline(error);
  }
  if (!response.ok) throw await failureFrom(response);
}

/**
 * What the account says about this person's history.
 *
 * Read on every hydration, because it carries the three things this browser
 * cannot work out for itself: what is already stored and how much of it, what
 * was DELETED, and when history was last CLEARED. The last two are what stop a
 * stale local copy resurrecting a conversation somebody removed on another
 * device.
 *
 * Ids and counts only. No titles, no turns, no content in either direction.
 */
export async function fetchHistoryState(): Promise<HistoryState> {
  let response: Response;
  try {
    response = await fetch("/api/chat/conversations/import");
  } catch (error) {
    throw offline(error);
  }
  if (!response.ok) throw await failureFrom(response);

  const payload = (await response.json()) as Partial<HistoryState>;
  return {
    stored: Array.isArray(payload.stored) ? payload.stored : [],
    deleted: Array.isArray(payload.deleted) ? payload.deleted : [],
    clearedAt: typeof payload.clearedAt === "string" ? payload.clearedAt : null,
  };
}

export interface ImportBatchResult {
  imported: string[];
  declined: { id: string | null; reason: IneligibleReason }[];
}

/**
 * Sends ONE batch of historical conversations.
 *
 * Called only from the Import button. Never on mount, never on sign-in, never
 * from a retry loop that a person did not start.
 */
export async function importConversationBatch(
  conversations: (ChatConversation & { positionOffset?: number })[],
): Promise<ImportBatchResult> {
  let response: Response;
  try {
    response = await fetch("/api/chat/conversations/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversations }),
    });
  } catch (error) {
    throw offline(error);
  }
  if (!response.ok) throw await failureFrom(response);

  const payload = (await response.json()) as Partial<ImportBatchResult>;
  return { imported: payload.imported ?? [], declined: payload.declined ?? [] };
}
