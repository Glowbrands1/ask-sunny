import "server-only";

import { WOVEN_TEAM_TRANSPORT } from "./config";
import {
  ANTIFORGERY_ERROR_MARKER,
  ANTIFORGERY_HEADER,
  DOWNLOAD_HOST_PATTERN,
  LOGIN_FIELDS,
  LOGIN_FORM_MARKER,
  LOGIN_PATH_PREFIXES,
} from "./contract";
import { attr, elementsByTag, parseHtmlDocument } from "./html";

type ParsedPage = ReturnType<typeof parseHtmlDocument>;

/** The value of the first `<input name=…>` in a page, or null. */
export function hiddenInputValue(page: ParsedPage, name: string): string | null {
  const input = elementsByTag(page, "input").find((el) => attr(el, "name") === name);
  const value = input ? attr(input, "value") : null;
  return value && value.length > 0 ? value : null;
}

/**
 * ============================================================================
 * THE WOVEN TEAM HTTP CLIENT — same-origin, cookie session, read-only
 * ============================================================================
 *
 * Once signed in, Ask Sunny makes the same same-origin requests the Woven Team
 * web app makes, with the session cookie it was issued. No browser is driven.
 *
 * FAILS CLOSED. A read that answers with a redirect to the login page, a login
 * form, a 401/403, an anti-forgery refusal, or HTML where JSON was expected is
 * a SESSION or SHAPE failure — never "no content". An empty list can only come
 * from a successful, well-formed response, and even then the reconciliation
 * guards decide whether it is believed.
 *
 * NOTHING SECRET LEAVES THIS FILE. Cookies live in an in-memory jar for one
 * run. Errors carry a code, a PATH (never a query string) and a status — never
 * a response body, a cookie or a URL. Signed storage URLs are fetched WITHOUT
 * the Woven cookie, from an allowlisted host only, and never appear in an
 * error message.
 */

export type WovenTeamErrorCode =
  | "login_page_changed"
  | "login_failed"
  | "company_selection_unverified"
  | "company_not_verified"
  | "session_expired"
  | "antiforgery_rejected"
  | "forbidden"
  | "not_found"
  | "bad_response"
  | "server_error"
  | "rate_limited"
  | "timeout"
  | "network"
  | "deadline_exceeded"
  | "redirect_off_origin"
  | "download_host_not_allowed"
  | "download_link_expired"
  | "download_failed"
  | "too_large";

export class WovenTeamError extends Error {
  readonly code: WovenTeamErrorCode;
  readonly status: number | null;
  readonly path: string;
  /** True when the SESSION is gone, not just one item: the engine stops starting work. */
  readonly sessionLost: boolean;

  constructor(code: WovenTeamErrorCode, message: string, options: { status?: number | null; path: string; sessionLost?: boolean }) {
    super(message);
    this.name = "WovenTeamError";
    this.code = code;
    this.status = options.status ?? null;
    this.path = options.path;
    this.sessionLost = options.sessionLost ?? false;
  }
}

/** The path part only — a query can carry ids, and a signed URL's carries its signature. */
export function safePath(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, "https://placeholder.invalid").pathname;
  } catch {
    return "(unparseable)";
  }
}

/* ------------------------------------------------------------ cookies -- */

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(headers: Headers): void {
    const lines = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const line of lines) {
      const [pair, ...attributes] = line.split(";");
      const eq = pair!.indexOf("=");
      if (eq <= 0) continue;
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const expired = attributes.some((a) => {
        const [k, v] = a.split("=").map((s) => s.trim().toLowerCase());
        if (k === "max-age") return Number(v) <= 0;
        if (k === "expires") return Date.parse(v ?? "") < Date.now();
        return false;
      });
      if (expired || value.length === 0) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string | null {
    if (this.cookies.size === 0) return null;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  clear(): void {
    this.cookies.clear();
  }

  get size(): number {
    return this.cookies.size;
  }
}

/* ------------------------------------------------------------- client -- */

export interface WovenTeamClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  transport?: Partial<{ -readonly [K in keyof typeof WOVEN_TEAM_TRANSPORT]: number }>;
  deadlineAt?: number | null;
}

export interface PageResponse {
  status: number;
  /** Final path after same-origin redirects. */
  path: string;
  contentType: string;
  text: string;
}

