import { AI_MAX_RETRIES, deadlineMarginMs, routeMaxMs } from "@/lib/config/ai-timeouts";

import { aiRequestStartedAt, currentAiRoute } from "./ai-route";
import { AiError } from "./errors";

/**
 * ============================================================================
 * A HARD TIME LIMIT ON ONE AI CALL (QA, 14 Nov 2026)
 * ============================================================================
 *
 * The SDK's own `timeout` stops waiting once the response headers arrive, and
 * an aborted stream ends quietly, so neither bounds a streamed answer. This
 * does: the call gets an abort signal and the limit is raced against it, so the
 * whole call — the SDK's retries included — ends by `limitMs`. On a timeout:
 *
 *   - one server log line: route, call name, duration, limit (no request text,
 *     no names, no answer);
 *   - an `AiTimeLimitError`, an AiError with a short message written to be
 *     shown, so the manager sees a reply and never an empty one.
 *
 * Nothing else about the call changes, and a call that finishes in time
 * returns exactly what it would have.
 */

export const AI_TIMEOUT_MESSAGE = "Sunny took too long to answer, so nothing was sent. Please try again in a moment.";

/** Which limit ran out: the whole call, the wait for the first token, a gap between chunks, or the stream's total. */
export type TimeLimitKind = "call" | "first_token" | "gap" | "total";

export class AiTimeLimitError extends AiError {
  readonly call: string;
  readonly limitMs: number;
  readonly kind: TimeLimitKind;

  constructor(call: string, limitMs: number, kind: TimeLimitKind = "call") {
    super("model_failed", AI_TIMEOUT_MESSAGE, 504);
    this.name = "AiTimeLimitError";
    this.call = call;
    this.limitMs = limitMs;
    this.kind = kind;
  }
}

export function isAiTimeLimitError(error: unknown): error is AiTimeLimitError {
  return error instanceof AiTimeLimitError;
}

/** The options handed to the SDK call: the overall signal, the per-attempt timeout, the retry count. */
export interface TimedCallOptions {
  readonly signal: AbortSignal;
  readonly timeout: number;
  readonly maxRetries: number;
}

/** The server log line for a timed-out call. Counts and names of code only. */
export function logAiTimeout(call: string, durationMs: number, limitMs: number, route = currentAiRoute(), kind: TimeLimitKind = "call"): void {
  const which = kind === "call" ? "" : ` limit=${kind}`;
  console.error(
    `[ai.timeout] route=${route} call=${call} duration_ms=${Math.round(durationMs)} limit_ms=${Math.round(limitMs)}${which}`,
  );
}

/**
 * The server log line for a failed call that was not a timeout. The SDK error
 * can echo the request, so only its status and type are read.
 */
export function logAiFailure(call: string, durationMs: number, error: unknown, route = currentAiRoute()): void {
  console.error(
    `[ai.failure] route=${route} call=${call} duration_ms=${Math.round(durationMs)} error=${describeAiError(error)}`,
  );
}

/** Status, error type and class name. Never the message: it can carry the request. */
export function describeAiError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof AiError) return `AiError ${error.code} ${error.status}`;
  const record = (error && typeof error === "object" ? error : {}) as {
    status?: unknown;
    name?: unknown;
    error?: { type?: unknown };
  };
  const parts = [
    typeof record.status === "number" ? `HTTP ${record.status}` : null,
    typeof record.error?.type === "string" ? record.error.type : null,
    error instanceof Error ? error.constructor.name : typeof record.name === "string" ? record.name : null,
  ];
  return parts.filter(Boolean).join(" ") || "unknown";
}

/**
 * Runs `run` with a hard limit. `run` gets the options to pass to the SDK
 * call; a caller that cannot take them (or does not need to) may ignore them,
 * and the limit still holds — the caller is no longer waited on.
 */
