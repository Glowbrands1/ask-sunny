import "server-only";

import { getRateLimiter } from "@/lib/api/rate-limit";
import {
  MIN_SECRET_LENGTH,
  parseIngestCredentials,
  verifyIngestSecret,
  type IngestCredential,
} from "@/lib/reporting/ingest-credential";

/**
 * ============================================================================
 * THE CREDENTIAL APIFY PRESENTS WHEN A RUN FINISHES
 * ============================================================================
 *
 * ============================================================================
 * WHY THIS IS NOT A USER SESSION, AND NOT THE EXTENSION'S TOKEN
 * ============================================================================
 *
 * NOT A USER SESSION, because the caller is Apify's infrastructure. Exposing
 * the mechanism a person signs in with as a machine-to-machine credential would
 * mean a third party holding something that can act as somebody — and the
 * session's whole value is that it cannot be held by anything but a browser
 * this org's identity provider issued it to.
 *
 * NOT `GOOGLE_REVIEW_SYNC_SECRET`, because the two must be revocable
 * separately. That one sits in an Options page on a laptop and files review
 * batches; this one sits in a webhook configuration on Apify and does one much
 * narrower thing. Revoking either should not take the other down, which is the
 * same argument that separated the extension's credential from the reporting
 * pipeline's in the first place.
 *
 * ============================================================================
 * AND WHY THE SECRET IS NOT THE ONLY CHECK
 * ============================================================================
 *
 * It is held by a third party, so it is treated as one factor of three. The
 * route also requires the body to name a run THIS SYSTEM started and is still
 * waiting on, and then reads the results from Apify's own API with this
 * system's own token rather than from the request. A caller who somehow holds
 * this secret can, at most, make ASK Sunny re-read a dataset it already owns —
 * which is idempotent, because deduplication is by Google's review id.
 *
 * IT IS OPTIONAL, AND ABSENCE IS NOT SILENT. A deployment that has not set it
 * refuses every webhook with `unconfigured` rather than accepting anonymous
 * ones, and the status panel says the webhook is not configured.
 */

export const APIFY_WEBHOOK_SECRET_ENV = "APIFY_WEBHOOK_SECRET";

const DEFAULT_CREDENTIAL_ID = "apify-webhook";

/** Failed presentations per window, per caller. A success costs nothing. */
const ATTEMPT_BUDGET = { limit: 10, windowSeconds: 10 * 60 } as const;

export function configuredWebhookCredentials(): IngestCredential[] {
  return parseIngestCredentials(
    process.env[APIFY_WEBHOOK_SECRET_ENV],
    DEFAULT_CREDENTIAL_ID,
  );
}

export function apifyWebhookConfigured(): boolean {
  return configuredWebhookCredentials().length > 0;
}

/**
 * The secret to hand Apify when attaching a webhook to a run.
 *
 * THE FIRST CONFIGURED ENTRY, and only the secret half of it. During a rotation
 * both values verify inbound while new runs are attached with the new one, so
 * the old value can be removed once the last run carrying it has finished.
 */
export function webhookSecretForOutboundUse(): string | null {
  const credentials = configuredWebhookCredentials();
  return credentials.length > 0 ? credentials[0].secret : null;
}

/** An operator-facing description of a misconfiguration, or null. Never a value. */
export function apifyWebhookConfigurationProblem(): string | null {
  const raw = (process.env[APIFY_WEBHOOK_SECRET_ENV] ?? "").trim();
  const parsed = configuredWebhookCredentials();

  if (raw.length === 0) {
    return `${APIFY_WEBHOOK_SECRET_ENV} is not set, so Apify's completion webhook is refused and a finished run will only be picked up by the next scheduled reconciliation. Set it to a secret of at least ${MIN_SECRET_LENGTH} characters and redeploy.`;
  }

  if (parsed.length === 0) {
    return `${APIFY_WEBHOOK_SECRET_ENV} is set but holds no usable credential — every entry was shorter than ${MIN_SECRET_LENGTH} characters. It is ignored rather than used, so the webhook is refused.`;
  }

  return null;
}

export type ApifyWebhookAuthOutcome =
  | { status: "authorized"; credentialId: string }
  | { status: "unauthorized" }
  | { status: "unconfigured"; problem: string }
  | { status: "rate_limited"; retryAfterSeconds: number };

function readPresentedToken(headers: Headers): string | null {
  const authorization = headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return bearer ? bearer[1].trim() : null;
}

/**
 * The whole gate for one webhook delivery: configuration, rate limit, compare.
 *
 * THE ORDER IS THE SECURITY MODEL, and it is the order every other machine
 * credential in this codebase uses. Configuration first, so a deployment
 * missing its variable refuses without spending an honest caller's budget. Then
 * the limit, so a guessing caller is cut off before any comparison happens.
 * Then the constant-time comparison, whose cost does not depend on how nearly
 * right the guess was.
 */
export async function authorizeApifyWebhook(
  headers: Headers,
  options: { callerKey?: string } = {},
): Promise<ApifyWebhookAuthOutcome> {
  const credentials = configuredWebhookCredentials();
  if (credentials.length === 0) {
    return {
      status: "unconfigured",
      problem:
        apifyWebhookConfigurationProblem() ??
        `${APIFY_WEBHOOK_SECRET_ENV} is not set, so the Apify webhook is closed.`,
    };
  }

  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  const key = `apify_webhook:${options.callerKey ?? forwarded ?? realIp ?? "unknown"}`;

  const limiter = getRateLimiter();
  const decision = limiter.check(key, ATTEMPT_BUDGET);
  if (!decision.allowed) {
    return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const presented = readPresentedToken(headers);
  const { authorized, credentialId } = await verifyIngestSecret(presented, credentials);

  if (!authorized || credentialId === null) return { status: "unauthorized" };

  limiter.clear(key);
  return { status: "authorized", credentialId };
}

/**
 * Where Apify should call back.
 *
 * ============================================================================
 * NEVER A HOST THE REQUEST SUPPLIED
 * ============================================================================
 *
 * `NEXT_PUBLIC_SITE_URL` is deployment configuration; a `Host` header is
 * whatever the caller wrote. Building a callback URL out of a request header
 * would let somebody who can reach the trigger point Apify's callback — and the
 * secret attached to it — at a host of their choosing. `VERCEL_URL` is accepted
 * as a fallback because Vercel sets it per deployment and a Preview has no
 * stable site URL, which is exactly where this needs to work.
 */
export function resolveCallbackBaseUrl(): string | null {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (configured.length > 0) {
    return configured.replace(/\/+$/, "");
  }

  const vercel = (process.env.VERCEL_URL ?? "").trim();
  if (vercel.length > 0) {
    return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }

  return null;
}
