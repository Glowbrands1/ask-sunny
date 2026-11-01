import { truncationRetryBudgetEnabled } from "@/lib/config/chat-quality-flags";

import { AiError } from "./errors";

/**
 * ============================================================================
 * A RESPONSE THAT RAN OUT OF ROOM IS NOT AN ANSWER
 * ============================================================================
 *
 * TRUNCATION_RETRY_ENABLED (QA, live, 1 Nov 2026; ported from Ask Bubbles,
 * where it is always on). A "Daily Stats" answer stopped mid-sentence ("…keep
 * an eye on whether new-customer counts (strong on Oct 30") and was shown as
 * if it were the whole reply: the model reached `max_tokens`, and thinking
 * shares that budget with the answer, so a long think left little room.
 *
 * So `stopReason: "max_tokens"` is checked: the call is made ONCE MORE with a
 * larger budget. If it is cut off again, nothing from either attempt is used:
 * the caller gets an `AiError("truncated")` whose message says what was not
 * done. The configured budgets are unchanged (QA: no higher cap, cost).
 */

/** The budget a retry may grow to. Above the largest configured budget. */
export const TRUNCATION_RETRY_CEILING = 16_000;

/**
 * TRUNCATION_RETRY_BUDGET_ENABLED (QA, 1 Nov 2026): a first attempt that
 * already took longer than this starts no retry, so one turn never stacks two
 * long attempts past the route's 120 s ceiling (`maxDuration` on /api/chat).
 * Live, a cut-off Daily Stats briefing took about 31 s and its retry 36 s.
 */
export const TRUNCATION_RETRY_START_LIMIT_MS = 50_000;

export function wasTruncated(stopReason: string | null | undefined): boolean {
  return stopReason === "max_tokens";
}

/** The retry's budget: double, within the ceiling, and never less than asked. */
export function retryBudget(maxTokens: number): number {
  return Math.max(maxTokens, Math.min(maxTokens * 2, TRUNCATION_RETRY_CEILING));
}

/**
 * Makes the call; if it ran out of room, makes it again with a larger budget;
 * if that ran out of room too, throws `AiError("truncated", message)`.
 */
export async function withTruncationRetry<T extends { readonly stopReason: string | null }>(
  maxTokens: number,
  call: (maxTokens: number) => Promise<T>,
  message: string,
): Promise<T> {
  const started = Date.now();
  const first = await call(maxTokens);
  if (!wasTruncated(first.stopReason)) return first;
  const took = Date.now() - started;
  if (truncationRetryBudgetEnabled() && took > TRUNCATION_RETRY_START_LIMIT_MS) {
    console.warn(`[ai] response cut off at max_tokens=${maxTokens} after ${took} ms; no retry (budget)`);
    throw new AiError("truncated", message, 502);
  }

  const larger = retryBudget(maxTokens);
  console.warn(`[ai] response cut off at max_tokens=${maxTokens}; retrying once with ${larger}`);
  if (larger > maxTokens) {
    const second = await call(larger);
    if (!wasTruncated(second.stopReason)) return second;
  }

  console.warn(`[ai] response cut off again at max_tokens=${larger}; nothing from it is used`);
  throw new AiError("truncated", message, 502);
}
