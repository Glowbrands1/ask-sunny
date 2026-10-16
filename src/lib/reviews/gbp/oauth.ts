import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { GBP_SCOPE, type GbpOAuthClient, type GbpOAuthSettings } from "./config";
import { OAUTH_STATE_LABEL, open, safeEqual, seal } from "./crypto";

/**
 * GOOGLE OAUTH 2.0 FOR THE BUSINESS PROFILE API — authorization code + PKCE,
 * offline access, ONE scope. Pattern taken from Ask Bubbles' working flow.
 *
 *   SCOPE   https://www.googleapis.com/auth/business.manage (Google offers no
 *           read-only scope; this code only ever reads).
 *   PKCE    a fresh S256 verifier per attempt, kept ONLY in a sealed, HttpOnly
 *           cookie scoped to the callback path, together with the `state`.
 *   STATE   compared in constant time; an attempt expires after 10 minutes.
 *   TOKENS  only the REFRESH token is kept (sealed, by the caller). Access
 *           tokens live in memory for one run.
 *
 * Errors carry a code from a closed list. Google's bodies are never echoed.
 */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const OAUTH_COOKIE = "gbp_oauth";
export const OAUTH_ATTEMPT_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 15_000;

export type OAuthErrorCode =
  | "denied"
  | "state_mismatch"
  | "attempt_expired"
  | "attempt_invalid"
  | "invalid_grant"
  | "invalid_client"
  | "no_refresh_token"
  | "missing_scope"
  | "bad_response"
  | "network_error";

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  constructor(code: OAuthErrorCode) {
    super(`Google OAuth: ${code}`);
    this.name = "OAuthError";
    this.code = code;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const b64url = (buffer: Buffer) => buffer.toString("base64url");

export interface AuthorizationStart {
  url: string;
  cookieValue: string;
  maxAgeSeconds: number;
}

export function createAuthorization(
  settings: GbpOAuthSettings,
  options: { now?: number; key?: Buffer; random?: (n: number) => Buffer; subject?: string } = {},
): AuthorizationStart {
  const random = options.random ?? randomBytes;
  const verifier = b64url(random(32));
  const state = b64url(random(24));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const now = options.now ?? Date.now();

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", settings.clientId);
  url.searchParams.set("redirect_uri", settings.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GBP_SCOPE);
  url.searchParams.set("access_type", "offline");
  /* `consent` makes Google issue a refresh token even if this account authorised the client before. */
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const cookieValue = seal(
    JSON.stringify({ state, verifier, exp: now + OAUTH_ATTEMPT_SECONDS * 1000, sub: options.subject ?? null }),
    OAUTH_STATE_LABEL,
    options.key,
  );
  return { url: url.toString(), cookieValue, maxAgeSeconds: OAUTH_ATTEMPT_SECONDS };
}

export function verifyAttempt(
  cookieValue: string | undefined,
  returnedState: string | null,
  options: { now?: number; key?: Buffer; subject?: string } = {},
): { verifier: string } {
  if (!cookieValue || !returnedState) throw new OAuthError("attempt_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(cookieValue, OAUTH_STATE_LABEL, options.key));
  } catch {
    throw new OAuthError("attempt_invalid");
  }
  const attempt = parsed as { state?: unknown; verifier?: unknown; exp?: unknown; sub?: unknown };
  if (typeof attempt.state !== "string" || typeof attempt.verifier !== "string" || typeof attempt.exp !== "number") {
    throw new OAuthError("attempt_invalid");
  }
  if ((options.now ?? Date.now()) > attempt.exp) throw new OAuthError("attempt_expired");
  /* The administrator who STARTED the connection must be the one who COMPLETES it. */
  if ((typeof attempt.sub === "string" ? attempt.sub : null) !== (options.subject ?? null)) throw new OAuthError("attempt_invalid");
  if (!safeEqual(attempt.state, returnedState)) throw new OAuthError("state_mismatch");
  return { verifier: attempt.verifier };
}

async function post(fetchImpl: FetchLike, url: string, body: URLSearchParams): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch {
    throw new OAuthError("network_error");
  } finally {
    clearTimeout(timer);
  }
}

/** Google's `error` field only when it matches a closed pattern; never free text. */
function googleError(json: unknown): string | null {
  const e = json && typeof json === "object" ? (json as { error?: unknown }).error : null;
  return typeof e === "string" && /^[a-z_]{1,40}$/.test(e) ? e : null;
}

export interface ExchangedGrant {
  refreshToken: string;
  scopes: string[];
}

export async function exchangeAuthorizationCode(
  settings: GbpOAuthSettings,
  code: string,
  verifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<ExchangedGrant> {
  const { status, json } = await post(
    fetchImpl,
    GOOGLE_TOKEN_URL,
    new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      redirect_uri: settings.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
    }),
  );
  if (status !== 200) {
    const e = googleError(json);
    throw new OAuthError(e === "invalid_client" ? "invalid_client" : e === "invalid_grant" ? "invalid_grant" : "bad_response");
  }
  const body = json as { refresh_token?: unknown; scope?: unknown } | null;
  const refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : "";
  if (!refreshToken) throw new OAuthError("no_refresh_token");
  const scopes = typeof body?.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [];
  /* The consent screen lets a person untick scopes; a grant without the business scope is useless. */
  if (!scopes.includes(GBP_SCOPE)) throw new OAuthError("missing_scope");
  return { refreshToken, scopes };
}

export interface AccessToken {
  value: string;
  /** Epoch ms, already reduced by a safety margin. */
  expiresAt: number;
}

export async function refreshAccessToken(
  client: GbpOAuthClient,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<AccessToken> {
  const { status, json } = await post(
    fetchImpl,
    GOOGLE_TOKEN_URL,
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
  if (status !== 200) {
    const e = googleError(json);
    /* invalid_grant: revoked, password changed, or 7-day expiry while the consent screen is in Testing. */
    throw new OAuthError(e === "invalid_grant" ? "invalid_grant" : e === "invalid_client" ? "invalid_client" : "bad_response");
  }
  const body = json as { access_token?: unknown; expires_in?: unknown } | null;
  const value = typeof body?.access_token === "string" ? body.access_token : "";
  const seconds = typeof body?.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 0;
  if (!value || !seconds) throw new OAuthError("bad_response");
  return { value, expiresAt: now() + Math.max(0, seconds - 60) * 1000 };
}

/** Best-effort: asks Google to invalidate the grant. A failure never blocks disconnecting locally. */
export async function revokeRefreshToken(refreshToken: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const { status } = await post(fetchImpl, GOOGLE_REVOKE_URL, new URLSearchParams({ token: refreshToken }));
    return status === 200;
  } catch {
    return false;
  }
}
