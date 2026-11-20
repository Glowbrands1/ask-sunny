import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HUB_REVIEWS_HEADERS,
  SHARED_VECTOR,
  signHubReviewsRequest,
  verifyHubReviewsRequest,
} from "@/lib/partner/hub-reviews-signature";

/**
 * The owner, 19 Nov 2026: "Leadership Hub's own assistant ❌ Has no Google reviews tool … can we add?", and every Hub
 * user sees both brands' reviews. The Hub's server reads this app's Google review block through a signed, read-only
 * route; nobody else can.
 */
const calls = vi.hoisted(() => ({ reads: [] as unknown[] }));
vi.mock("@/lib/ai/google-reviews-chat-read", () => ({
  loadGoogleReviewsChatBlock: async (input: unknown) => {
    calls.reads.push(input);
    return { text: "GOOGLE REVIEWS — L3, L6, YTD AND MONTH BY MONTH\n- KS Manhattan (store 306): L3 6, L6 7, YTD 11.", figures: true };
  },
}));

import { POST } from "./route";

const SECRET = "hub-reviews-secret-0123456789abcdef0123";

function request(body: string, headers: Partial<Record<keyof typeof HUB_REVIEWS_HEADERS, string>> = {}, at = Date.now()): Request {
  const timestamp = headers.timestamp ?? String(at);
  return new Request("https://ask-sunny.test/api/partner/hub-reviews", {
    method: "POST",
    body,
    headers: {
      [HUB_REVIEWS_HEADERS.caller]: headers.caller ?? "leadership-hub",
      [HUB_REVIEWS_HEADERS.timestamp]: timestamp,
      [HUB_REVIEWS_HEADERS.signature]: headers.signature ?? signHubReviewsRequest(SECRET, headers.caller ?? "leadership-hub", timestamp, body),
    },
  });
}

beforeEach(() => {
  process.env.HUB_REVIEWS_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.HUB_REVIEWS_SECRET;
  calls.reads.length = 0;
});

describe("the Leadership Hub reads this app's Google reviews", () => {
  it("signs the vector all three repositories check", () => {
    expect(signHubReviewsRequest(SHARED_VECTOR.secret, SHARED_VECTOR.caller, SHARED_VECTOR.timestamp, SHARED_VECTOR.body)).toBe(
      "fd1761aeb01f3b8d33892461611f7d634462b67e76c1c21c012676a71ce722df",
    );
  });

  it("a signed request gets the chat's Google review block, every salon, with L3 / L6 / YTD when asked", async () => {
    const res = await POST(request(JSON.stringify({ question: "L3, L6 and YTD", nonce: "a" })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { app: string; text: string; figures: boolean };
    expect(json).toMatchObject({ app: "Ask Sunny", figures: true });
    expect(json.text).toContain("L3 6, L6 7, YTD 11");
    expect(calls.reads[0]).toEqual({ question: "Google reviews L3, L6 and YTD", role: "owner", scope: null });
  });

  it("does not exist without the secret", async () => {
    delete process.env.HUB_REVIEWS_SECRET;
    expect((await POST(request("{}"))).status).toBe(404);
    expect(calls.reads).toHaveLength(0);
  });

  it("refuses a wrong signature, another caller, a changed body or an old request, and reads nothing", async () => {
    const body = JSON.stringify({ question: "YTD", nonce: "b" });
    expect((await POST(request(body, { signature: "0".repeat(64) }))).status).toBe(401);
    expect((await POST(request(body, { caller: "ask-bubbles" }))).status).toBe(401);
    const signedFor = request(body);
    const tampered = new Request(signedFor.url, { method: "POST", headers: signedFor.headers, body: body.replace("YTD", "L3") });
    expect((await POST(tampered)).status).toBe(401);
    expect((await POST(request(body, {}, Date.now() - 6 * 60_000))).status).toBe(401);
    expect(calls.reads).toHaveLength(0);
  });

  it("a request signed for the L10 partner API's version is not accepted here", () => {
    expect(verifyHubReviewsRequest({ secret: SECRET, caller: "leadership-hub", timestamp: "1795600000000", signature: "a".repeat(64), body: "{}", now: 1795600000000 })).toBe(false);
  });
});
