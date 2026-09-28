import "server-only";

import { WOVEN_TRANSPORT, type WovenCredentials } from "./config";
import {
  DEFAULT_TOKEN_LIFETIME_MS,
  EMPLOYEES_PATH,
  HEADER_ACCESS_TOKEN,
  HEADER_API_VERSION,
  HEADER_SUBSCRIPTION_KEY,
  PAGE_ITEM_KEYS,
  PAGE_TOTAL_KEYS,
  QUERY_LOCATION,
  QUERY_POSITION,
  QUERY_SKIP,
  QUERY_STATUS,
  QUERY_TAKE,
  TOKEN_PATH,
  TOKEN_RESPONSE_EXPIRES_AT_KEYS,
  TOKEN_RESPONSE_EXPIRES_IN_KEYS,
  TOKEN_RESPONSE_TOKEN_KEYS,
  WOVEN_API_VERSION,
  employeeDetailsPath,
  tokenRequestBody,
} from "./contract";

/**
 * ============================================================================
 * THE WOVEN OPERATIONS API CLIENT — the only place Ask Sunny talks to Woven
 * ============================================================================
 *
 * READ-ONLY BY CONSTRUCTION. The only public data method is `get`. The single
 * POST this client can make is to `/tokens/v2`, which exchanges the
 * application user's credentials for an AccessToken and changes nothing in
 * Woven. There is no put, patch or delete method to call by mistake, and the
 * private sender refuses any other POST path.
 *
 * NOTHING SECRET LEAVES THIS FILE. The subscription key, the password and the
 * AccessToken go into request headers and a request body and nowhere else: not
 * into a URL, not into an error message, not into a log line. Error messages
 * carry a code, the request PATH and the HTTP status — never a response body,
 * because an error body from an HR system can echo back the record it was
 * about.
 *
 * WITHIN WOVEN'S LIMIT. Roughly 100 requests a minute per subscription key.
 * Requests are paced to stay under it, a 429 is honoured with its
 * `Retry-After`, and every retry is bounded.
 */

export type WovenErrorCode =
  | "auth_failed"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "network"
  | "server_error"
  | "bad_response"
  | "request_rejected"
  | "deadline_exceeded"
  | "pagination_runaway"
  | "pagination_not_advancing";

export class WovenApiError extends Error {
  readonly code: WovenErrorCode;
  readonly status: number | null;
  readonly path: string;

  constructor(code: WovenErrorCode, message: string, options: { status?: number | null; path: string }) {
    super(message);
    this.name = "WovenApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.path = options.path;
  }
}

export interface EmployeeListFilter {
  status?: string;
  locationId?: string;
  positionId?: string;
}

export interface EmployeeListResult {
  records: unknown[];
  pages: number;
  /** The total Woven reported, when it reported one. */
  reportedTotal: number | null;
}

type Transport = { -readonly [K in keyof typeof WOVEN_TRANSPORT]: number };

export interface WovenClientOptions {
  baseUrl: string;
  credentials: WovenCredentials;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  transport?: Partial<Transport>;
  /**
   * An instant (epoch ms) after which no new request or wait is started. The
   * sync sets it inside the serverless invocation's wall clock, so a slow run
   * stops cleanly with `deadline_exceeded` instead of being killed mid-write.
   */
  deadlineAt?: number | null;
}

type Query = Record<string, string | number | undefined>;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The longest a token is trusted for, whatever the response claims. */
const MAX_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const DEFAULT_MAX_PAGES = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstPresent(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key) && record[key] !== null && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* Nothing to do: the body is being thrown away either way. */
  }
}

/**
 * A paged response is either a bare array or an envelope. Returns null when it
 * is neither, which the caller reports as `bad_response` rather than as an
 * empty page — an unrecognised shape read as "no employees" would look like
 * every employee disappearing.
 */
export function extractPage(body: unknown): { items: unknown[]; total: number | null } | null {
  if (Array.isArray(body)) return { items: body, total: null };
  if (!isRecord(body)) return null;

  for (const key of PAGE_ITEM_KEYS) {
    if (Object.hasOwn(body, key) && Array.isArray(body[key])) {
      const totalRaw = firstPresent(body, PAGE_TOTAL_KEYS);
      const total =
        typeof totalRaw === "number" && Number.isInteger(totalRaw) && totalRaw >= 0 ? totalRaw : null;
      return { items: body[key] as unknown[], total };
    }
  }
  return null;
}

