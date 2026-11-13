import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callHub, hubPartnerConfig, PARTNER_ID } from "./client.server";
import { MAX_SKEW_MS, PARTNER_HEADERS, signPartnerRequest, verifyPartnerRequest } from "./signature";

/**
 * ONE SIGNATURE, CHECKED IN BOTH REPOSITORIES. The Leadership Hub's src/lib/partner/partner.test.ts asserts the same
 * vector, so a change to either copy of signature.ts that would make the apps disagree fails one of the two CIs.
 */
export const SHARED_VECTOR = {
  secret: "test-secret-0123456789abcdef0123456789",
  partnerId: "ask-sunny",
  timestamp: "1794600000000",
  body: '{"op":"whoami","email":"pat@example.test","nonce":"abcdefghijklmnop1234"}',
  signature: "dcd6ddcce59e3495ad4a7ac8698827d4fec6d7fcde42ea928a9b67e929f00b22",
};

describe("partner signature", () => {
  it("matches the vector both apps check", () => {
    const v = SHARED_VECTOR;
    expect(signPartnerRequest(v.secret, v.partnerId, v.timestamp, v.body)).toBe(v.signature);
    expect(verifyPartnerRequest({ ...v, now: Number(v.timestamp) })).toBe(true);
  });

  it("refuses a changed email, an old timestamp or another secret", () => {
    const v = SHARED_VECTOR;
    expect(verifyPartnerRequest({ ...v, body: v.body.replace("pat@", "lee@"), now: Number(v.timestamp) })).toBe(false);
    expect(verifyPartnerRequest({ ...v, now: Number(v.timestamp) + MAX_SKEW_MS + 1 })).toBe(false);
    expect(verifyPartnerRequest({ ...v, secret: "x".repeat(40), now: Number(v.timestamp) })).toBe(false);
  });
});

describe("calling the Hub", () => {
  beforeEach(() => {
    vi.stubEnv("HUB_PARTNER_SECRET", "k".repeat(40));
    vi.stubEnv("NEXT_PUBLIC_LEADERSHIP_HUB_URL", "https://hub.example.test/");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is off without a secret of at least 32 characters (fails closed, no request)", async () => {
    vi.stubEnv("HUB_PARTNER_SECRET", "");
    const fetcher = vi.fn();
    expect(hubPartnerConfig()).toBeNull();
    expect(await callHub("whoami", "a@example.test", {}, fetcher)).toEqual({ status: 0, body: { error: "not_configured" } });
    vi.stubEnv("HUB_PARTNER_SECRET", "too-short");
    expect(await callHub("whoami", "a@example.test", {}, fetcher)).toEqual({ status: 0, body: { error: "not_configured" } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("signs the exact body (op, email, arguments, a fresh nonce) for the Hub's partner endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await callHub("load", "Avery.Quill@example.test", { key: "stc-dm" }, fetcher as unknown as typeof fetch);
    expect(res).toEqual({ status: 200, body: { ok: true } });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://hub.example.test/api/partner/l10");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ op: "load", email: "Avery.Quill@example.test", key: "stc-dm" });
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(init.headers[PARTNER_HEADERS.partner]).toBe(PARTNER_ID);
    expect(
      verifyPartnerRequest({ secret: "k".repeat(40), partnerId: PARTNER_ID, timestamp: init.headers[PARTNER_HEADERS.timestamp], signature: init.headers[PARTNER_HEADERS.signature], body: init.body as string, now: Date.now() }),
    ).toBe(true);
    // Two calls never share a nonce.
    await callHub("load", "a@example.test", { key: "stc-dm" }, fetcher as unknown as typeof fetch);
    expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).nonce).not.toBe(body.nonce);
  });

  it("a network failure is an answer (status 0), never a throw", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await callHub("whoami", "a@example.test", {}, fetcher as unknown as typeof fetch)).toEqual({ status: 0, body: { error: "unavailable" } });
  });
});
