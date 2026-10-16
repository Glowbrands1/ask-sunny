import "server-only";

/**
 * GOOGLE BUSINESS PROFILE API — configuration.
 *
 * Every name below is an environment variable NAME. No value is ever read into
 * a log line, a response body or an error message from this module.
 *
 * THE SOURCE IS OFF UNTIL SOMEBODY SWITCHES IT ON. `GBP_SYNC_MODE` defaults to
 * `off`, so deploying this code spends no quota and writes nothing. `dry_run`
 * reads from Google and reports without writing review data; `live` writes.
 * Apify's own flags are untouched and independent.
 */

export const GBP_CLIENT_ID_ENV = "GOOGLE_GBP_CLIENT_ID";
export const GBP_CLIENT_SECRET_ENV = "GOOGLE_GBP_CLIENT_SECRET";
export const GBP_REFRESH_TOKEN_ENV = "GOOGLE_GBP_REFRESH_TOKEN";
export const GBP_SYNC_MODE_ENV = "GBP_SYNC_MODE";
export const GBP_ALLOW_LIVE_BACKFILL_ENV = "GBP_ALLOW_LIVE_BACKFILL";
export const GBP_INCREMENTAL_MAX_PAGES_ENV = "GBP_INCREMENTAL_MAX_PAGES";
export const GBP_BACKFILL_MAX_PAGES_ENV = "GBP_BACKFILL_MAX_PAGES";
export const GBP_MAX_REQUESTS_ENV = "GBP_MAX_REQUESTS_PER_RUN";
export const GBP_PUBSUB_AUDIENCE_ENV = "GBP_PUBSUB_AUDIENCE";
export const GBP_PUBSUB_SERVICE_ACCOUNT_ENV = "GBP_PUBSUB_SERVICE_ACCOUNT";
export const GBP_PUBSUB_TOPIC_ENV = "GBP_PUBSUB_TOPIC";

export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

export type GbpSyncMode = "off" | "dry_run" | "live";

export interface GbpCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GbpLimits {
  /** Pages of 50 reviews read per listing on a routine run. */
  incrementalMaxPages: number;
  /** Pages of 50 reviews read per listing on a backfill. */
  backfillMaxPages: number;
  /** Hard ceiling on Google requests in a single run. */
  maxRequestsPerRun: number;
}

export const DEFAULT_LIMITS: GbpLimits = {
  incrementalMaxPages: 2,
  backfillMaxPages: 40,
  maxRequestsPerRun: 400,
};

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  /* A malformed limit falls back to the safe default rather than to "unlimited". */
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback;
  return parsed;
}

export function readSyncMode(env: NodeJS.ProcessEnv = process.env): GbpSyncMode {
  const raw = (env[GBP_SYNC_MODE_ENV] ?? "").trim().toLowerCase();
  /* Anything that is not exactly one of the two active words is OFF. */
  return raw === "live" || raw === "dry_run" ? raw : "off";
}

export function liveBackfillAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[GBP_ALLOW_LIVE_BACKFILL_ENV] ?? "").trim().toLowerCase() === "true";
}

export function readCredentials(env: NodeJS.ProcessEnv = process.env): GbpCredentials | null {
  const clientId = env[GBP_CLIENT_ID_ENV]?.trim();
  const clientSecret = env[GBP_CLIENT_SECRET_ENV]?.trim();
  const refreshToken = env[GBP_REFRESH_TOKEN_ENV]?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

/** Names only — what is missing, never what is set. */
export function missingCredentialNames(env: NodeJS.ProcessEnv = process.env): string[] {
  return [GBP_CLIENT_ID_ENV, GBP_CLIENT_SECRET_ENV, GBP_REFRESH_TOKEN_ENV].filter(
    (name) => !env[name]?.trim(),
  );
}

export function readLimits(env: NodeJS.ProcessEnv = process.env): GbpLimits {
  return {
    incrementalMaxPages: positiveInt(
      env[GBP_INCREMENTAL_MAX_PAGES_ENV],
      DEFAULT_LIMITS.incrementalMaxPages,
      20,
    ),
    backfillMaxPages: positiveInt(
      env[GBP_BACKFILL_MAX_PAGES_ENV],
      DEFAULT_LIMITS.backfillMaxPages,
      200,
    ),
    maxRequestsPerRun: positiveInt(env[GBP_MAX_REQUESTS_ENV], DEFAULT_LIMITS.maxRequestsPerRun, 5000),
  };
}
