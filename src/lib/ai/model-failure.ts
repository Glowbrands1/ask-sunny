import { chatRequestReceivedAt, updateChatTrace } from "./chat-trace-store";

/**
 * What an Anthropic failure was, recorded for chat_traces.
 *
 * The answer path still throws the same AiError. This only classifies the
 * error object callClaude is about to discard, and it never reads the
 * message body — that body can echo the request.
 */

export type ErrorSubtype =
  | "empty_answer"
  | "timeout"
  | "rate_limit"
  | "overloaded"
  | "5xx"
  | "refused"
  | "bad_request"
  | "model_failed";

export interface ModelCallSnapshot {
  readonly model: string;
  readonly maxTokens: number;
  readonly stopReason: string | null;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly thinkingTokens: number | null;
  /** Anthropic usage.cache_creation_input_tokens. Null when the call did not report it. */
  readonly cacheCreationInputTokens: number | null;
  /** Anthropic usage.cache_read_input_tokens. Null when the call did not report it. */
  readonly cacheReadInputTokens: number | null;
  /** Milliseconds until the first text token. Null when the call was not streamed. */
  readonly firstTokenMs: number | null;
  /**
   * Milliseconds from request receipt until this call finished (the last
   * token). `latencyMs` stays the model call alone.
   */
  readonly e2eLatencyMs: number | null;
  readonly errorSubtype: ErrorSubtype | null;
  readonly errorClass: string | null;
  readonly errorStatus: number | null;
  /** True when a later attempt could succeed. This path does not retry. */
  readonly retryable: boolean;
  /** Always false: the answer path does not retry a failed model call. */
  readonly retried: false;
}

const RETRYABLE = new Set<ErrorSubtype>(["timeout", "rate_limit", "overloaded", "5xx"]);

export function classifyDiscardedError(error: unknown): {
  subtype: ErrorSubtype;
  errorClass: string;
  errorStatus: number | null;
} {
  const errorClass = error instanceof Error ? error.constructor.name : typeof error;
  const errorStatus = readStatus(error);
  const type = readErrorType(error);
  const name = error instanceof Error ? error.name : "";
  let subtype: ErrorSubtype = "model_failed";
  if (errorStatus === 429 || type === "rate_limit_error") subtype = "rate_limit";
  else if (errorStatus === 529 || type === "overloaded_error" || /overloaded/i.test(name)) subtype = "overloaded";
  else if (
    errorStatus === 408 ||
    errorStatus === 504 ||
    type === "timeout_error" ||
    /timeout/i.test(name) ||
    /timeout/i.test(errorClass)
  ) {
    subtype = "timeout";
  } else if (errorStatus === 400 || type === "invalid_request_error") subtype = "bad_request";
  else if (errorStatus !== null && errorStatus >= 500) subtype = "5xx";
  return { subtype, errorClass, errorStatus };
}

export function noteModelCall(input: {
  readonly model: string;
  readonly maxTokens: number;
  readonly stopReason: string | null;
  readonly latencyMs: number;
  readonly firstTokenMs?: number | null;
  readonly usage: unknown;
  readonly error?: unknown;
  readonly subtype?: ErrorSubtype | null;
}): void {
  try {
    const discarded = input.error === undefined ? null : classifyDiscardedError(input.error);
    const errorSubtype = input.subtype ?? discarded?.subtype ?? null;
    const snapshot: ModelCallSnapshot = {
      model: input.model,
      maxTokens: input.maxTokens,
      stopReason: input.stopReason,
      latencyMs: input.latencyMs,
      inputTokens: readUsageNumber(input.usage, "input_tokens"),
      outputTokens: readUsageNumber(input.usage, "output_tokens"),
      thinkingTokens: readThinkingTokens(input.usage),
      cacheCreationInputTokens: readUsageNumber(input.usage, "cache_creation_input_tokens"),
      cacheReadInputTokens: readUsageNumber(input.usage, "cache_read_input_tokens"),
      firstTokenMs: input.firstTokenMs ?? null,
      e2eLatencyMs: Math.max(0, Date.now() - chatRequestReceivedAt()),
      errorSubtype,
      errorClass: discarded?.errorClass ?? (errorSubtype ? "AiError" : null),
      errorStatus: discarded?.errorStatus ?? null,
      retryable: errorSubtype !== null && RETRYABLE.has(errorSubtype),
      retried: false,
    };
    updateChatTrace({
      modelCall: snapshot,
      errorSubtype: snapshot.errorSubtype,
      errorClass: snapshot.errorClass,
      errorStatus: snapshot.errorStatus,
    });
  } catch {
    // A trace must not change the answer.
  }
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = error.status;
  return typeof status === "number" ? status : null;
}

function readErrorType(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("error" in error)) return null;
  const body = error.error;
  if (typeof body !== "object" || body === null || !("type" in body)) return null;
  const type = body.type;
  return typeof type === "string" ? type : null;
}

function readUsageNumber(
  usage: unknown,
  key: "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens",
): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  const value = (usage as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function readThinkingTokens(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null || !("output_tokens_details" in usage)) return null;
  const details = usage.output_tokens_details;
  if (typeof details !== "object" || details === null || !("thinking_tokens" in details)) return null;
  const value = details.thinking_tokens;
  return typeof value === "number" ? value : null;
}