/** A stable identity for a page's first record, used only to detect a skip being ignored. */
function pageFingerprint(items: unknown[]): string | null {
  const first = items[0];
  if (!isRecord(first)) return null;
  const id = firstPresent(first, ["EmployeeID", "EmployeeId", "employeeId", "Id", "ID", "id"]);
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export class WovenClient {
  private readonly baseUrl: string;
  private readonly credentials: WovenCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly transport: Transport;
  private readonly deadlineAt: number | null;

  private token: { value: string; expiresAt: number } | null = null;
  private lastRequestStartedAt: number | null = null;
  private requests = 0;
  private tokenRequests = 0;

  constructor(options: WovenClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.credentials = options.credentials;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.transport = { ...WOVEN_TRANSPORT, ...options.transport };
    this.deadlineAt = options.deadlineAt ?? null;
  }

  /** Every HTTP request made, token requests included. */
  get requestsMade(): number {
    return this.requests;
  }

  get tokenRequestsMade(): number {
    return this.tokenRequests;
  }

  /* ------------------------------------------------------------ reads -- */

  /**
   * One GET, with authentication, pacing, bounded retries and one re-login on
   * a 401. Returns the parsed JSON body.
   */
  async get(path: string, query: Query = {}): Promise<unknown> {
    let reauthenticated = false;

    for (;;) {
      const token = await this.accessToken();
      const response = await this.sendWithRetries("GET", path, { query, token });

      if (response.ok) return this.readJson(response, path);

      await discard(response);

      if (response.status === 401) {
        /*
         * ONE re-login, then stop. A token can expire between being checked and
         * being used, and a second login fixes that. A second 401 means the
         * credential itself is wrong, and retrying it would only burn the rate
         * limit and risk locking the application user out.
         */
        if (!reauthenticated) {
          reauthenticated = true;
          this.token = null;
          continue;
        }
        throw new WovenApiError("auth_failed", `Woven refused the access token for ${path} (HTTP 401).`, {
          status: 401,
          path,
        });
      }
      if (response.status === 403) {
        throw new WovenApiError(
          "forbidden",
          `Woven refused ${path} (HTTP 403). The subscription may not be approved for this product, or the application user lacks access.`,
          { status: 403, path },
        );
      }
      if (response.status === 404) {
        throw new WovenApiError("not_found", `Woven has no resource at ${path} (HTTP 404).`, { status: 404, path });
      }
      throw new WovenApiError("request_rejected", `Woven rejected ${path} (HTTP ${response.status}).`, {
        status: response.status,
        path,
      });
    }
  }

  /**
   * Every page of `/employees` for one filter, via `queryskip` / `querytake`.
   *
   * IT READS UNTIL AN EMPTY PAGE, not until a short one. A gateway that caps
   * `querytake` below what was asked would otherwise return a "short" first
   * page and end the read after it, silently dropping everybody else. The cost
   * is one extra request per pass. When Woven reports a total, the read also
   * stops once that many records have arrived.
   */
  async listEmployees(
    filter: EmployeeListFilter,
    pageSize: number,
    options: { maxPages?: number } = {},
  ): Promise<EmployeeListResult> {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const records: unknown[] = [];
    let skip = 0;
    let pages = 0;
    let reportedTotal: number | null = null;
    let previousFingerprint: string | null = null;

    for (;;) {
      if (pages >= maxPages) {
        throw new WovenApiError(
          "pagination_runaway",
          `Reading ${EMPLOYEES_PATH} did not finish within ${maxPages} pages.`,
          { path: EMPLOYEES_PATH },
        );
      }

      const body = await this.get(EMPLOYEES_PATH, {
        [QUERY_STATUS]: filter.status,
        [QUERY_LOCATION]: filter.locationId,
        [QUERY_POSITION]: filter.positionId,
        [QUERY_SKIP]: skip,
        [QUERY_TAKE]: pageSize,
      });
      const page = extractPage(body);
      if (!page) {
        throw new WovenApiError(
          "bad_response",
          `Woven answered ${EMPLOYEES_PATH} with a shape that is neither a list nor a recognised page envelope.`,
          { path: EMPLOYEES_PATH },
        );
      }
      pages += 1;
      if (page.total !== null) reportedTotal = page.total;
      if (page.items.length === 0) break;

      /*
       * A GATEWAY THAT IGNORES `queryskip` returns page one forever. Without
       * this check the read would run to `maxPages`, and every employee would
       * be counted many times over.
       */
      const fingerprint = pageFingerprint(page.items);
      if (fingerprint !== null && fingerprint === previousFingerprint) {
        throw new WovenApiError(
          "pagination_not_advancing",
          `${EMPLOYEES_PATH} returned the same page twice; ${QUERY_SKIP} does not appear to be honoured.`,
          { path: EMPLOYEES_PATH },
        );
      }
      previousFingerprint = fingerprint;

      records.push(...page.items);
      skip += page.items.length;
      if (reportedTotal !== null && skip >= reportedTotal) break;
    }

    return { records, pages, reportedTotal };
  }

  async getEmployeeDetails(employeeId: string): Promise<unknown> {
    return this.get(employeeDetailsPath(employeeId));
  }

  /* ----------------------------------------------------- authentication -- */

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    this.token = await this.authenticate();
    return this.token.value;
  }

  private async authenticate(): Promise<{ value: string; expiresAt: number }> {
    const body = JSON.stringify(tokenRequestBody(this.credentials.username, this.credentials.password));
    this.tokenRequests += 1;
    const response = await this.sendWithRetries("POST", TOKEN_PATH, { body });

    if (!response.ok) {
      await discard(response);
      if (response.status === 403) {
        throw new WovenApiError(
          "forbidden",
          `Woven refused the token request (HTTP 403). The subscription key may not be approved yet.`,
          { status: 403, path: TOKEN_PATH },
        );
      }
      throw new WovenApiError(
        "auth_failed",
        `Woven did not issue an access token (HTTP ${response.status}). Check the subscription key and the application user.`,
        { status: response.status, path: TOKEN_PATH },
      );
    }

    const headerToken = response.headers.get(HEADER_ACCESS_TOKEN);
    const parsed = await this.readJson(response, TOKEN_PATH, { allowEmpty: headerToken !== null });

    let value: string | null = null;
    let lifetimeMs = DEFAULT_TOKEN_LIFETIME_MS;

    if (typeof parsed === "string") {
      value = parsed;
    } else if (isRecord(parsed)) {
      const raw = firstPresent(parsed, TOKEN_RESPONSE_TOKEN_KEYS);
      if (typeof raw === "string") value = raw;

      const expiresIn = firstPresent(parsed, TOKEN_RESPONSE_EXPIRES_IN_KEYS);
      const expiresAt = firstPresent(parsed, TOKEN_RESPONSE_EXPIRES_AT_KEYS);
      if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
        lifetimeMs = expiresIn * 1000;
      } else if (typeof expiresAt === "string") {
        const at = Date.parse(expiresAt);
        if (Number.isFinite(at)) lifetimeMs = at - this.now();
      }
    }
    if (value === null && headerToken !== null) value = headerToken;

    if (value === null || value.trim().length === 0) {
      throw new WovenApiError("bad_response", "Woven's token response carried no AccessToken.", {
        path: TOKEN_PATH,
      });
    }

    lifetimeMs = Math.min(Math.max(lifetimeMs, 0), MAX_TOKEN_LIFETIME_MS);
    /* Refresh early, but never so early that a short-lived token is never used. */
    const skew = Math.min(TOKEN_REFRESH_SKEW_MS, lifetimeMs / 2);
    return { value: value.trim(), expiresAt: this.now() + lifetimeMs - skew };
  }

  /* ---------------------------------------------------------- transport -- */

  private async readJson(response: Response, path: string, options: { allowEmpty?: boolean } = {}): Promise<unknown> {
    const text = await response.text();
    if (text.trim().length === 0) {
      if (options.allowEmpty) return null;
      throw new WovenApiError("bad_response", `Woven answered ${path} with an empty body.`, {
        status: response.status,
        path,
      });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new WovenApiError("bad_response", `Woven answered ${path} with a body that is not JSON.`, {
        status: response.status,
        path,
      });
    }
  }

  private backoff(attempt: number): number {
    return this.transport.baseBackoffMs * 2 ** attempt;
  }

  /** The wait a 429 asks for, or null when it asks for longer than we will wait. */
  private retryAfter(response: Response, attempt: number): number | null {
    const header = response.headers.get("retry-after");
    let waitMs = this.backoff(attempt);
    if (header !== null) {
      const seconds = Number(header.trim());
      if (Number.isFinite(seconds) && seconds >= 0) {
        waitMs = seconds * 1000;
      } else {
        const at = Date.parse(header);
        if (Number.isFinite(at)) waitMs = Math.max(at - this.now(), 0);
      }
    }
    return waitMs > this.transport.maxRetryAfterMs ? null : waitMs;
  }

  private assertBeforeDeadline(path: string, extraMs = 0): void {
    if (this.deadlineAt !== null && this.now() + extraMs >= this.deadlineAt) {
      throw new WovenApiError(
        "deadline_exceeded",
        `The sync's time budget ran out before ${path} could be read.`,
        { path },
      );
    }
  }

  private async pause(ms: number, path: string): Promise<void> {
    if (ms <= 0) return;
    this.assertBeforeDeadline(path, ms);
    await this.sleep(ms);
  }

  /**
   * Sends, retrying ONLY what is transient: 429, 5xx, a timeout and a network
   * failure. Returns any other response — success, 4xx — for the caller to
   * interpret. Each retry waits, and the number of retries is bounded.
   */
  private async sendWithRetries(
    method: "GET" | "POST",
    path: string,
    options: { query?: Query; token?: string; body?: string },
  ): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.send(method, path, options);
      } catch (error) {
        const transient =
          error instanceof WovenApiError && (error.code === "timeout" || error.code === "network");
        if (transient && attempt < this.transport.maxRetries) {
          await this.pause(this.backoff(attempt), path);
          continue;
        }
        throw error;
      }

      const rateLimited = response.status === 429;
      if (rateLimited || response.status >= 500) {
        await discard(response);
        if (attempt < this.transport.maxRetries) {
          const waitMs = rateLimited ? this.retryAfter(response, attempt) : this.backoff(attempt);
          if (waitMs === null) {
            throw new WovenApiError(
              "rate_limited",
              `Woven rate-limited ${path} and asked for a longer wait than this sync allows.`,
              { status: 429, path },
            );
          }
          await this.pause(waitMs, path);
          continue;
        }
        throw new WovenApiError(
          rateLimited ? "rate_limited" : "server_error",
          rateLimited
            ? `Woven kept rate-limiting ${path} after ${this.transport.maxRetries} retries.`
            : `Woven failed ${path} (HTTP ${response.status}) after ${this.transport.maxRetries} retries.`,
          { status: response.status, path },
        );
      }
      return response;
    }
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    options: { query?: Query; token?: string; body?: string },
  ): Promise<Response> {
    /*
     * THE WRITE GUARD. The only POST is the token exchange. Anything else would
     * be a change to Woven, which phase one never makes.
     */
    if (method === "POST" && path !== TOKEN_PATH) {
      throw new Error("The Woven client is read-only: the token exchange is the only POST it may send.");
    }

    /* Pacing: space request STARTS so a burst cannot exceed the per-minute limit. */
    if (this.lastRequestStartedAt !== null) {
      const waitMs = this.lastRequestStartedAt + this.transport.minIntervalMs - this.now();
      await this.pause(waitMs, path);
    }
    this.assertBeforeDeadline(path);

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      [HEADER_SUBSCRIPTION_KEY]: this.credentials.subscriptionKey,
      [HEADER_API_VERSION]: WOVEN_API_VERSION,
    };
    if (options.token) headers[HEADER_ACCESS_TOKEN] = options.token;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let timeoutMs = this.transport.requestTimeoutMs;
    if (this.deadlineAt !== null) timeoutMs = Math.min(timeoutMs, Math.max(this.deadlineAt - this.now(), 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    this.lastRequestStartedAt = this.now();
    this.requests += 1;

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: options.body,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      /*
       * The underlying error is dropped on purpose: a fetch failure's message
       * or cause can include the URL and, in some runtimes, request details.
       */
      if (controller.signal.aborted) {
        throw new WovenApiError("timeout", `Woven did not answer ${path} within ${timeoutMs} ms.`, { path });
      }
      throw new WovenApiError("network", `Woven could not be reached for ${path}.`, { path });
    } finally {
      clearTimeout(timer);
    }
  }
}
