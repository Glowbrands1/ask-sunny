import { describe, expect, it, vi } from "vitest";

import { createTokenProvider } from "./auth";
import { GBP_SCOPE } from "./config";
import type { HttpDeps } from "./http";

const credentials = { clientId: "cid", clientSecret: "SECRET-VALUE", refreshToken: "REFRESH-VALUE" };

function deps(responses: Response[]): HttpDeps & { fetchMock: ReturnType<typeof vi.fn> } {
  let i = 0;
  const fetchMock = vi.fn(async () => responses[Math.min(i++, responses.length - 1)].clone());
  return { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, random: () => 0, fetchMock };
}
const ok = (extra: object = {}) =>
  new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600, scope: GBP_SCOPE, ...extra }), { status: 200 });

describe("token provider", () => {
  it("exchanges the refresh token and caches the access token", async () => {
    const d = deps([ok()]);
    const provider = createTokenProvider(credentials, d, () => 0);
    expect(await provider.getAccessToken()).toBe("tok-1");
    expect(await provider.getAccessToken()).toBe("tok-1");
    expect(d.fetchMock).toHaveBeenCalledTimes(1);
    const body = String((d.fetchMock.mock.calls[0] as unknown[])[1] && ((d.fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toContain("grant_type=refresh_token");
  });

  it("refreshes again once the token is within the expiry margin", async () => {
    let now = 0;
    const d = deps([ok(), ok({ access_token: "tok-2" })]);
    const provider = createTokenProvider(credentials, d, () => now);
    await provider.getAccessToken();
    now = 3_600_000 - 30_000;
    expect(await provider.getAccessToken()).toBe("tok-2");
  });

  it("shares one refresh between concurrent callers", async () => {
    const d = deps([ok()]);
    const provider = createTokenProvider(credentials, d, () => 0);
    await Promise.all([provider.getAccessToken(), provider.getAccessToken(), provider.getAccessToken()]);
    expect(d.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a revoked grant as permanent auth_revoked, with no retry and no secret in the message", async () => {
    const d = deps([new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })]);
    const provider = createTokenProvider(credentials, d);
    const error = await provider.getAccessToken().catch((e) => e);
    expect(error.code).toBe("auth_revoked");
    expect(error.retryable).toBe(false);
    expect(d.fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.message)).not.toMatch(/SECRET-VALUE|REFRESH-VALUE/);
  });

  it("rejects a token that lacks the business.manage scope", async () => {
    const provider = createTokenProvider(credentials, deps([ok({ scope: "openid email" })]));
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("retries a 503 from the token endpoint", async () => {
    const d = deps([new Response("{}", { status: 503 }), ok()]);
    const provider = createTokenProvider(credentials, d);
    expect(await provider.getAccessToken()).toBe("tok-1");
    expect(d.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a fresh exchange", async () => {
    const d = deps([ok(), ok({ access_token: "tok-2" })]);
    const provider = createTokenProvider(credentials, d, () => 0);
    await provider.getAccessToken();
    provider.invalidate();
    expect(await provider.getAccessToken()).toBe("tok-2");
  });
});
