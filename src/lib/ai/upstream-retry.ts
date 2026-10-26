import { APIConnectionError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";

import { MissingConfigurationError } from "@/lib/config/server-env";

import { AiError } from "./errors";
import type { ErrorSubtype } from "./model-failure";
import { waitBeforeRetry } from "./retry-wait";

/**
 * ============================================================================
 * THE ANSWER'S MODEL CALL, TRIED AGAIN ON A RETRYABLE UPSTREAM ERROR
 * ============================================================================
 *
 * Behind CHAT_UPSTREAM_RETRY_ENABLED. Under load (three parallel chats from
 * one login) about one chat in thirteen failed with `model_failed` 502 —
 * "No answer was produced" in the browser — after about 30 s. The SDK's own
 * retries cover only an HTTP status, and wait as long as `retry-after` says;
 * an `overloaded_error` that arrives inside a 200 stream is never retried at
 * all. With the flag on the SDK's retries are turned off for this call and
 * this loop owns the count: up to two more attempts, about 1 s and then 3 s
 * apart, never starting one past the turn's budget.
 *
 * EVERY ATTEMPT HAS ITS OWN DEADLINE: the lesser of 45 s and what is left of
 * the turn's budget. It is passed to the SDK as `timeout`, and the attempt is
 * also abandoned (its request aborted) when it runs out, because the SDK's
 * timeout stops at the response headers and a stream can stall after them.
 * So a retry that starts late cannot hang into the platform's 300 s 504: the
 * turn ends with the usual `model_failed` error inside the budget.
 *
 * ONLY THE CHAT ANSWER ASKS FOR THIS (`upstreamRetry` on `callClaude`). The
 * Sales Totals analysis and the forms ingest refinement also call
 * `callClaude`; they keep the SDK's own retries and its timeout, because a
 * 45 s deadline and the chat turn's budget would turn their slow successes
 * into failures.
 *
 * Retried: 429, 529 and any other 5xx, an `overloaded_error`, `api_error` or
 * `rate_limit_error` streamed after the 200, and a dropped connection.
 * Never retried: 400 and every other request error, a refusal or empty
 * answer (an `AiError`), missing configuration, and a caller's abort.
 *
 * NOTHING HERE READS AN ERROR MESSAGE. The SDK's error can echo the request,
 * which carries policy text and named employees. The status, the error type
 * and the class are all that is logged.
 */

/** Waits before the second and third attempts. */
export const UPSTREAM_RETRY_DELAYS_MS = [1_000, 3_000] as const;

/** A `retry-after` longer than the backoff is honoured up to this. */
export const UPSTREAM_RETRY_AFTER_CAP_MS = 10_000;

/**
 * No retry starts later than this after the turn started. The chat route
 * sets no `maxDuration`, so the platform default (300 s) applies; starting
 * the last attempt by 120 s leaves it the rest of that budget to finish.
 */
export const UPSTREAM_RETRY_BUDGET_MS = 120_000;

/** The most one attempt may take. */
export const UPSTREAM_ATTEMPT_TIMEOUT_MS = 45_000;

/**
 * The least an attempt is given. A retry starts only when this much budget is
 * left after its wait, so only a first attempt that begins in the budget's
 * last few seconds can run past it, and then by at most this.
 */
export const UPSTREAM_MIN_ATTEMPT_MS = 5_000;

/** What one attempt is given: its deadline, for the SDK and for the abort. */
export interface UpstreamAttempt {
  readonly timeout: number;
  readonly signal: AbortSignal;
}

/** Thrown when an attempt reaches its deadline. Retryable, like a timeout. */
export class UpstreamAttemptTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The model call did not finish within ${timeoutMs} ms.`);
    this.name = "UpstreamAttemptTimeout";
  }
}

const RETRYABLE_TYPES = new Set(["overloaded_error", "api_error", "rate_limit_error"]);
const SOCKET_CODES = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET"]);

export interface UpstreamFailure {
  /** "429", "529", "503", "overloaded_error", "connection" … never a message. */
  readonly code: string;
  readonly retryable: boolean;
  /** The subtype chat_traces should carry, or null to keep the usual reading. */
  readonly subtype: ErrorSubtype | null;
  /** From `retry-after-ms` or `retry-after`, when the upstream sent one. */
  readonly retryAfterMs: number | null;
}

export function describeUpstreamError(error: unknown): UpstreamFailure {
  if (error instanceof UpstreamAttemptTimeout) {
    return { code: "timeout", retryable: true, subtype: "timeout", retryAfterMs: null };
  }
  if (error instanceof AiError || error instanceof MissingConfigurationError || error instanceof APIUserAbortError) {
    return { code: error instanceof AiError ? error.code : "not_upstream", retryable: false, subtype: null, retryAfterMs: null };
  }
  if (error instanceof APIConnectionError) {
    return { code: "connection", retryable: true, subtype: null, retryAfterMs: null };
  }
  const status = readStatus(error);
  const type = readErrorType(error);
  const retryAfterMs = readRetryAfterMs(error);
  if (status !== null) {
    const retryable = status === 429 || status >= 500;
    return { code: String(status), retryable, subtype: subtypeFor(status, type), retryAfterMs };
  }
  if (type !== null) {
    return { code: type, retryable: RETRYABLE_TYPES.has(type), subtype: subtypeFor(null, type), retryAfterMs };
  }
  const socket = readSocketCode(error);
  if (socket !== null) return { code: socket, retryable: true, subtype: null, retryAfterMs: null };
  return { code: "unknown", retryable: false, subtype: null, retryAfterMs: null };
}

/** One answer's attempts, read by `callClaude` for the trace. */
export interface UpstreamRetryRecord {
  /** Every attempt made, across every call this record was passed to. */
  attempts: number;
  /** True once any call was tried again. */
  retried: boolean;
  last: UpstreamFailure | null;
}

export function newUpstreamRetryRecord(): UpstreamRetryRecord {
  return { attempts: 0, retried: false, last: null };
}

/**
 * Runs `attempt` until it succeeds, a failure is not retryable, its two
 * retries are spent, or the next one would not have its minimum before the
 * budget after `startedAt` runs out. Each attempt gets its own deadline (see
 * above). The last error is thrown unchanged, so the caller's error mapping
 * is what it was. `attemptCapMs` replaces the 45 s cap only when
 * ANSWER_LENGTH_GUARD_ENABLED asks for a longer answer (60 s, see
 * `answer-length-guard.ts`); omitted, nothing here differs.
 */
export async function withUpstreamRetry<T>(
  record: UpstreamRetryRecord,
  startedAt: number,
  attempt: (limits: UpstreamAttempt) => Promise<T>,
  attemptCapMs: number = UPSTREAM_ATTEMPT_TIMEOUT_MS,
): Promise<T> {
  const deadline = startedAt + UPSTREAM_RETRY_BUDGET_MS;
  for (let tries = 1; ; tries += 1) {
    record.attempts += 1;
    const timeout = Math.max(UPSTREAM_MIN_ATTEMPT_MS, Math.min(attemptCapMs, deadline - Date.now()));
    try {
      return await runWithDeadline(timeout, attempt);
    } catch (error) {
      const failure = describeUpstreamError(error);
      record.last = failure;
      const backoff = UPSTREAM_RETRY_DELAYS_MS[tries - 1];
      const wait =
        backoff === undefined
          ? null
          : Math.max(backoff, Math.min(failure.retryAfterMs ?? 0, UPSTREAM_RETRY_AFTER_CAP_MS));
      if (failure.retryable && wait !== null && Date.now() + wait + UPSTREAM_MIN_ATTEMPT_MS <= deadline) {
        console.warn(`[chat] model call attempt ${tries} failed: upstream ${failure.code}; retrying in ${wait} ms`);
        record.retried = true;
        await waitBeforeRetry(wait);
        continue;
      }
      const why = !failure.retryable ? " (not retryable)" : wait === null ? "" : " (out of time)";
      const attempts = `${tries} attempt${tries === 1 ? "" : "s"}`;
      console.warn(`[chat] model call failed after ${attempts}: upstream ${failure.code}${why}`);
      throw error;
    }
  }
}

/**
 * One attempt, abandoned at `timeout`: the deadline rejects first, then the
 * request is aborted so its socket does not linger. Whatever the abandoned
 * attempt settles with afterwards is ignored.
 */
async function runWithDeadline<T>(timeout: number, attempt: (limits: UpstreamAttempt) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new UpstreamAttemptTimeout(timeout));
      controller.abort();
    }, timeout);
  });
  const running = attempt({ timeout, signal: controller.signal });
  running.catch(() => undefined);
  try {
    return await Promise.race([running, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function subtypeFor(status: number | null, type: string | null): ErrorSubtype | null {
  if (status === 429 || type === "rate_limit_error") return "rate_limit";
  if (status === 529 || type === "overloaded_error") return "overloaded";
  if (status === 400 || type === "invalid_request_error") return "bad_request";
  if ((status !== null && status >= 500) || type === "api_error") return "5xx";
  return null;
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * The SDK puts the type on `error.type`, and the response body on
 * `error.error` — so the type is also at `error.error.error.type`. A plain
 * `{ error: { type } }` object is read too.
 */
function readErrorType(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if (error instanceof APIError && typeof error.type === "string") return error.type;
  const body = (error as { error?: unknown }).error;
  if (typeof body !== "object" || body === null) return null;
  const nested = (body as { error?: { type?: unknown } }).error?.type;
  if (typeof nested === "string") return nested;
  const type = (body as { type?: unknown }).type;
  return typeof type === "string" && type !== "error" ? type : null;
}

function readRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof APIError) || !error.headers) return null;
  const ms = Number.parseFloat(error.headers.get("retry-after-ms") ?? "");
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const seconds = Number.parseFloat(error.headers.get("retry-after") ?? "");
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
}

function readSocketCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && SOCKET_CODES.has(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
