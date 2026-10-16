import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { GBP_SCOPE, readOAuthSettings, resolveRedirectUri } from "./config";
import { OAUTH_STATE_LABEL, REFRESH_TOKEN_LABEL, SealError, open, readEncryptionKey, safeEqual, seal } from "./crypto";
import {
  GOOGLE_AUTH_URL,
  OAuthError,
  createAuthorization,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeRefreshToken,
  verifyAttempt,
} from "./oauth";

const KEY = randomBytes(32);
const settings = { clientId: "client-id.apps.example", clientSecret: "SECRET-VALUE-0001", redirectUri: "https://ask-sunny.example/api/admin/reviews/gbp/callback" };
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe("sealing the refresh token", () => {
  it("round-trips with a fresh nonce each time and never leaks the plaintext", () => {
    const token = "1//0gSyntheticRefreshToken-abcdef";
    const a = seal(token, REFRESH_TOKEN_LABEL, KEY);
    const b = seal(token, REFRESH_TOKEN_LABEL, KEY);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toContain(token);
    expect(open(a, REFRESH_TOKEN_LABEL, KEY)).toBe(token);
  });

  it("refuses the wrong key, a swapped label, tampering and malformed input", () => {
    const sealed = seal("secret", REFRESH_TOKEN_LABEL, KEY);
    expect(() => open(sealed, REFRESH_TOKEN_LABEL, randomBytes(32))).toThrow(SealError);
    expect(() => open(sealed, OAUTH_STATE_LABEL, KEY)).toThrow(SealError);
    const parts = sealed.split(".");
    expect(() => open([parts[0], parts[1], parts[2], Buffer.from("x").toString("base64url")].join("."), REFRESH_TOKEN_LABEL, KEY)).toThrow(SealError);
    for (const bad of ["", "x", "v2.a.b.c", "v1.a.b", "v1.!!.b.c", "1//0gPlaintext"]) expect(() => open(bad, REFRESH_TOKEN_LABEL, KEY)).toThrow(SealError);
  });

  it("validates the key and never echoes it", () => {
    expect(() => readEncryptionKey({} as unknown as NodeJS.ProcessEnv)).toThrow(/GOOGLE_GBP_TOKEN_ENCRYPTION_KEY is not set/);
    for (const bad of ["short", Buffer.from("x".repeat(31)).toString("base64"), "not base64 at all !!!"]) {
      try {
        readEncryptionKey({ GOOGLE_GBP_TOKEN_ENCRYPTION_KEY: bad } as unknown as NodeJS.ProcessEnv);
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as Error).message).not.toContain(bad);
        expect((error as SealError).code).toBe("key_invalid");
      }
    }
    expect(readEncryptionKey({ GOOGLE_GBP_TOKEN_ENCRYPTION_KEY: KEY.toString("base64") } as unknown as NodeJS.ProcessEnv).equals(KEY)).toBe(true);
  });

  it("compares in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("OAuth authorization (PKCE)", () => {
  it("asks for the single business scope, offline access, S256 PKCE and a state — and keeps the attempt only in a sealed cookie", () => {
    const start = createAuthorization(settings, { key: KEY, now: 1_000 });
    const url = new URL(start.url);
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_URL);
    expect(url.searchParams.get("scope")).toBe(GBP_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(settings.redirectUri);
    expect(start.cookieValue).not.toContain(url.searchParams.get("state")!);
    expect(url.search).not.toContain("SECRET-VALUE");
  });

  it("binds the attempt to the administrator who started it", () => {
    const start = createAuthorization(settings, { key: KEY, now: 1_000, subject: "admin-1" });
    const state = new URL(start.url).searchParams.get("state")!;
    expect(verifyAttempt(start.cookieValue, state, { key: KEY, now: 2_000, subject: "admin-1" }).verifier).toBeTruthy();
    expect(() => verifyAttempt(start.cookieValue, state, { key: KEY, now: 2_000, subject: "admin-2" })).toThrowError(expect.objectContaining({ code: "attempt_invalid" }));
    expect(() => verifyAttempt(start.cookieValue, state, { key: KEY, now: 2_000 })).toThrowError(expect.objectContaining({ code: "attempt_invalid" }));
  });

  it("verifies the callback state in constant time and rejects forged, expired and missing attempts", () => {
    const start = createAuthorization(settings, { key: KEY, now: 1_000 });
    const state = new URL(start.url).searchParams.get("state")!;
    expect(verifyAttempt(start.cookieValue, state, { key: KEY, now: 2_000 }).verifier).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(() => verifyAttempt(start.cookieValue, "forged", { key: KEY, now: 2_000 })).toThrowError(expect.objectContaining({ code: "state_mismatch" }));
    expect(() => verifyAttempt(start.cookieValue, state, { key: KEY, now: 1_000 + 601_000 })).toThrowError(expect.objectContaining({ code: "attempt_expired" }));
    expect(() => verifyAttempt(undefined, state, { key: KEY })).toThrowError(expect.objectContaining({ code: "attempt_invalid" }));
    expect(() => verifyAttempt("garbage", state, { key: KEY })).toThrowError(expect.objectContaining({ code: "attempt_invalid" }));
  });
});

