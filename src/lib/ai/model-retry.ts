import { modelRetryEnabled } from "@/lib/config/chat-quality-flags";

import { AiError } from "./errors";

/**
 * Timeouts and a plain overloaded message.
 *
 * Off, the caller omits request options, so the SDK's own timeout and
 * retry count stay in force and a failure keeps today's wording.
 */

export const MODEL_TIMEOUT_MS = 45_000;
export const MODEL_MAX_RETRIES = 2;

export const MODEL_BUSY_MESSAGE =
  "Sunny is busy right now and could not finish that answer. Please send it again in a moment.";

export function modelRequestOptions(): { timeout: number; maxRetries: number } | undefined {
  if (!modelRetryEnabled()) return undefined;
  return { timeout: MODEL_TIMEOUT_MS, maxRetries: MODEL_MAX_RETRIES };
}

export function modelUnavailable(error: unknown): AiError {
  if (modelRetryEnabled() && isOverloaded(error)) {
    return new AiError("model_failed", MODEL_BUSY_MESSAGE, 503);
  }
  return new AiError(
    "model_failed",
    "Sunny could not reach the language model. No answer was generated.",
    502,
  );
}

function isOverloaded(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown; error?: { type?: unknown } };
  return record.status === 529 || record.error?.type === "overloaded_error";
}
