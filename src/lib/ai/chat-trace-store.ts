import { AsyncLocalStorage } from "node:async_hooks";

import type { ErrorSubtype, ModelCallSnapshot } from "./model-failure";

/**
 * One in-flight chat trace. Present only when CHAT_TRACE_ENABLED is on.
 * AsyncLocalStorage keeps concurrent turns from writing into each other.
 */

export interface RetrievedTraceRow {
  readonly id: string;
  readonly title: string;
  readonly section: string | null;
  readonly score: number;
}

export interface ChatTraceDraft {
  startedAt: number;
  conversationId: string | null;
  messageId: string | null;
  userId: string | null;
  originalQuery: string;
  rewrittenQuery: string | null;
  intent: string | null;
  retrievalCount: number | null;
  retrieved: RetrievedTraceRow[];
  prompt: string | null;
  formInProgress: boolean;
  modelCall: ModelCallSnapshot | null;
  errorSubtype: ErrorSubtype | null;
  errorClass: string | null;
  errorStatus: number | null;
  succeeded: boolean | null;
  /** Slots after this turn. Absent when the turn did not settle a form. */
  slots?: Record<string, unknown> | null;
}

const storage = new AsyncLocalStorage<ChatTraceDraft>();

export function runChatTrace<T>(draft: ChatTraceDraft, fn: () => Promise<T>): Promise<T> {
  return storage.run(draft, fn);
}

export function updateChatTrace(patch: Partial<ChatTraceDraft>): void {
  const draft = storage.getStore();
  if (!draft) return;
  Object.assign(draft, patch);
}

export function chatTraceDraft(): ChatTraceDraft | undefined {
  return storage.getStore();
}
