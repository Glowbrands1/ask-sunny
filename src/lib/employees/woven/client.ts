import "server-only";

import { WOVEN_TRANSPORT, type WovenCredentials } from "./config";
import { describeTokenDiagnostics, diagnoseTokenResponse, type TokenDiagnostics } from "./token-diagnostics";
import {
  DEFAULT_TOKEN_LIFETIME_MS,
  EMPLOYEES_PATH,
  ENUMS_PATH,
  HEADER_ACCESS_TOKEN,
  HEADER_API_VERSION,
  HEADER_SUBSCRIPTION_KEY,
  LOCATIONS_PATH,
  PAGE_ITEM_KEYS,
  PAGE_TOTAL_KEYS,
  QUERY_SKIP,
  QUERY_TAKE,
  TOKEN_PATH,
  TOKEN_RESPONSE_COMPANY_ID_KEY,
  TOKEN_RESPONSE_COMPANY_NAME_KEY,
  TOKEN_RESPONSE_COMPANY_OPTIONS_KEY,
  TOKEN_RESPONSE_EXPIRES_AT_KEYS,
  TOKEN_RESPONSE_EXPIRES_IN_KEYS,
  TOKEN_RESPONSE_MULTI_COMPANY_KEY,
  TOKEN_RESPONSE_TOKEN_KEYS,
  WOVEN_API_VERSION,
  employeeDetailsPath,
  isAllowedReadPath,
  tokenRequestBody,
} from "./contract";

/**
 * ============================================================================
 * THE WOVEN OPERATIONS API CLIENT — the only place Ask Sunny talks to Woven
 * ============================================================================
 *
 * READ-ONLY BY CONSTRUCTION. The single POST this client can make is to
 * `/tokens/v2`, which exchanges the application user's credentials for an
 * AccessToken and changes nothing in Woven. There is no put, patch or delete
 * method to call by mistake, the private sender refuses any other POST, and it
 * refuses a GET to any path `contract.ts` does not list — so none of Woven's
 * write endpoints (employee updates, borrow, primary location, webhooks) is
 * reachable from here, even by a GET.
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
  | "pagination_not_advancing"
  /** POST /tokens/v2 answered 200 with a documented login state but no AccessToken. */
  | "login_refused";

export class WovenApiError extends Error {
  readonly code: WovenErrorCode;
  readonly status: number | null;
  readonly path: string;

  /** Sign-in failures only: what the token response said, sanitized (`token-diagnostics.ts`). */
  readonly diagnostics: TokenDiagnostics | null;

  constructor(
    code: WovenErrorCode,
    message: string,
    options: { status?: number | null; path: string; diagnostics?: TokenDiagnostics | null },
  ) {
    super(message);
    this.name = "WovenApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.path = options.path;
    this.diagnostics = options.diagnostics ?? null;
  }
}

/** Query parameters for `GET /employees`, by their spec names (see `contract.ts`). Paging is added by the client. */
export type EmployeeListQuery = Readonly<Record<string, string | undefined>>;

export interface EmployeeListResult {
  records: unknown[];
  pages: number;
  /** The total Woven reported, when it reported one. */
  reportedTotal: number | null;
  /** Records per page, in order — how live validation detects a capped `querytake`. */
  pageSizes: number[];
  /** Whether pages arrive as a bare array or inside an envelope. */
  shape: "array" | "envelope";
  /** The envelope's own KEY NAMES (never values), when there is one. */
  envelopeKeys: string[];
}

/**
 * What the token exchange looked like, for live validation: the response's
 * KEY NAMES and where the lifetime came from. The token itself is never kept
 * here.
 */
export interface TokenInfo {
  responseKeys: string[];
  tokenFrom: "body" | "header";
  lifetimeSource: "expires_in" | "expires_at" | "default";
  lifetimeSeconds: number;
  /**
   * The company Woven issued the token for, and the companies the user could
   * choose. GUIDs and business names — identifiers, not secrets — reported so
   * `WOVEN_COMPANY_ID` can be discovered by the read-only sign-in check.
   */
  companyId: string | null;
  companyName: string | null;
  hasMultipleCompanyAccess: boolean | null;
  companyOptions: { companyId: string; companyName: string | null }[];
  /** Whether the request sent a configured CompanyID. */
  companyIdSent: boolean;
}

