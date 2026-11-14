import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing for the partner API (/api/partner/l10). A partner app's SERVER signs each request with the shared secret
 * (HUB_PARTNER_SECRET); the Hub verifies it before anything else. The signature covers the partner id, the timestamp
 * and the exact request body (which carries the person's email, the operation, its arguments and a one-time nonce),
 * so none of them can be changed without the secret. Requests older or newer than five minutes are refused.
 *
 * The same code as the Leadership Hub's src/lib/partner/signature.ts: both repositories' tests check one fixed signature (SHARED_VECTOR), so a change to one that breaks the other fails CI.
 */
export const PARTNER_HEADERS = {
  partner: "x-hub-partner-id",
  timestamp: "x-hub-partner-timestamp",
  signature: "x-hub-partner-signature",
} as const;

export const SIGNATURE_VERSION = "l10-partner-v1";
export const MAX_SKEW_MS = 5 * 60_000;
export const MIN_SECRET_LENGTH = 32;
export const PARTNER_ID = /^[a-z][a-z0-9-]{1,30}$/;

export function signPartnerRequest(secret: string, partnerId: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${SIGNATURE_VERSION}\n${partnerId}\n${timestamp}\n${body}`).digest("hex");
}

export function verifyPartnerRequest(input: { secret: string; partnerId: string | null; timestamp: string | null; signature: string | null; body: string; now: number }): boolean {
  const { secret, partnerId, timestamp, signature, body, now } = input;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  if (!partnerId || !PARTNER_ID.test(partnerId)) return false;
  if (!timestamp || !/^\d{13}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return false;
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signPartnerRequest(secret, partnerId, timestamp, body), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
