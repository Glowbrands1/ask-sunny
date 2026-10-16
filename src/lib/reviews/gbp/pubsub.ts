import "server-only";

import { createPublicKey, createVerify } from "node:crypto";

import type { GbpNotification } from "./types";

/**
 * PUB/SUB PUSH AUTHENTICATION.
 *
 * A Pub/Sub push subscription can be configured to sign each delivery with an
 * OIDC token for a service account of our choosing. We accept a delivery ONLY if
 * that token is:
 *   - a well-formed RS256 JWT signed by a key in Google's published JWKS,
 *   - issued by Google (`accounts.google.com`),
 *   - addressed to OUR audience (`GBP_PUBSUB_AUDIENCE`),
 *   - minted for OUR subscription's service account (`GBP_PUBSUB_SERVICE_ACCOUNT`),
 *     with a verified email,
 *   - unexpired.
 * No shared secret in a query string, no "trust the payload": anyone can POST a
 * body-shaped message, and only Google can mint that token.
 *
 * The message itself carries no review content — only which review changed — so
 * the handler uses it as a HINT to run a normal, bounded sync of that one
 * listing. A forged or replayed message can at worst cause one extra read.
 */

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_SECONDS = 60;

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
}

export interface PubSubVerifyDeps {
  fetchJwks: () => Promise<Jwk[]>;
  now: () => number;
}

let cache: { keys: Jwk[]; fetchedAt: number } | null = null;

export const defaultPubSubDeps: PubSubVerifyDeps = {
  fetchJwks: async () => {
    if (cache && Date.now() - cache.fetchedAt < 60 * 60 * 1000) return cache.keys;
    const response = await fetch(JWKS_URL);
    if (!response.ok) throw new Error("jwks_unavailable");
    const body = (await response.json()) as { keys?: Jwk[] };
    cache = { keys: body.keys ?? [], fetchedAt: Date.now() };
    return cache.keys;
  },
  now: () => Date.now(),
};

function decodePart(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type PubSubAuth = "ok" | "unauthorized" | "unconfigured";

export async function verifyPubSubRequest(
  authorizationHeader: string | null,
  expected: { audience: string | undefined; serviceAccount: string | undefined },
  deps: PubSubVerifyDeps = defaultPubSubDeps,
): Promise<PubSubAuth> {
  if (!expected.audience || !expected.serviceAccount) return "unconfigured";

  const match = /^Bearer\s+(.+)$/i.exec((authorizationHeader ?? "").trim());
  if (!match) return "unauthorized";
  const parts = match[1].trim().split(".");
  if (parts.length !== 3) return "unauthorized";

  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!header || !claims) return "unauthorized";
  /* Pin the algorithm: never accept `none` or an HMAC keyed by a public value. */
  if (header.alg !== "RS256" || typeof header.kid !== "string") return "unauthorized";

  let keys: Jwk[];
  try {
    keys = await deps.fetchJwks();
  } catch {
    return "unauthorized";
  }
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) return "unauthorized";

  try {
    const key = createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    if (!verifier.verify(key, Buffer.from(parts[2], "base64url"))) return "unauthorized";
  } catch {
    return "unauthorized";
  }

  const nowSeconds = Math.floor(deps.now() / 1000);
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) return "unauthorized";
  if (claims.aud !== expected.audience) return "unauthorized";
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) return "unauthorized";
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) return "unauthorized";
  if (claims.email_verified !== true || claims.email !== expected.serviceAccount) return "unauthorized";

  return "ok";
}

export type ParsedNotification =
  | { ok: true; notification: GbpNotification; accountName: string; locationName: string }
  | { ok: false };

/** Decodes a Pub/Sub push envelope. Anything unexpected is rejected, not guessed at. */
export function parsePushEnvelope(body: unknown): ParsedNotification {
  const message = (body as { message?: { data?: unknown } } | null)?.message;
  if (!message || typeof message.data !== "string") return { ok: false };

  let notification: GbpNotification;
  try {
    notification = JSON.parse(Buffer.from(message.data, "base64").toString("utf8")) as GbpNotification;
  } catch {
    return { ok: false };
  }

  /*
   * Google's notification names the resource in `reviewName` / `locationName`
   * (v4 Notification). Older or alternative shapes use `review` / `location` /
   * `name`. All are accepted and only the account and location are extracted —
   * the message is a hint, never an instruction.
   */
  const fields = notification as unknown as Record<string, unknown>;
  const candidates = [fields.locationName, fields.reviewName, fields.location, fields.review, fields.name];
  const resource = candidates.find((value): value is string => typeof value === "string") ?? "";
  const match = /^(accounts\/[0-9]{1,30})\/(locations\/[0-9]{1,30})(?:\/|$)/.exec(resource);
  if (!match) return { ok: false };
  return { ok: true, notification, accountName: match[1], locationName: match[2] };
}
