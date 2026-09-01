"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getRateLimiter, RATE_LIMITS } from "@/lib/api/rate-limit";
import {
  checkReviewPassword,
  mintReviewToken,
  REVIEW_COOKIE,
  REVIEW_GATE_PATH,
  REVIEW_PASSWORD_ENV,
  REVIEW_SESSION_SECONDS,
  reviewCookieOptions,
  safeNextPath,
} from "@/lib/reporting-review/gate";

/**
 * SERVER ACTIONS FOR THE TEMPORARY STAKEHOLDER-REVIEW GATE.
 *
 * Everything that touches the password happens here, on the server. The form
 * that calls this is a plain HTML form posting to a server action, so the
 * submitted value never enters client JavaScript, never reaches a query string
 * and never appears in a browser history entry.
 */

/**
 * The guessing budget, spent only by WRONG answers.
 *
 * Ten wrong guesses per ten minutes is nothing against a long random password
 * and forgiving of a reviewer who fumbles a paste. Two honest limits on what
 * this buys: the counter lives in one server process, so a multi-instance
 * deployment multiplies the budget by the instance count; and the key is a
 * forwarded IP header, which a determined attacker controls. It slows careless
 * guessing. The password's own strength is the actual defence.
 */
const REVIEW_ATTEMPT_BUDGET = { limit: 10, windowSeconds: 10 * 60 } as const;

/** Best-effort caller identity for rate limiting. Not an identity claim. */
async function attemptKey(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headerList.get("x-real-ip")?.trim();
  return `review_gate:${forwarded || realIp || "unknown"}`;
}

/**
 * Validates the review password and, on success, issues the session cookie.
 *
 * ONE FAILURE ANSWER FOR EVERY KIND OF FAILURE. Wrong password, empty
 * submission, and a deployment with no password configured all return the same
 * `invalid` outcome with the same wording. A reviewer learns nothing about how
 * close they were, and an attacker learns nothing about whether the gate is
 * even switched on. The rate-limit refusal is the one exception, because a
 * caller being throttled has to be told to wait or they will simply keep
 * trying.
 */
export async function submitReviewPassword(
  _previous: { error: string | null } | null,
  formData: FormData,
): Promise<{ error: string | null }> {
  const limiter = getRateLimiter();
  const key = await attemptKey();
  const decision = limiter.check(key, REVIEW_ATTEMPT_BUDGET);
  if (!decision.allowed) {
    return {
      error: `Too many attempts. Try again in ${Math.ceil(decision.retryAfterSeconds / 60)} minutes.`,
    };
  }

  const submitted = String(formData.get("password") ?? "");
  const ok = await checkReviewPassword(submitted);
  if (!ok) {
    // Nothing is logged. A failed attempt tells us nothing worth the risk of
    // writing any part of it down.
    return { error: "That password is not valid for this review deployment." };
  }

  /*
   * FAILED attempts are what gets throttled, so a correct password clears the
   * record. Without this the budget counts arrivals rather than guesses, and a
   * review team behind one office NAT would lock itself out by succeeding.
   */
  limiter.clear(key);

  const now = Date.now();
  const token = await mintReviewToken(
    (process.env[REVIEW_PASSWORD_ENV] ?? "").trim(),
    now + REVIEW_SESSION_SECONDS * 1000,
  );
  const store = await cookies();
  store.set(REVIEW_COOKIE, token, reviewCookieOptions(now));

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

/** Ends the review session. */
export async function endReviewSession(): Promise<void> {
  const store = await cookies();
  store.delete(REVIEW_COOKIE);
  redirect(REVIEW_GATE_PATH);
}

/** Referenced so the shared budgets stay visible from here. */
export type KnownRateLimits = typeof RATE_LIMITS;
