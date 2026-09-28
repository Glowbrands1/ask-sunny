import "server-only";

import { DEFAULT_WOVEN_API_BASE_URL } from "./contract";

/**
 * ============================================================================
 * THE WOVEN EMPLOYEE SYNC'S CONFIGURATION
 * ============================================================================
 *
 * EVERY CREDENTIAL IS SERVER-SIDE. None of these names is `NEXT_PUBLIC_`, and
 * `server-only` above makes a client component that reaches this module a
 * build failure. The subscription key, the application user's password and
 * the AccessToken they produce are never written to a log, an error message, a
 * response body or the database.
 *
 * OFF UNTIL SWITCHED ON, TWICE. `WOVEN_SYNC_ENABLED` is the master switch —
 * with it off nothing reaches Woven. `WOVEN_SYNC_SCHEDULE_ENABLED` must ALSO be
 * on before the cron route starts a sync, which is what lets somebody run a
 * manual dry run against the live API without arming an unattended schedule.
 * It is the same two-switch shape as the Apify review sync, for the same
 * reason.
 *
 * Problems are reported by variable NAME, never by value.
 */

export const WOVEN_API_BASE_URL_ENV = "WOVEN_API_BASE_URL";
export const WOVEN_SUBSCRIPTION_KEY_ENV = "WOVEN_SUBSCRIPTION_KEY";
export const WOVEN_USERNAME_ENV = "WOVEN_USERNAME";
export const WOVEN_PASSWORD_ENV = "WOVEN_PASSWORD";
export const WOVEN_SYNC_ENABLED_ENV = "WOVEN_SYNC_ENABLED";
export const WOVEN_SYNC_SCHEDULE_ENABLED_ENV = "WOVEN_SYNC_SCHEDULE_ENABLED";
export const WOVEN_PAGE_SIZE_ENV = "WOVEN_PAGE_SIZE";
export const WOVEN_MAX_DETAIL_REQUESTS_ENV = "WOVEN_MAX_DETAIL_REQUESTS_PER_RUN";
export const WOVEN_MIN_COMPLETENESS_ENV = "WOVEN_MIN_COMPLETENESS_PERCENT";
export const WOVEN_WORK_EMAIL_DOMAINS_ENV = "WOVEN_WORK_EMAIL_DOMAINS";

/** The three values without which no call can be made. */
export const WOVEN_CREDENTIAL_ENV = [
  WOVEN_SUBSCRIPTION_KEY_ENV,
  WOVEN_USERNAME_ENV,
  WOVEN_PASSWORD_ENV,
] as const;

const DEFAULTS = {
  /*
   * 100 per page: a salon estate of a few hundred active staff is a handful of
   * pages, and a page is small enough that one failing costs little to retry.
   */
  pageSize: 100,
  /*
   * DETAILS ARE THE EXPENSIVE READ. One call per employee, against a limit of
   * roughly 100 requests a minute for the whole subscription key. 150 keeps a
   * run well inside a serverless invocation's wall clock; employees not reached
   * keep the affiliations already on file and are read first next time.
   */
  maxDetailRequests: 150,
  /*
   * 80%: the threshold the employee-lifecycle feasibility study proposed. A
   * run that returns fewer than this share of the active employees already on
   * file is refused as a whole — a broken filter or a half-read looks exactly
   * like a mass termination otherwise.
   */
  minCompletenessPercent: 80,
} as const;

const BOUNDS = {
  pageSize: { min: 10, max: 500 },
  maxDetailRequests: { min: 0, max: 1000 },
  minCompletenessPercent: { min: 50, max: 100 },
} as const;

/**
 * The client's pacing and retry policy. Constants rather than variables: they
 * follow from Woven's documented limit, not from anything an operator tunes.
 */
export const WOVEN_TRANSPORT = {
  /** ~92 requests a minute, under the documented ~100/min per subscription key. */
  minIntervalMs: 650,
  requestTimeoutMs: 15_000,
  maxRetries: 3,
  baseBackoffMs: 1_000,
  /** The longest `Retry-After` honoured. Anything longer fails the run instead. */
  maxRetryAfterMs: 60_000,
} as const;

export interface WovenCredentials {
  subscriptionKey: string;
  username: string;
  password: string;
}

export interface WovenConfig {
  enabled: boolean;
  scheduleEnabled: boolean;
  baseUrl: string;
  /** Null until all three credential variables are set. */
  credentials: WovenCredentials | null;
  /** Names of the credential variables that are missing. Never values. */
  missingCredentials: string[];
  pageSize: number;
  maxDetailRequestsPerRun: number;
  minCompletenessPercent: number;
  /** Lower-cased. Empty means "any syntactically valid work email". */
  workEmailDomains: string[];
  /** Misconfiguration, by variable name. Never a value. */
  problems: string[];
}

