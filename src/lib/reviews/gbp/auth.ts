import "server-only";

import { GBP_SCOPE, type GbpOAuthClient } from "./config";
import { defaultHttpDeps, GbpApiError, backoffMs, MAX_ATTEMPTS, type HttpDeps } from "./http";

/**
 * OAuth: exchange the stored refresh token for short-lived access tokens.
 *
 * The refresh token is the only long-lived secret and it never leaves this
 * module: not into a log line, not into an error, not into a response. Access
 * tokens are cached in memory for their lifetime minus a safety margin, so one
 * run makes one token request rather than one per page.
 *
 * `invalid_grant` is the revoked-or-expired case. It is permanent — retrying
 * cannot fix it — and is surfaced as `auth_revoked` so the status screen can
 * say a person must re-authorise rather than "Google is down".
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EXPIRY_MARGIN_MS = 60_000;

export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Drop the cached token, e.g. after a 401. */
  invalidate(): void;
}

/**
 * `getRefreshToken` supplies the refresh token on demand — in production by
 * opening the sealed value in the database — so it is never held in the
 * environment and is only in memory for the moment of an exchange.
 */
export function createTokenProvider(
  credentials: GbpOAuthClient,
  getRefreshToken: () => Promise<string>,
  deps: HttpDeps = defaultHttpDeps,
  now: () => number = Date.now,
): TokenProvider {
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function refresh(): Promise<string> {
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: await getRefreshToken(),
      grant_type: "refresh_token",
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await deps.fetch(TOKEN_URL, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
      } catch {
        if (attempt === MAX_ATTEMPTS) {
          throw new GbpApiError("upstream_unavailable", "Google's token endpoint could not be reached.", {
            retryable: true,
          });
        }
        await deps.sleep(backoffMs(attempt, null, deps.random));
        continue;
      }

      if (response.ok) {
        const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
        if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
          throw new GbpApiError("invalid_response", "Google's token response carried no access token.");
        }
        /* If Google returns scopes, the business scope must be among them. */
        if (typeof payload.scope === "string" && !payload.scope.split(" ").includes(GBP_SCOPE)) {
          throw new GbpApiError(
            "forbidden",
            "The authorised token does not carry the business.manage scope. Re-authorise with that scope.",
          );
        }
        const lifetime = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
        cached = { token: payload.access_token, expiresAt: now() + lifetime * 1000 };
        return payload.access_token;
      }

      let oauthError = "";
      try {
        const failure = (await response.json()) as { error?: unknown };
        oauthError = typeof failure.error === "string" ? failure.error : "";
      } catch {
        /* Not JSON; the status alone decides. */
      }

      if (oauthError === "invalid_grant") {
        throw new GbpApiError(
          "auth_revoked",
          "The Google refresh token was revoked or has expired. A person must re-authorise the integration.",
          { status: response.status, googleStatus: oauthError },
        );
      }
      if (oauthError === "invalid_client" || oauthError === "unauthorized_client") {
        throw new GbpApiError("auth_failed", "Google rejected the OAuth client credentials.", {
          status: response.status,
          googleStatus: oauthError,
        });
      }
      if (response.status < 500 && response.status !== 429) {
        throw new GbpApiError("auth_failed", "Google's token endpoint refused the request.", {
          status: response.status,
          googleStatus: oauthError || null,
        });
      }
      if (attempt === MAX_ATTEMPTS) {
        throw new GbpApiError("upstream_unavailable", "Google's token endpoint is unavailable.", {
          status: response.status,
          retryable: true,
        });
      }
      await deps.sleep(backoffMs(attempt, response.headers.get("retry-after"), deps.random));
    }

    throw new GbpApiError("upstream_unavailable", "Google's token endpoint is unavailable.", { retryable: true });
  }

  return {
    async getAccessToken() {
      if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > now()) return cached.token;
      /* Concurrent callers share one refresh. */
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}