describe("token exchange", () => {
  it("accepts only a grant with a refresh token AND the business scope", async () => {
    const ok = await exchangeAuthorizationCode(settings, "code", "verifier", reply(200, { refresh_token: "R", scope: `openid ${GBP_SCOPE}` }));
    expect(ok).toEqual({ refreshToken: "R", scopes: ["openid", GBP_SCOPE] });
    await expect(exchangeAuthorizationCode(settings, "c", "v", reply(200, { scope: GBP_SCOPE }))).rejects.toMatchObject({ code: "no_refresh_token" });
    await expect(exchangeAuthorizationCode(settings, "c", "v", reply(200, { refresh_token: "R", scope: "openid" }))).rejects.toMatchObject({ code: "missing_scope" });
  });

  it("maps Google errors to a closed list and never reflects Google's text", async () => {
    await expect(exchangeAuthorizationCode(settings, "c", "v", reply(400, { error: "invalid_grant", error_description: "ya29.LEAK" }))).rejects.toMatchObject({ code: "invalid_grant" });
    const error = await exchangeAuthorizationCode(settings, "c", "v", reply(400, { error: "weird thing!" })).catch((e) => e);
    expect(error).toBeInstanceOf(OAuthError);
    expect(error.code).toBe("bad_response");
    expect(String(error.message)).not.toContain("weird");
  });

  it("turns a network failure into network_error without the URL or secret", async () => {
    const error = await exchangeAuthorizationCode(settings, "c", "v", vi.fn(async () => { throw new Error("connect ECONNRESET https://oauth2.googleapis.com/token SECRET-VALUE-0001"); })).catch((e) => e);
    expect(error.code).toBe("network_error");
    expect(error.message).not.toMatch(/SECRET|googleapis/);
  });

  it("refreshes an access token (with a safety margin) and reports a revoked grant", async () => {
    const token = await refreshAccessToken(settings, "R", reply(200, { access_token: "A", expires_in: 3600 }), () => 0);
    expect(token).toEqual({ value: "A", expiresAt: 3_540_000 });
    await expect(refreshAccessToken(settings, "R", reply(400, { error: "invalid_grant" }))).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("revokes best-effort", async () => {
    expect(await revokeRefreshToken("R", reply(200, {}))).toBe(true);
    expect(await revokeRefreshToken("R", vi.fn(async () => { throw new Error("x"); }))).toBe(false);
  });
});

describe("settings", () => {
  it("derives the redirect URI from the site origin, or uses an explicit one, and needs the client id and secret", () => {
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
    expect(resolveRedirectUri(env({ NEXT_PUBLIC_SITE_URL: "https://ask-sunny.example/" }))).toBe("https://ask-sunny.example/api/admin/reviews/gbp/callback");
    expect(resolveRedirectUri(env({ GOOGLE_GBP_REDIRECT_URI: "https://x.example/cb" }))).toBe("https://x.example/cb");
    expect(readOAuthSettings(env({ NEXT_PUBLIC_SITE_URL: "https://s.example" }))).toBeNull();
    expect(readOAuthSettings(env({ GOOGLE_GBP_CLIENT_ID: "i", GOOGLE_GBP_CLIENT_SECRET: "s", NEXT_PUBLIC_SITE_URL: "https://s.example" }))).toMatchObject({ clientId: "i", redirectUri: "https://s.example/api/admin/reviews/gbp/callback" });
  });
});