type Body = { kind: "json"; value: unknown } | { kind: "form"; value: Record<string, string> } | { kind: "empty-json" };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isLoginPath(path: string): boolean {
  const lower = path.toLowerCase();
  return LOGIN_PATH_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}?`));
}

export function looksLikeLoginPage(html: string): boolean {
  return LOGIN_FORM_MARKER.test(html);
}

export class WovenTeamClient {
  readonly jar = new CookieJar();
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly transport: { -readonly [K in keyof typeof WOVEN_TEAM_TRANSPORT]: number };
  private readonly deadlineAt: number | null;
  private lastStartedAt: number | null = null;
  private requests = 0;
  /** The most recent `__RequestVerificationToken` an authenticated page carried. */
  pageToken: string | null = null;

  constructor(options: WovenTeamClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.origin = new URL(this.baseUrl).origin;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.transport = { ...WOVEN_TEAM_TRANSPORT, ...options.transport };
    this.deadlineAt = options.deadlineAt ?? null;
  }

  get requestsMade(): number {
    return this.requests;
  }

  /* ---------------------------------------------------- authenticated -- */

  /** An authenticated HTML page. A login page in its place is `session_expired`. */
  async getHtml(path: string): Promise<string> {
    const page = await this.request("GET", path, null);
    this.assertAuthenticated(page, path);
    if (!/html/i.test(page.contentType) && !page.text.trimStart().startsWith("<")) {
      throw new WovenTeamError("bad_response", `Woven answered ${safePath(path)} with something other than a page.`, {
        status: page.status,
        path: safePath(path),
      });
    }
    this.rememberToken(page.text);
    return page.text;
  }

  /** A JSON read posted as JSON (`Content-Type: application/json; charset=utf-8`). */
  async postJson(path: string, value: unknown | undefined): Promise<unknown> {
    const body: Body = value === undefined ? { kind: "empty-json" } : { kind: "json", value };
    return this.expectJson(await this.request("POST", path, body), path);
  }

  /** A JSON read posted as a form (jQuery's default encoding). */
  async postForm(path: string, fields: Record<string, string>): Promise<unknown> {
    return this.expectJson(await this.request("POST", path, { kind: "form", value: fields }), path);
  }

  /* ---------------------------------------------------------- signed -- */

  /**
   * Downloads a temporary signed storage URL. The Woven cookie is NOT sent,
   * the host must match `DOWNLOAD_HOST_PATTERN`, redirects are refused, and the
   * body is capped. The URL is used once and never stored or reported.
   */
  async downloadSigned(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
    const where = "signed download";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new WovenTeamError("download_failed", "Woven gave a download link Ask Sunny could not read.", { path: where });
    }
    if (parsed.protocol !== "https:" || !DOWNLOAD_HOST_PATTERN.test(parsed.hostname)) {
      throw new WovenTeamError(
        "download_host_not_allowed",
        "Woven's download link points somewhere Ask Sunny does not download from.",
        { path: where },
      );
    }

    const response = await this.sendWithRetries(parsed, { method: "GET", headers: { Accept: "*/*" }, redirect: "error" }, where, this.transport.downloadTimeoutMs);
    if (response.status === 403 || response.status === 401) {
      await discard(response);
      throw new WovenTeamError("download_link_expired", "Woven's temporary download link had expired.", { status: response.status, path: where });
    }
    if (!response.ok) {
      await discard(response);
      throw new WovenTeamError("download_failed", `The file download failed (HTTP ${response.status}).`, { status: response.status, path: where });
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      await discard(response);
      throw new WovenTeamError("too_large", "The file is larger than Ask Sunny's upload limit.", { path: where });
    }
    const bytes = await readCapped(response, maxBytes, where);
    return { bytes, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  }

  /* ------------------------------------------------------------- core -- */

  /**
   * One request with same-origin redirects followed by hand (so every
   * `Set-Cookie` along the way is kept) and transient failures retried.
   */
  async request(method: "GET" | "POST", path: string, body: Body | null): Promise<PageResponse> {
    let url = new URL(path, this.baseUrl);
    let currentMethod = method;
    let currentBody = body;

    for (let hop = 0; ; hop += 1) {
      if (url.origin !== this.origin) {
        throw new WovenTeamError("redirect_off_origin", "Woven redirected outside its own site.", { path: safePath(path) });
      }
      const headers: Record<string, string> = {
        Accept: currentBody && currentBody.kind !== "form" ? "application/json, text/javascript, */*; q=0.01" : "text/html,application/json;q=0.9,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
      };
      if (currentMethod === "GET" && !currentBody) delete headers["X-Requested-With"];
      const cookie = this.jar.header();
      if (cookie) headers.Cookie = cookie;
      let payload: string | undefined;
      if (currentBody?.kind === "json") {
        headers["Content-Type"] = "application/json; charset=utf-8";
        payload = JSON.stringify(currentBody.value);
      } else if (currentBody?.kind === "empty-json") {
        headers["Content-Type"] = "application/json; charset=utf-8";
      } else if (currentBody?.kind === "form") {
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        payload = new URLSearchParams(currentBody.value).toString();
      }
      if (currentMethod === "POST" && ANTIFORGERY_HEADER && this.pageToken) headers[ANTIFORGERY_HEADER] = this.pageToken;

      const response = await this.sendWithRetries(url, { method: currentMethod, headers, body: payload, redirect: "manual" }, safePath(url.pathname), this.transport.requestTimeoutMs);
      this.jar.absorb(response.headers);

      if (response.status >= 300 && response.status < 400) {
        await discard(response);
        const location = response.headers.get("location");
        if (!location || hop >= this.transport.maxRedirects) {
          throw new WovenTeamError("bad_response", `Woven's redirect from ${safePath(url.pathname)} could not be followed.`, {
            status: response.status,
            path: safePath(url.pathname),
          });
        }
        url = new URL(location, url);
        /* 303, and 301/302 after a POST, become a GET — what a browser does. */
        if (response.status !== 307 && response.status !== 308) {
          currentMethod = "GET";
          currentBody = null;
        }
        continue;
      }

      return {
        status: response.status,
        path: url.pathname + url.search,
        contentType: response.headers.get("content-type") ?? "",
        text: await response.text(),
      };
    }
  }

  private expectJson(page: PageResponse, path: string): unknown {
    this.assertAuthenticated(page, path);
    const where = safePath(path);
    if (page.status === 404) throw new WovenTeamError("not_found", `Woven has nothing at ${where}.`, { status: 404, path: where });
    if (page.status !== 200) {
      throw new WovenTeamError("bad_response", `Woven answered ${where} with HTTP ${page.status}.`, { status: page.status, path: where });
    }
    const text = page.text.trim();
    if (text.startsWith("<")) {
      throw new WovenTeamError("bad_response", `Woven answered ${where} with a page where data was expected.`, { status: 200, path: where });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new WovenTeamError("bad_response", `Woven answered ${where} with data Ask Sunny could not read.`, { status: 200, path: where });
    }
  }

  private assertAuthenticated(page: PageResponse, path: string): void {
    const where = safePath(path);
    if (isLoginPath(safePath(page.path)) || (page.contentType.includes("html") && looksLikeLoginPage(page.text))) {
      throw new WovenTeamError("session_expired", "The Woven session has ended.", { status: page.status, path: where, sessionLost: true });
    }
    if (page.status === 401) {
      throw new WovenTeamError("session_expired", "Woven no longer accepts this session.", { status: 401, path: where, sessionLost: true });
    }
    if (page.status === 400 && ANTIFORGERY_ERROR_MARKER.test(page.text)) {
      throw new WovenTeamError("antiforgery_rejected", `Woven refused ${where} for a missing anti-forgery token.`, { status: 400, path: where, sessionLost: true });
    }
    if (page.status === 403) {
      throw new WovenTeamError("forbidden", `Woven refused ${where} (HTTP 403). The integration account may lack access.`, { status: 403, path: where });
    }
  }

  private rememberToken(html: string): void {
    const token = hiddenInputValue(parseHtmlDocument(html), LOGIN_FIELDS.antiForgery);
    if (token) this.pageToken = token;
  }

  /* -------------------------------------------------------- transport -- */

  private assertBeforeDeadline(path: string, extraMs = 0): void {
    if (this.deadlineAt !== null && this.now() + extraMs >= this.deadlineAt) {
      throw new WovenTeamError("deadline_exceeded", `The sync's time budget ran out before ${path} could be read.`, { path });
    }
  }

  private async pause(ms: number, path: string): Promise<void> {
    if (ms <= 0) return;
    this.assertBeforeDeadline(path, ms);
    await this.sleep(ms);
  }

  private async sendWithRetries(url: URL, init: RequestInit, path: string, timeoutMs: number): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.send(url, init, path, timeoutMs);
      } catch (error) {
        const transient = error instanceof WovenTeamError && (error.code === "timeout" || error.code === "network");
        if (transient && attempt < this.transport.maxRetries) {
          await this.pause(this.transport.baseBackoffMs * 2 ** attempt, path);
          continue;
        }
        throw error;
      }
      if (response.status === 429 || response.status >= 500) {
        await discard(response);
        if (attempt < this.transport.maxRetries) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "");
          const waitMs =
            response.status === 429 && Number.isFinite(retryAfter) && retryAfter >= 0
              ? retryAfter * 1000
              : this.transport.baseBackoffMs * 2 ** attempt;
          if (waitMs > this.transport.maxRetryAfterMs) {
            throw new WovenTeamError("rate_limited", `Woven asked Ask Sunny to wait longer than a sync allows for ${path}.`, { status: 429, path });
          }
          await this.pause(waitMs, path);
          continue;
        }
        throw new WovenTeamError(
          response.status === 429 ? "rate_limited" : "server_error",
          `Woven kept failing ${path} (HTTP ${response.status}).`,
          { status: response.status, path },
        );
      }
      return response;
    }
  }

  private async send(url: URL, init: RequestInit, path: string, timeoutMs: number): Promise<Response> {
    if (this.lastStartedAt !== null) {
      await this.pause(this.lastStartedAt + this.transport.minIntervalMs - this.now(), path);
    }
    this.assertBeforeDeadline(path);
    let limit = timeoutMs;
    if (this.deadlineAt !== null) limit = Math.min(limit, Math.max(this.deadlineAt - this.now(), 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    this.lastStartedAt = this.now();
    this.requests += 1;
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch {
      /* The cause is dropped: a fetch error can quote the URL, and a signed URL's query is its credential. */
      if (controller.signal.aborted) throw new WovenTeamError("timeout", `Woven did not answer ${path} in time.`, { path });
      throw new WovenTeamError("network", `Woven could not be reached for ${path}.`, { path });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* thrown away either way */
  }
}

async function readCapped(response: Response, maxBytes: number, path: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new WovenTeamError("too_large", "The file is larger than Ask Sunny's upload limit.", { path });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
