import "server-only";

import { getRateLimiter } from "@/lib/api/rate-limit";
import {
  MIN_SECRET_LENGTH,
  parseIngestCredentials,
  verifyIngestSecret,
  type IngestCredential,
} from "@/lib/reporting/ingest-credential";

/**
 * THE REVIEW-SYNC MACHINE CREDENTIAL.
 *
 * The credential the Brave extension presents at `POST /api/reviews/ingest`.
 * A MACHINE credential, exactly like `REPORTING_INGEST_SECRET`: it identifies
 * an installed extension, carries no profile, role or scope, and grants exactly
 * one capability — to file Google reviews for the fifteen allowlisted stores.
 *
 * ============================================================================
 * WHY IT REUSES THE REPORTING CREDENTIAL'S MACHINERY BUT NOT ITS VARIABLE
 * ============================================================================
 *
 * REUSES THE MACHINERY, because the hard parts are already written, reviewed
 * and tested: constant-time comparison over SHA-256 digests with a branchless
 * accumulator, `id:secret` entries so rotation needs no downtime, a refused
 * minimum strength, and a rate limit that counts failures only. Writing a
 * second implementation of any of those would be writing a second chance to get
 * one of them subtly wrong.
 *
 * NOT THE VARIABLE, because the two must be revocable independently and that is
 * the whole point. `REPORTING_INGEST_SECRET` belongs to a scheduled pipeline
 * that files company financials. This one is typed into an Options page in a
 * browser on somebody's laptop — a different exposure, a different blast
 * radius, and a different day on which somebody will want to revoke it. Sharing
 * one value would mean pulling the extension's token takes reporting down with
 * it.
 *
 * ============================================================================
 * WHY A TOKEN AND NOT THE SIGNED-IN ASK SUNNY SESSION
 * ============================================================================
 *
 * `authorizeRequest()` answers "which person is this, and may they do this?"
 * from a Supabase session cookie. A Chromium extension's background service
 * worker has no cookie jar shared with the app's origin in any form we would
 * want to rely on, and the alternative — having the content script carry the
 * user's ASK Sunny session into a page Google controls — would put a real
 * user session inside a third party's document. That is strictly worse than a
 * narrow, revocable token that can do exactly one thing.
 *
 * So the same decision the reporting pipeline already made, for the same
 * reason, recorded in `docs/architecture-constraints.md` §2: a caller that is
 * not a person authenticates as a machine.
 *
 * NEVER `NEXT_PUBLIC_`, and `server-only` above makes a client component
 * importing this file a build failure.
 */

export const REVIEW_SYNC_SECRET_ENV = "GOOGLE_REVIEW_SYNC_SECRET";

/** Unlabelled entries are attributed to the extension. */
const DEFAULT_CREDENTIAL_ID = "brave-extension";

/** Failed presentations per window, per caller. A success costs nothing. */
const ATTEMPT_BUDGET = { limit: 10, windowSeconds: 10 * 60 } as const;

export function configuredSyncCredentials(): IngestCredential[] {
  return parseIngestCredentials(
    process.env[REVIEW_SYNC_SECRET_ENV],
    DEFAULT_CREDENTIAL_ID,
  );
}

export function reviewSyncCredentialConfigured(): boolean {
  return configuredSyncCredentials().length > 0;
}

/**
 * An operator-facing description of a misconfiguration, or null.
 *
 * Names the variable and never a value. A CALLER is told nothing beyond "not
 * authorized" — whether the gate is switched on is not their business.
 */
export function reviewSyncConfigurationProblem(): string | null {
  const raw = (process.env[REVIEW_SYNC_SECRET_ENV] ?? "").trim();
  const parsed = configuredSyncCredentials();

  if (raw.length === 0) {
    return `${REVIEW_SYNC_SECRET_ENV} is not set, so Google review sync is closed. Set it to a secret of at least ${MIN_SECRET_LENGTH} characters — or to \`id:secret\` entries, comma separated, to hold several — and redeploy.`;
  }

  if (parsed.length === 0) {
    return `${REVIEW_SYNC_SECRET_ENV} is set but holds no usable credential — every entry was shorter than ${MIN_SECRET_LENGTH} characters. It is ignored rather than used, so the extension is refused.`;
  }

  const entryCount = raw.split(/[\s,]+/).filter((entry) => entry.trim().length > 0).length;
  if (parsed.length < entryCount) {
    const dropped = entryCount - parsed.length;
    return `${REVIEW_SYNC_SECRET_ENV} holds ${dropped} entr${
      dropped === 1 ? "y" : "ies"
    } shorter than ${MIN_SECRET_LENGTH} characters, which ${
      dropped === 1 ? "is" : "are"
    } ignored. The remaining ${parsed.length} ${parsed.length === 1 ? "is" : "are"} in use.`;
  }

  const ids = parsed.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    return `${REVIEW_SYNC_SECRET_ENV} holds entries sharing an id, so an audit line could not say which credential filed a sync. Give each entry a distinct id.`;
  }

  return null;
}

/**
 * Reads the presented token.
 *
 * `Authorization: Bearer <token>` only. The reporting credential also accepts a
 * custom header because some automation platforms make one easier to set; an
 * extension's `fetch` has no such excuse, so there is one way in.
 *
 * NEVER A QUERY PARAMETER. A secret in a URL is written into every log between
 * the caller and here and survives rotation in all of them.
 */
export function readPresentedSyncToken(headers: Headers): string | null {
  const authorization = headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return bearer ? bearer[1].trim() : null;
}

export type SyncAuthOutcome =
  | { status: "authorized"; credentialId: string }
  | { status: "unauthorized" }
  | { status: "unconfigured"; problem: string }
  | { status: "rate_limited"; retryAfterSeconds: number };

/**
 * The whole gate for one request: configuration, rate limit, verification.
 *
 * ORDER MATTERS, and it is the reporting gate's order for the same reasons.
 * Configuration first, so a deployment missing its variable refuses without
 * spending an honest caller's rate-limit slot. Then the limit, so a guessing
 * caller is cut off before any comparison happens. Then the comparison, whose
 * cost is constant either way.
 *
 * A SUCCESS CLEARS THE FAILURE RECORD, so a manager who mistyped the token once
 * and then pasted it correctly does not carry that fumble into the next window
 * — and two people behind one office IP do not spend each other's budget.
 */
export async function authorizeReviewSync(
  headers: Headers,
  options: { callerKey?: string } = {},
): Promise<SyncAuthOutcome> {
  const credentials = configuredSyncCredentials();
  if (credentials.length === 0) {
    return {
      status: "unconfigured",
      problem:
        reviewSyncConfigurationProblem() ??
        `${REVIEW_SYNC_SECRET_ENV} is not set, so Google review sync is closed.`,
    };
  }

  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  const key = `google_review_sync:${options.callerKey ?? forwarded ?? realIp ?? "unknown"}`;

  const limiter = getRateLimiter();
  const decision = limiter.check(key, ATTEMPT_BUDGET);
  if (!decision.allowed) {
    return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const presented = readPresentedSyncToken(headers);
  const { authorized, credentialId } = await verifyIngestSecret(presented, credentials);

  if (!authorized || credentialId === null) return { status: "unauthorized" };

  limiter.clear(key);
  return { status: "authorized", credentialId };
}