type Env = Readonly<Record<string, string | undefined>>;

/** `true`, `1`, `yes` and `on` are on. Anything else, including absent, is off. */
function readFlag(env: Env, name: string): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function readBoundedInteger(
  env: Env,
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
  problems: string[],
): number {
  const raw = (env[name] ?? "").trim();
  if (raw.length === 0) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    /* Refused rather than clamped, so a mistyped value is not silently "accepted". */
    problems.push(
      `${name} must be a whole number between ${bounds.min} and ${bounds.max}. Using ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

/**
 * The base URL must be HTTPS. The subscription key and AccessToken travel as
 * headers on every call, and a plain-HTTP override would send them in clear.
 */
function readBaseUrl(env: Env, problems: string[]): string {
  const raw = (env[WOVEN_API_BASE_URL_ENV] ?? "").trim();
  if (raw.length === 0) return DEFAULT_WOVEN_API_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    problems.push(`${WOVEN_API_BASE_URL_ENV} is not a valid URL. Using the documented default.`);
    return DEFAULT_WOVEN_API_BASE_URL;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    problems.push(
      `${WOVEN_API_BASE_URL_ENV} must be a plain https:// URL with no credentials, query or fragment. Using the documented default.`,
    );
    return DEFAULT_WOVEN_API_BASE_URL;
  }
  return parsed.toString().replace(/\/+$/, "");
}

const DOMAIN_PATTERN = /^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function readDomains(env: Env, problems: string[]): string[] {
  const raw = (env[WOVEN_WORK_EMAIL_DOMAINS_ENV] ?? "").trim();
  if (raw.length === 0) return [];

  const domains: string[] = [];
  for (const part of raw.split(",")) {
    const domain = part.trim().toLowerCase().replace(/^@/, "");
    if (domain.length === 0) continue;
    if (!DOMAIN_PATTERN.test(domain)) {
      problems.push(`${WOVEN_WORK_EMAIL_DOMAINS_ENV} contains an entry that is not a domain name. It was ignored.`);
      continue;
    }
    if (!domains.includes(domain)) domains.push(domain);
  }
  return domains;
}

export function readWovenConfig(env: Env = process.env): WovenConfig {
  const problems: string[] = [];

  const subscriptionKey = (env[WOVEN_SUBSCRIPTION_KEY_ENV] ?? "").trim();
  const username = (env[WOVEN_USERNAME_ENV] ?? "").trim();
  /* A password is not trimmed: surrounding whitespace can be part of it. */
  const password = env[WOVEN_PASSWORD_ENV] ?? "";

  const missingCredentials: string[] = [];
  if (!subscriptionKey) missingCredentials.push(WOVEN_SUBSCRIPTION_KEY_ENV);
  if (!username) missingCredentials.push(WOVEN_USERNAME_ENV);
  if (password.length === 0) missingCredentials.push(WOVEN_PASSWORD_ENV);

  const enabled = readFlag(env, WOVEN_SYNC_ENABLED_ENV);
  const scheduleEnabled = readFlag(env, WOVEN_SYNC_SCHEDULE_ENABLED_ENV);

  if (scheduleEnabled && !enabled) {
    problems.push(
      `${WOVEN_SYNC_SCHEDULE_ENABLED_ENV} is on but ${WOVEN_SYNC_ENABLED_ENV} is off, so the schedule starts nothing.`,
    );
  }
  if (enabled && missingCredentials.length > 0) {
    problems.push(
      `${WOVEN_SYNC_ENABLED_ENV} is on but ${missingCredentials.join(", ")} ${
        missingCredentials.length === 1 ? "is" : "are"
      } not set, so no sync can run.`,
    );
  }

  return {
    enabled,
    scheduleEnabled,
    baseUrl: readBaseUrl(env, problems),
    credentials:
      missingCredentials.length === 0 ? { subscriptionKey, username, password } : null,
    missingCredentials,
    pageSize: readBoundedInteger(env, WOVEN_PAGE_SIZE_ENV, DEFAULTS.pageSize, BOUNDS.pageSize, problems),
    maxDetailRequestsPerRun: readBoundedInteger(
      env,
      WOVEN_MAX_DETAIL_REQUESTS_ENV,
      DEFAULTS.maxDetailRequests,
      BOUNDS.maxDetailRequests,
      problems,
    ),
    minCompletenessPercent: readBoundedInteger(
      env,
      WOVEN_MIN_COMPLETENESS_ENV,
      DEFAULTS.minCompletenessPercent,
      BOUNDS.minCompletenessPercent,
      problems,
    ),
    workEmailDomains: readDomains(env, problems),
    problems,
  };
}
