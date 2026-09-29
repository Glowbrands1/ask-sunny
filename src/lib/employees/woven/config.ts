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
 * OFF UNTIL SWITCHED ON, AND EACH SWITCH OPENS ONE THING.
 *
 *   WOVEN_VALIDATION_ENABLED     the read-only connection test, and nothing
 *                                else: the token exchange and GETs, a report
 *                                of counts and names, no sync, no write
 *                                anywhere. It never turns on a sync.
 *   WOVEN_SYNC_ENABLED           the employee sync (manual, dry run or real).
 *                                Off: no sync reaches Woven, whatever the
 *                                validation switch says.
 *   WOVEN_SYNC_SCHEDULE_ENABLED  must ALSO be on before the cron route starts
 *                                a sync, so a manual run never arms an
 *                                unattended schedule — the same two-switch
 *                                shape as the Apify review sync.
 *
 * The validation switch is separate so a first live connection test can run
 * with WOVEN_SYNC_ENABLED=false, when no employee sync is possible at all.
 *
 * Problems are reported by variable NAME, never by value.
 */

export const WOVEN_API_BASE_URL_ENV = "WOVEN_API_BASE_URL";
export const WOVEN_SUBSCRIPTION_KEY_ENV = "WOVEN_SUBSCRIPTION_KEY";
export const WOVEN_USERNAME_ENV = "WOVEN_USERNAME";
export const WOVEN_PASSWORD_ENV = "WOVEN_PASSWORD";
export const WOVEN_SYNC_ENABLED_ENV = "WOVEN_SYNC_ENABLED";
/** The read-only validation's own switch. Independent of, and never implying, WOVEN_SYNC_ENABLED. */
export const WOVEN_VALIDATION_ENABLED_ENV = "WOVEN_VALIDATION_ENABLED";
export const WOVEN_SYNC_SCHEDULE_ENABLED_ENV = "WOVEN_SYNC_SCHEDULE_ENABLED";
export const WOVEN_PAGE_SIZE_ENV = "WOVEN_PAGE_SIZE";
export const WOVEN_MAX_DETAIL_REQUESTS_ENV = "WOVEN_MAX_DETAIL_REQUESTS_PER_RUN";
export const WOVEN_MIN_COMPLETENESS_ENV = "WOVEN_MIN_COMPLETENESS_PERCENT";
/**
 * The domains whose Woven `EmailAddress` may ever be used to SIGN IN. It does
 * not filter what the sync stores: Woven's address is kept as provided. It is
 * read only where login eligibility is decided (the Access Preview in phase
 * one), and while it is unset nobody is eligible.
 */
export const WOVEN_LOGIN_EMAIL_DOMAINS_ENV = "WOVEN_LOGIN_EMAIL_DOMAINS";
/** Optional. Woven's CompanyID (a GUID). Without it, Woven picks the company and says which it chose. */
export const WOVEN_COMPANY_ID_ENV = "WOVEN_COMPANY_ID";
/** Optional. The token request's `Platform` integer (1–4, unnamed in the spec). */
export const WOVEN_PLATFORM_ENV = "WOVEN_PLATFORM";

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
  /*
   * A newly seen employee counts as a NEW HIRE only when their hire (or start)
   * date is within this many days of the sync that first saw them. Older staff
   * appearing for the first time are "newly visible", not hires.
   */
  newHireWindowDays: 30,
} as const;

export const NEW_HIRE_WINDOW_DAYS = DEFAULTS.newHireWindowDays;

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
  /** WOVEN_SYNC_ENABLED: an employee sync may run. The ONLY switch any sync path reads. */
  enabled: boolean;
  /** WOVEN_VALIDATION_ENABLED: the read-only validation may run. Opens no sync. */
  validationEnabled: boolean;
  scheduleEnabled: boolean;
  baseUrl: string;
  /** Null until all three credential variables are set. */
  credentials: WovenCredentials | null;
  /** Names of the credential variables that are missing. Never values. */
  missingCredentials: string[];
  pageSize: number;
  maxDetailRequestsPerRun: number;
  minCompletenessPercent: number;
  /** Lower-cased login-eligible domains. Empty means NOBODY is login-eligible. Never filters storage. */
  loginEmailDomains: string[];
  /** Woven CompanyID for the token request, when configured. Not a secret. */
  companyId: string | null;
  /** The token request's Platform integer, when configured. */
  platform: number | null;
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
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCompanyId(env: Env, problems: string[]): string | null {
  const raw = (env[WOVEN_COMPANY_ID_ENV] ?? "").trim();
  if (raw.length === 0) return null;
  if (!GUID_PATTERN.test(raw)) {
    problems.push(`${WOVEN_COMPANY_ID_ENV} is not a GUID. It was ignored, so Woven will choose the company.`);
    return null;
  }
  return raw.toLowerCase();
}

function readPlatform(env: Env, problems: string[]): number | null {
  const raw = (env[WOVEN_PLATFORM_ENV] ?? "").trim();
  if (raw.length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
    problems.push(`${WOVEN_PLATFORM_ENV} must be 1, 2, 3 or 4. It was ignored.`);
    return null;
  }
  return parsed;
}

function readDomains(env: Env, problems: string[]): string[] {
  const raw = (env[WOVEN_LOGIN_EMAIL_DOMAINS_ENV] ?? "").trim();
  if (raw.length === 0) return [];

  const domains: string[] = [];
  for (const part of raw.split(",")) {
    const domain = part.trim().toLowerCase().replace(/^@/, "");
    if (domain.length === 0) continue;
    if (!DOMAIN_PATTERN.test(domain)) {
      problems.push(`${WOVEN_LOGIN_EMAIL_DOMAINS_ENV} contains an entry that is not a domain name. It was ignored.`);
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
  const validationEnabled = readFlag(env, WOVEN_VALIDATION_ENABLED_ENV);
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
  if (validationEnabled && missingCredentials.length > 0) {
    problems.push(
      `${WOVEN_VALIDATION_ENABLED_ENV} is on but ${missingCredentials.join(", ")} ${
        missingCredentials.length === 1 ? "is" : "are"
      } not set, so the read-only validation cannot run.`,
    );
  }

  return {
    enabled,
    validationEnabled,
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
    loginEmailDomains: readDomains(env, problems),
    companyId: readCompanyId(env, problems),
    platform: readPlatform(env, problems),
    problems,
  };
}
