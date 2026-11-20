import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ============================================================================
 * THE LEADERSHIP HUB READS GOOGLE REVIEWS FROM THIS APP (19 NOV 2026)
 * ============================================================================
 *
 * The owner: the Hub's assistant should see Google reviews too, and every Hub user sees both brands' reviews. The Hub
 * has no review data of its own, so its server asks this app's `/api/partner/hub-reviews`, signed with a secret only
 * the two servers hold (HUB_REVIEWS_SECRET here; HUB_REVIEWS_SECRET_ASK_SUNNY / _ASK_BUBBLES in the Hub). It is the
 * opposite direction to the L10 partner API (`features/l10/partner`) and has its own secret and its own signature
 * version, so a request signed for one can never be accepted by the other.
 *
 * The signature covers the caller id, the timestamp and the exact body; requests more than five minutes old or ahead
 * are refused. The route only reads.
 *
 * The same code as the Leadership Hub's `src/lib/partner/app-reviews-signature.ts` and Ask Bubbles' copy: all three
 * repositories' tests check one fixed signature (SHARED_VECTOR), so a change to one that breaks the others fails CI.
 */
export const HUB_REVIEWS_HEADERS = {
  caller: "x-hub-reviews-caller",
  timestamp: "x-hub-reviews-timestamp",
  signature: "x-hub-reviews-signature",
} as const;

export const HUB_REVIEWS_SIGNATURE_VERSION = "hub-reviews-v1";
/** The only caller this route answers. */
export const HUB_REVIEWS_CALLER = "leadership-hub";
export const HUB_REVIEWS_MAX_SKEW_MS = 5 * 60_000;
export const HUB_REVIEWS_MIN_SECRET_LENGTH = 32;

export function signHubReviewsRequest(secret: string, caller: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${HUB_REVIEWS_SIGNATURE_VERSION}\n${caller}\n${timestamp}\n${body}`).digest("hex");
}

export function verifyHubReviewsRequest(input: {
  secret: string | undefined;
  caller: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now: number;
}): boolean {
  const { secret, caller, timestamp, signature, body, now } = input;
  if (!secret || secret.length < HUB_REVIEWS_MIN_SECRET_LENGTH) return false;
  if (caller !== HUB_REVIEWS_CALLER) return false;
  if (!timestamp || !/^\d{13}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > HUB_REVIEWS_MAX_SKEW_MS) return false;
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signHubReviewsRequest(secret, caller, timestamp, body), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/** One fixed vector all three repositories check. */
export const SHARED_VECTOR = {
  secret: "test-secret-0123456789abcdef0123456789",
  caller: "leadership-hub",
  timestamp: "1795600000000",
  body: '{"question":"L3, L6 and YTD","nonce":"n"}',
} as const;
