import "server-only";

/**
 * RESEND WEBHOOK SIGNATURE VERIFICATION.
 *
 * Resend signs webhooks with Svix, which is the Standard Webhooks scheme:
 *
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = base64( HMAC-SHA256( base64decode(secret after `whsec_`),
 *                                         signed content ) )
 *   header         = `v1,<sig> v1,<sig2> …`   space-delimited during rotation
 *
 * THIS IS THE ONLY THING STANDING BETWEEN A PUBLIC URL AND THE REPORTING
 * TABLES, so three properties matter more than brevity:
 *
 *   THE RAW BODY IS SIGNED, NOT THE PARSED JSON. `JSON.parse` followed by
 *   `JSON.stringify` reorders keys, changes number formatting and drops
 *   whitespace — any of which breaks the signature. The caller must pass the
 *   exact bytes it received, and must verify BEFORE it parses.
 *
 *   THE TIMESTAMP IS CHECKED. Without it a captured delivery can be replayed
 *   forever, and a replay of a real report would be indistinguishable from the
 *   report. Five minutes each way, which is the Svix tolerance.
 *
 *   COMPARISON IS CONSTANT-TIME. A byte-by-byte early return leaks how much of
 *   a forged signature was right, which is enough to construct one.
 *
 * Implemented directly on Web Crypto rather than by adding the `svix` or
 * `resend` package. The scheme is forty lines, it is a published standard, this
 * runs on both the Node and Edge runtimes unchanged, and a dependency inside
 * the one security boundary in the intake path is a dependency whose updates
 * have to be watched. The trade is that the scheme is pinned here — so it is
 * written out above, and the tests below it check against vectors computed
 * independently.
 */

/** The server-side variable holding the signing secret. Never NEXT_PUBLIC_. */
export const WEBHOOK_SECRET_ENV = "RESEND_WEBHOOK_SECRET";

/** Headers Svix sends. Lowercase: `Headers.get` is case-insensitive anyway. */
export const SIGNATURE_HEADERS = {
  id: "svix-id",
  timestamp: "svix-timestamp",
  signature: "svix-signature",
} as const;

/** How far a delivery's timestamp may be from now, in seconds. */
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

const encoder = new TextEncoder();

export type SignatureVerdict =
  | { valid: true }
  /**
   * Invalid, with a reason for an OPERATOR.
   *
   * The reason is deliberately NOT returned to the caller: "your timestamp is
   * stale" and "your signature is wrong" tell a prober which half to fix. The
   * route answers 401 and nothing else.
   */
  | { valid: false; reason: string };

/** Decodes the base64 body of a `whsec_…` secret into key bytes. */
function secretKeyBytes(secret: string): Uint8Array | null {
  const trimmed = secret.trim();
  const body = trimmed.startsWith("whsec_") ? trimmed.slice("whsec_".length) : trimmed;
  if (body.length === 0) return null;
  try {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    // A secret that is not base64 is a configuration error, not a caller error.
    return null;
  }
}

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Branchless equality, so no early return leaks a matching prefix length. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * The signature Svix would have produced for this delivery.
 *
 * Exported so a test can build a genuinely signed request rather than mocking
 * the verifier — a signature test that stubs the signing is testing nothing.
 */
export async function signWebhook(input: {
  secret: string;
  id: string;
  timestamp: string;
  rawBody: string;
}): Promise<string> {
  const keyBytes = secretKeyBytes(input.secret);
  if (!keyBytes) throw new Error(`${WEBHOOK_SECRET_ENV} is not a valid whsec_ secret.`);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${input.id}.${input.timestamp}.${input.rawBody}`;
  return base64(await crypto.subtle.sign("HMAC", key, encoder.encode(signed)));
}

/**
 * Verifies one delivery.
 *
 * `rawBody` must be the exact string the request carried. Fails closed on a
 * missing header, a missing or malformed secret, a stale timestamp, and any
 * signature that does not match.
 */
export async function verifyWebhookSignature(input: {
  headers: Headers;
  rawBody: string;
  secret?: string;
  nowMs?: number;
}): Promise<SignatureVerdict> {
  const secret = (input.secret ?? process.env[WEBHOOK_SECRET_ENV] ?? "").trim();
  if (secret.length === 0) {
    return { valid: false, reason: `${WEBHOOK_SECRET_ENV} is not configured.` };
  }

  const id = input.headers.get(SIGNATURE_HEADERS.id);
  const timestamp = input.headers.get(SIGNATURE_HEADERS.timestamp);
  const signatureHeader = input.headers.get(SIGNATURE_HEADERS.signature);
  if (!id || !timestamp || !signatureHeader) {
    return { valid: false, reason: "A required signature header is missing." };
  }

  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds)) {
    return { valid: false, reason: "The timestamp header is not a number." };
  }
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - sentAtSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    // Replay protection. A captured delivery must not work forever.
    return { valid: false, reason: "The timestamp is outside the tolerance window." };
  }

  let expected: string;
  try {
    expected = await signWebhook({ secret, id, timestamp, rawBody: input.rawBody });
  } catch {
    return { valid: false, reason: `${WEBHOOK_SECRET_ENV} is not a valid whsec_ secret.` };
  }

  /*
   * The header may carry SEVERAL signatures, space-delimited, which is how a
   * secret rotation works: both the old and the new endpoint secret sign the
   * same delivery for a window. Every `v1,` entry is checked and any match is
   * accepted — and every entry is checked even after a match, so the position
   * of the matching one is not timeable.
   */
  let matched = false;
  for (const entry of signatureHeader.split(" ")) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    if (timingSafeEqual(value, expected)) matched = true;
  }

  return matched ? { valid: true } : { valid: false, reason: "No signature matched." };
}

/** True when this runtime holds a usable signing secret. */
export function webhookSecretConfigured(): boolean {
  return secretKeyBytes(process.env[WEBHOOK_SECRET_ENV] ?? "") !== null;
}