type Transport = { -readonly [K in keyof typeof WOVEN_TRANSPORT]: number };

export interface WovenClientOptions {
  baseUrl: string;
  credentials: WovenCredentials;
  /** Optional token-request fields (`contract.ts` → `tokenRequestBody`). */
  companyId?: string | null;
  platform?: number | null;
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

/** The most of a token response ever read. It is small; an HTML error page need not be read whole. */
const MAX_TOKEN_BODY_CHARS = 64 * 1024;

/** `AuthenticationJwtResponse` fields that describe a login state, lower-cased. */
const LOGIN_STATE_KEYS = new Set(
  [
    "FailedLoginAttempt",
    "AccountStatus",
    "TwoFactorAuthentication",
    "HasMultipleCompanyAccess",
    "CompanyLoginOptions",
    "ForcePasswordChange",
    "RequireTermsSigned",
    "RequireOnboarding",
  ].map((k) => k.toLowerCase()),
);
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
  private readonly companyId: string | null;
  private readonly platform: number | null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly transport: Transport;
  private readonly deadlineAt: number | null;

  private token: { value: string; expiresAt: number } | null = null;
  private lastRequestStartedAt: number | null = null;
  private requests = 0;
  private tokenRequests = 0;
  private tokenInfoValue: TokenInfo | null = null;

  constructor(options: WovenClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.credentials = options.credentials;
    this.companyId = options.companyId ?? null;
    this.platform = options.platform ?? null;
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

  /** Shape of the most recent token response. Key names only. */
  get tokenInfo(): TokenInfo | null {
    return this.tokenInfoValue;
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
    query: EmployeeListQuery,
    pageSize: number,
    options: { maxPages?: number } = {},
  ): Promise<EmployeeListResult> {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const records: unknown[] = [];
    const pageSizes: number[] = [];
    let shape: EmployeeListResult["shape"] = "array";
    let envelopeKeys: string[] = [];
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
        ...query,
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
      pageSizes.push(page.items.length);
      if (pages === 1 && !Array.isArray(body) && typeof body === "object" && body !== null) {
        shape = "envelope";
        envelopeKeys = Object.keys(body).sort();
      }
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

    return { records, pages, reportedTotal, pageSizes, shape, envelopeKeys };
  }

  async getEmployeeDetails(employeeId: string): Promise<unknown> {
    return this.get(employeeDetailsPath(employeeId));
  }

  /** `GET /locations` — `Location[]`, the integration user's locations. */
  async listLocations(): Promise<unknown> {
    return this.get(LOCATIONS_PATH);
  }

  /** `GET /lists/enums` — Woven's names for its integer enums. */
  async listEnums(): Promise<unknown> {
    return this.get(ENUMS_PATH);
  }

  /* ----------------------------------------------------- authentication -- */

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    this.token = await this.authenticate();
    return this.token.value;
  }

  private async authenticate(): Promise<{ value: string; expiresAt: number }> {
    const body = JSON.stringify(
      tokenRequestBody({
        username: this.credentials.username,
        password: this.credentials.password,
        companyId: this.companyId,
        platform: this.platform,
      }),
    );
    this.tokenRequests += 1;
    /* The request is exactly the spec's: Subscription-Key and ApiVersion headers, AuthenticationRequest body. */
    const response = await this.sendWithRetries("POST", TOKEN_PATH, { body }, { returnFinalFailure: true });

    const headerToken = response.headers.get(HEADER_ACCESS_TOKEN);
    const text = (await response.text()).slice(0, MAX_TOKEN_BODY_CHARS);
    /*
     * Built only when the sign-in fails, and only from `token-diagnostics.ts`,
     * which reads named fields and redacts every string — the credentials
     * among them — before anything is kept.
     */
    const diagnose = () =>
      diagnoseTokenResponse({
        status: response.status,
        contentType: response.headers.get("content-type"),
        text,
        companyIdSent: Boolean(this.companyId),
        platformSent: Boolean(this.platform),
        secrets: [this.credentials.subscriptionKey, this.credentials.username, this.credentials.password],
      });
    const failWith = (code: WovenErrorCode): never => {
      const diagnostics = diagnose();
      throw new WovenApiError(code, describeTokenDiagnostics(diagnostics), {
        status: response.status,
        path: TOKEN_PATH,
        diagnostics,
      });
    };

    if (!response.ok) {
      failWith(
        response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "server_error"
            : response.status === 403
              ? "forbidden"
              : "auth_failed",
      );
    }

    let parsed: unknown = null;
    if (text.trim().length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        failWith("bad_response");
      }
    } else if (headerToken === null) {
      failWith("bad_response");
    }

