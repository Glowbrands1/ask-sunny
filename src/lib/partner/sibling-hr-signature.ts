import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ============================================================================
 * HR'S QUEUE IN THE SIBLING APP (owner, 23 NOV 2026)
 * ============================================================================
 *
 * The owner: the HR approver should not have to go back and forth between the two apps, "just make 1 tab for each".
 * So each app's Pending HR approval tab also lists the forms waiting for that same person in the sibling app. The
 * sibling's server is asked `/api/partner/hr-queue`, signed with a secret only the two apps' servers hold
 * (SIBLING_HR_SECRET, the same value in both). Approving stays in the app that owns the form: the list links there.
 *
 * Its own secret and its own signature version, apart from the Leadership Hub's partner requests, so a request signed
 * for one is never accepted by another. The signature covers the caller, the timestamp and the exact body; a request
 * more than five minutes old or ahead is refused. The route only reads.
 *
 * The same code in both apps: both repositories' tests check one fixed signature (SIBLING_HR_SHARED_VECTOR), so a
 * change to one that breaks the other fails CI.
 */

export const SIBLING_HR_HEADERS = {
  caller: "x-sibling-hr-caller",
  timestamp: "x-sibling-hr-timestamp",
  signature: "x-sibling-hr-signature",
} as const;

export const SIBLING_HR_SIGNATURE_VERSION = "sibling-hr-v1";
export const SIBLING_HR_MAX_SKEW_MS = 5 * 60_000;
export const SIBLING_HR_MIN_SECRET_LENGTH = 32;

export function signSiblingHrRequest(secret: string, caller: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${SIBLING_HR_SIGNATURE_VERSION}\n${caller}\n${timestamp}\n${body}`).digest("hex");
}

export function verifySiblingHrRequest(input: {
  secret: string | undefined;
  /** The one caller this app answers: the sibling app's id. */
  expectedCaller: string;
  caller: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now: number;
}): boolean {
  const { secret, expectedCaller, caller, timestamp, signature, body, now } = input;
  if (!secret || secret.length < SIBLING_HR_MIN_SECRET_LENGTH) return false;
  if (!caller || caller !== expectedCaller) return false;
  if (!timestamp || !/^\d{13}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > SIBLING_HR_MAX_SKEW_MS) return false;
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signSiblingHrRequest(secret, caller, timestamp, body), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/** One fixed vector both repositories check. */
export const SIBLING_HR_SHARED_VECTOR = {
  secret: "test-secret-0123456789abcdef0123456789",
  caller: "sibling-app",
  timestamp: "1795600000000",
  body: '{"approverEmail":"hr@example.com","nonce":"n"}',
} as const;