export async function withAiTimeLimit<T>(
  call: string,
  limitMs: number,
  run: (options: TimedCallOptions) => Promise<T>,
  settings: { readonly maxRetries?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  // performance.now, not Date.now: the variation report freezes Date.
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      // Rejected before the abort, so the race settles on the timeout and not on a stream the abort ended quietly.
      reject(new AiTimeLimitError(call, limitMs));
      controller.abort();
    }, limitMs);
  });
  // Never an unhandled rejection when the call wins.
  deadline.catch(() => {});
  try {
    const result = await Promise.race([
      run({ signal: controller.signal, timeout: limitMs, maxRetries: settings.maxRetries ?? AI_MAX_RETRIES }),
      deadline,
    ]);
    if (timedOut) throw new AiTimeLimitError(call, limitMs);
    return result;
  } catch (error) {
    if (timedOut || isAiTimeLimitError(error)) {
      logAiTimeout(call, performance.now() - started, limitMs);
      throw error instanceof AiTimeLimitError ? error : new AiTimeLimitError(call, limitMs);
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** What a streamed call reports as it reads its stream (`collectModelResult`). */
export interface StreamWatch {
  /** A new attempt starts (a truncation retry): it waits for its own first token again. */
  attempt(): void;
  /** The first text (or tool call) arrived: from now on only the gap between chunks is limited. */
  firstToken(): void;
  /** Any stream event arrived. */
  chunk(): void;
}

/**
 * A streamed call's limits (QA, 14 Nov 2026, from production's long answers):
 * `firstTokenMs` for its first token, then `gapMs` between any two chunks,
 * and `totalMs` in all, the SDK's retries included. A call that keeps
 * streaming is never cut short of `totalMs`. On a timeout: the same message
 * and one log line naming which limit ran out.
 */
export async function withStreamTimeLimit<T>(
  call: string,
  limits: { readonly firstTokenMs: number; readonly gapMs: number; readonly totalMs: number },
  run: (options: TimedCallOptions, watch: StreamWatch) => Promise<T>,
  settings: { readonly maxRetries?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const started = performance.now();
  let phaseTimer: ReturnType<typeof setTimeout> | undefined;
  let streaming = false;
  let failed: AiTimeLimitError | null = null;
  let reject: (error: AiTimeLimitError) => void = () => {};
  const deadline = new Promise<never>((_, rejectWith) => {
    reject = rejectWith;
  });
  deadline.catch(() => {});
  const fail = (kind: TimeLimitKind, limitMs: number) => {
    if (failed) return;
    failed = new AiTimeLimitError(call, limitMs, kind);
    // Rejected before the abort, so the race settles on the timeout and not on a stream the abort ended quietly.
    reject(failed);
    controller.abort();
  };
  const arm = (kind: TimeLimitKind, limitMs: number) => {
    if (failed) return;
    if (phaseTimer !== undefined) clearTimeout(phaseTimer);
    phaseTimer = setTimeout(() => fail(kind, limitMs), limitMs);
  };
  const watch: StreamWatch = {
    attempt: () => {
      streaming = false;
      arm("first_token", limits.firstTokenMs);
    },
    firstToken: () => {
      streaming = true;
      arm("gap", limits.gapMs);
    },
    chunk: () => {
      if (streaming) arm("gap", limits.gapMs);
    },
  };
  watch.attempt();
  const totalMs = deadlineAwareTotalMs(limits.totalMs);
  const totalTimer = setTimeout(() => fail("total", totalMs), totalMs);
  try {
    const result = await Promise.race([
      run({ signal: controller.signal, timeout: limits.firstTokenMs, maxRetries: settings.maxRetries ?? AI_MAX_RETRIES }, watch),
      deadline,
    ]);
    if (failed) throw failed;
    return result;
  } catch (error) {
    const timedOut: AiTimeLimitError | null = failed ?? (isAiTimeLimitError(error) ? error : null);
    if (timedOut) {
      logAiTimeout(call, performance.now() - started, timedOut.limitMs, currentAiRoute(), timedOut.kind);
      throw timedOut;
    }
    throw error;
  } finally {
    if (phaseTimer !== undefined) clearTimeout(phaseTimer);
    clearTimeout(totalTimer);
  }
}

/**
 * A stream's total limit, cut to the time left before the route's maxDuration less the margin (QA, 14 Nov 2026), so
 * a slow turn ends with the message and a log line, never the platform's kill. Outside a route, the limit as given.
 * Never below one second.
 */
export function deadlineAwareTotalMs(totalMs: number, now: number = Date.now()): number {
  const started = aiRequestStartedAt();
  if (started === null) return totalMs;
  const left = started + routeMaxMs() - deadlineMarginMs() - now;
  return Math.max(1_000, Math.min(totalMs, left));
}