    let value: string | null = null;
    let lifetimeMs = DEFAULT_TOKEN_LIFETIME_MS;
    let lifetimeSource: TokenInfo["lifetimeSource"] = "default";
    let tokenFrom: TokenInfo["tokenFrom"] = "body";

    if (typeof parsed === "string") {
      value = parsed;
    } else if (isRecord(parsed)) {
      const raw = firstPresent(parsed, TOKEN_RESPONSE_TOKEN_KEYS);
      if (typeof raw === "string") value = raw;

      const expiresIn = firstPresent(parsed, TOKEN_RESPONSE_EXPIRES_IN_KEYS);
      const expiresAt = firstPresent(parsed, TOKEN_RESPONSE_EXPIRES_AT_KEYS);
      if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
        lifetimeMs = expiresIn * 1000;
        lifetimeSource = "expires_in";
      } else if (typeof expiresAt === "string") {
        const at = Date.parse(expiresAt);
        if (Number.isFinite(at)) {
          lifetimeMs = at - this.now();
          lifetimeSource = "expires_at";
        }
      }
    }
    if (value === null && headerToken !== null) {
      value = headerToken;
      tokenFrom = "header";
    }

    if (value === null || value.trim().length === 0) {
      /*
       * A JSON answer carrying the spec's login-state fields but no token is a
       * refused or unfinished sign-in, which the spec allows — not a
       * malformed response.
       */
      const documentedLoginState =
        isRecord(parsed) && Object.keys(parsed).some((key) => LOGIN_STATE_KEYS.has(key.toLowerCase()));
      failWith(documentedLoginState ? "login_refused" : "bad_response");
    }
    if (value === null) throw new Error("unreachable");

    lifetimeMs = Math.min(Math.max(lifetimeMs, 0), MAX_TOKEN_LIFETIME_MS);
    const record = isRecord(parsed) ? parsed : {};
    const guid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
    const name = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
    const options = Array.isArray(record[TOKEN_RESPONSE_COMPANY_OPTIONS_KEY])
      ? (record[TOKEN_RESPONSE_COMPANY_OPTIONS_KEY] as unknown[])
      : [];
    this.tokenInfoValue = {
      responseKeys: Object.keys(record).sort(),
      tokenFrom,
      lifetimeSource,
      lifetimeSeconds: Math.round(lifetimeMs / 1000),
      companyId: guid(record[TOKEN_RESPONSE_COMPANY_ID_KEY]),
      companyName: name(record[TOKEN_RESPONSE_COMPANY_NAME_KEY]),
      hasMultipleCompanyAccess:
        typeof record[TOKEN_RESPONSE_MULTI_COMPANY_KEY] === "boolean"
          ? (record[TOKEN_RESPONSE_MULTI_COMPANY_KEY] as boolean)
          : null,
      companyOptions: options
        .filter(isRecord)
        .map((o) => ({ companyId: guid(o.CompanyID), companyName: name(o.CompanyName) }))
        .filter((o): o is { companyId: string; companyName: string | null } => o.companyId !== null)
        .slice(0, 25),
      companyIdSent: this.companyId !== null,
    };
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
    behaviour: { returnFinalFailure?: boolean } = {},
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
        /* The sign-in keeps its last failed answer, so it can be described (sanitized) rather than lost. */
        if (behaviour.returnFinalFailure && attempt >= this.transport.maxRetries) return response;
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
    if (method === "GET" && !isAllowedReadPath(path)) {
      throw new Error(`The Woven client reads only the endpoints contract.ts lists; ${path} is not one of them.`);
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
