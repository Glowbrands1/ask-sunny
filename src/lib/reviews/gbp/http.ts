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

async function readGoogleError(response: Response): Promise<{ message: string; status: string | null }> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown; status?: unknown } | string;
      error_description?: unknown;
    };
    if (typeof body.error === "string") {
      return { message: body.error.slice(0, 120), status: body.error.slice(0, 60) };
    }
    const message = typeof body.error?.message === "string" ? body.error.message : "";
    const status = typeof body.error?.status === "string" ? body.error.status : null;
    return { message: message.slice(0, 200), status };
  } catch {
    return { message: "", status: null };
  }
}

export function classifyFailure(status: number, googleStatus: string | null): GbpApiError {
  if (status === 401) return new GbpApiError("auth_failed", "Google rejected the access token.", { status });
  if (status === 403) {
    return new GbpApiError(
      "forbidden",
      "Google refused access. The Business Profile API may not be approved or enabled for this project, or the account lacks access to the location.",
      { status, googleStatus },
    );
  }
  if (status === 404) return new GbpApiError("not_found", "Google could not find that resource.", { status, googleStatus });
  if (status === 429) {
    return new GbpApiError("quota_exhausted", "Google's request quota is exhausted.", {
      status,
      googleStatus,
      retryable: true,
    });
  }
  if (status >= 500 || status === 408) {
    return new GbpApiError("upstream_unavailable", "Google is temporarily unavailable.", {
      status,
      googleStatus,
      retryable: true,
    });
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
      response = await deps.fetch(url, init);
    } catch {
      lastError = new GbpApiError("upstream_unavailable", "The request to Google could not be completed.", {
        retryable: true,
      });
      if (attempt === MAX_ATTEMPTS) break;
      await deps.sleep(backoffMs(attempt, null, deps.random));
      continue;
    }

    if (response.ok) return response;

    const { status: googleStatus } = await readGoogleError(response);
    const failure = classifyFailure(response.status, googleStatus);

    if (!RETRYABLE_STATUSES.has(response.status)) throw failure;

    lastError = failure;
    if (attempt === MAX_ATTEMPTS) break;
    await deps.sleep(backoffMs(attempt, response.headers.get("retry-after"), deps.random));
  }

  throw lastError ?? new GbpApiError("upstream_unavailable", "The request to Google failed.", { retryable: true });
}
