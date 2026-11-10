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
  /** FORM_EDIT_TOOL_IN_STREAM_ENABLED: `slots.form_edit` — keys and reasons only. Absent when the flag is off. */
  formEdit?: Record<string, unknown>;
  /**
   * FORM_EDIT_SINGLE_WRITER_ENABLED: the post-draft consistency check, written
   * to `slots.draft_check` — `{ checked, missing_keys }`, the kinds of fact
   * left out ("name", "date", "amount"), never their values. Absent when the
   * check did not run.
   */
  draftCheck?: Record<string, unknown>;
  /**
   * CHAT_STAGE_TIMINGS_ENABLED: how long each awaited step of the turn took, written to `slots.stages`. Names and
   * milliseconds only (from the request's receipt), never content. Absent when the flag is off.
   */
  stages?: ChatStageTiming[];
  /** CHAT_STAGE_TIMINGS_ENABLED: the request's receipt, which `stages` count from. */
  stagesFrom?: number;
  /**
   * The form extraction for this turn, when FORM_FULL_REMAP_ENABLED is on.
   * `slots` is the same record the card was filled from.
   */
  formExtraction?: {
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    slots: Record<string, unknown>;
  } | null;
}

/** CHAT_STAGE_TIMINGS_ENABLED: one awaited step — its name, when it started and how long it took (-1 while open), in ms from the request's receipt. */
export interface ChatStageTiming {
  readonly name: string;
  readonly startMs: number;
  readonly ms: number;
}

const storage = new AsyncLocalStorage<ChatTraceDraft>();

/** When POST /api/chat received the request. Separate from the model-call clock. */
const requestClock = new AsyncLocalStorage<number>();

export function enterChatRequestClock(at = Date.now()): void {
  requestClock.enterWith(at);
}

export function runWithRequestClock<T>(fn: () => Promise<T>, at = Date.now()): Promise<T> {
  return requestClock.run(at, fn);
}

/** Request receipt, then the trace start, then now. */
export function chatRequestReceivedAt(): number {
  const marked = requestClock.getStore();
  if (typeof marked === "number") return marked;
  return chatTraceDraft()?.startedAt ?? Date.now();
}

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
