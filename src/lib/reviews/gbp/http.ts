import "server-only";

/**
 * Google HTTP transport: retries, backoff, quota handling, redaction.
 *
 * WHAT IS RETRIED: network failures, 408, 429, 500, 502, 503, 504. Honouring
 * `Retry-After` when Google sends it, otherwise exponential backoff with jitter.
 *
 * WHAT IS NOT: 400, 401 (handled one level up by a single token refresh), 403,
 * 404. A 403 is access or an unapproved API; retrying it only burns quota.
 *
 * NOTHING SECRET REACHES AN ERROR. Google error bodies can echo request
 * details, so only Google's own status string and a short message are kept.
 */

export type GbpErrorCode =
  | "auth_revoked"
  | "auth_failed"
  | "api_disabled"
  | "api_access_pending"
  | "forbidden"
  | "not_found"
  | "quota_exhausted"
  | "bad_request"
  | "upstream_unavailable"
  | "request_budget_exceeded"
  | "invalid_response";

export class GbpApiError extends Error {
  readonly code: GbpErrorCode;
  readonly status: number | null;
  readonly googleStatus: string | null;
  /** Whether the same call could succeed later with no change on our side. */
  readonly retryable: boolean;

  constructor(
    code: GbpErrorCode,
    message: string,
    options: { status?: number | null; googleStatus?: string | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "GbpApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.googleStatus = options.googleStatus ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const defaultHttpDeps: HttpDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 20_000;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function backoffMs(attempt: number, retryAfterHeader: string | null, random: () => number): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
    const date = Date.parse(retryAfterHeader);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_DELAY_MS);
  }
  const exponential = BASE_DELAY_MS * 2 ** (attempt - 1);
  /* Up to 25% jitter, so concurrent runs do not retry in lockstep. */
  return Math.min(exponential + exponential * 0.25 * random(), MAX_DELAY_MS);
}

export interface GoogleErrorFacts {
  status: string | null;
  reasons: string[];
  quotaLimitValue: string | null;
  message: string;
}

/**
 * Reads Google's STRUCTURED error facts (status string, `details[].reason`,
 * quota metadata). Classification relies on these, not on message text, and the
 * message is used only as a fallback and then dropped — it can quote project
 * identifiers and is never kept or returned.
 */
export function readErrorFacts(body: unknown): GoogleErrorFacts {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  const e = (error && typeof error === "object" ? error : {}) as { status?: unknown; message?: unknown; details?: unknown };
  const reasons: string[] = [];
  let quotaLimitValue: string | null = null;
  if (Array.isArray(e.details)) {
    for (const d of e.details) {
      if (!d || typeof d !== "object") continue;
      const detail = d as { reason?: unknown; metadata?: unknown };
      if (typeof detail.reason === "string") reasons.push(detail.reason);
      const meta = detail.metadata && typeof detail.metadata === "object" ? (detail.metadata as Record<string, unknown>) : null;
      if (meta && typeof meta.quota_limit_value === "string") quotaLimitValue = meta.quota_limit_value;
    }
  }
  return {
    status: typeof e.status === "string" ? e.status : null,
    reasons,
    quotaLimitValue,
    message: typeof e.message === "string" ? e.message.slice(0, 600) : "",
  };
}

async function readGoogleError(response: Response): Promise<GoogleErrorFacts> {
  try {
    return readErrorFacts(await response.json());
  } catch {
    return { status: null, reasons: [], quotaLimitValue: null, message: "" };
  }
}

export function classifyFailure(status: number, facts: GoogleErrorFacts | string | null): GbpApiError {
  const f: GoogleErrorFacts =
    facts && typeof facts === "object"
      ? facts
      : { status: facts, reasons: [], quotaLimitValue: null, message: "" };
  const googleStatus = f.status;

  if (status === 401) return new GbpApiError("auth_failed", "Google rejected the access token.", { status });

  const notEnabled =
    f.reasons.includes("SERVICE_DISABLED") ||
    /has not been used in project|is disabled|API has not been enabled/i.test(f.message);
  if (status === 403 && notEnabled) {
    return new GbpApiError("api_disabled", "A Business Profile API is not enabled in the Google Cloud project.", { status, googleStatus });
  }

  /*
   * A quota LIMIT OF ZERO is the signature of a Google Cloud project that has not
   * been APPROVED for the Business Profile APIs. It is a 429, but waiting does not
   * help and retrying only burns requests, so it is its own permanent code.
   */
  const exhausted =
    status === 429 ||
    f.status === "RESOURCE_EXHAUSTED" ||
    f.reasons.includes("RATE_LIMIT_EXCEEDED") ||
    f.reasons.includes("RESOURCE_EXHAUSTED");
  if (exhausted && f.quotaLimitValue === "0") {
    return new GbpApiError(
      "api_access_pending",
      "Google has not yet approved this Google Cloud project for the Business Profile APIs (quota limit 0).",
      { status, googleStatus },
    );
  }
  if (status === 403) {
    return new GbpApiError(
      "forbidden",
      "Google refused access. The account may lack access to the location, or the API is not approved for this project.",
      { status, googleStatus },
    );
  }
  if (status === 404) return new GbpApiError("not_found", "Google could not find that resource.", { status, googleStatus });
  if (exhausted) {
    return new GbpApiError("quota_exhausted", "Google's request quota is exhausted.", { status, googleStatus, retryable: true });
  }
  if (status >= 500 || status === 408) {
    return new GbpApiError("upstream_unavailable", "Google is temporarily unavailable.", { status, googleStatus, retryable: true });
  }
  return new GbpApiError("bad_request", "Google rejected the request.", { status, googleStatus });
}

/**
 * One logical request with bounded retries. Returns the successful Response;
 * throws `GbpApiError` otherwise. `onAttempt` lets the caller charge each real
 * network request against its per-run budget.
 */
export async function requestWithRetry(
  url: string,
  init: RequestInit,
  deps: HttpDeps = defaultHttpDeps,
  onAttempt?: () => void,
): Promise<Response> {
  let lastError: GbpApiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    onAttempt?.();

    let response: Response;
    try {
      /* Per-request timeout, and a redirect is an error: nothing here follows one. */
      response = await deps.fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      lastError = new GbpApiError("upstream_unavailable", "The request to Google could not be completed.", {
        retryable: true,
      });
      if (attempt === MAX_ATTEMPTS) break;
      await deps.sleep(backoffMs(attempt, null, deps.random));
      continue;
    }

    if (response.ok) return response;

    const facts = await readGoogleError(response);
    const failure = classifyFailure(response.status, facts);

    /* Permanent even though the status is 429 (a zero quota never recovers by waiting). */
    if (!failure.retryable) throw failure;
    if (!RETRYABLE_STATUSES.has(response.status)) throw failure;

    lastError = failure;
    if (attempt === MAX_ATTEMPTS) break;
    await deps.sleep(backoffMs(attempt, response.headers.get("retry-after"), deps.random));
  }

  throw lastError ?? new GbpApiError("upstream_unavailable", "The request to Google failed.", { retryable: true });
}
