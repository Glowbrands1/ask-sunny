import { describe, expect, it, vi } from "vitest";

import type { TokenProvider } from "./auth";
import { createGbpClient } from "./client";
import type { HttpDeps } from "./http";

function router(handler: (url: URL, init: RequestInit) => Response): HttpDeps & { urls: string[]; headers: (string | null)[] } {
  const urls: string[] = [];
  const headers: (string | null)[] = [];
  return {
    urls,
    headers,
    fetch: (async (input: string, init: RequestInit) => {
      urls.push(String(input));
      headers.push((init.headers as Record<string, string>)?.authorization ?? null);
      return handler(new URL(String(input)), init);
    }) as unknown as typeof fetch,
    sleep: async () => {},
    random: () => 0,
  };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tokens = () => {
  const invalidate = vi.fn();
  const provider: TokenProvider = { getAccessToken: async () => "access-token", invalidate };
  return Object.assign(provider, { invalidate });
};

describe("GBP client", () => {
  it("lists accounts across pages", async () => {
    const d = router((url) =>
      url.searchParams.get("pageToken") ? json({ accounts: [{ name: "accounts/2" }] }) : json({ accounts: [{ name: "accounts/1" }], nextPageToken: "p2" }),
    );
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 50 });
    expect((await client.listAccounts()).map((a) => a.name)).toEqual(["accounts/1", "accounts/2"]);
    expect(d.headers.every((h) => h === "Bearer access-token")).toBe(true);
  });

  it("lists locations with the read mask and flattens metadata", async () => {
    const d = router(() =>
      json({ locations: [{ name: "locations/9", title: "Sun Tan City - KS Manhattan", storeCode: "306", metadata: { placeId: "ChIJabc", mapsUri: "https://m" } }] }),
    );
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 50 });
    const [loc] = await client.listLocations("accounts/1");
    expect(loc).toMatchObject({ name: "locations/9", storeCode: "306", placeId: "ChIJabc" });
    expect(d.urls[0]).toContain("mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations");
    expect(d.urls[0]).toContain("readMask=");
  });

  it("paginates reviews up to the page cap and reports truncation", async () => {
    let page = 0;
    const d = router(() => {
      page += 1;
      return json({ reviews: [{ name: `accounts/1/locations/2/reviews/r${page}`, reviewId: `r${page}000000`, starRating: "FIVE" }], nextPageToken: `more-${page}`, totalReviewCount: 99, averageRating: 4.5 });
    });
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 50 });
    const result = await client.listReviews("accounts/1", "locations/2", 3);
    expect(result.reviews).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.totalReviewCount).toBe(99);
    expect(d.urls[0]).toContain("mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews");
    expect(d.urls[0]).toContain("pageSize=50");
    expect(d.urls[0]).not.toContain("orderBy");
  });

  it("stops cleanly when pagination ends", async () => {
    const d = router(() => json({ reviews: [{ name: "n", reviewId: "abcdefgh" }] }));
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 50 });
    expect((await client.listReviews("accounts/1", "locations/2", 5)).truncated).toBe(false);
  });

  it("refreshes the token once on a 401 and then succeeds", async () => {
    let n = 0;
    const t = tokens();
    const d = router(() => (n++ === 0 ? json({ error: { message: "x" } }, 401) : json({ accounts: [] })));
    const client = createGbpClient({ tokens: t, deps: d, maxRequests: 50 });
    await client.listAccounts();
    expect(t.invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not loop on repeated 401s", async () => {
    const t = tokens();
    const d = router(() => json({}, 401));
    const client = createGbpClient({ tokens: t, deps: d, maxRequests: 50 });
    await expect(client.listAccounts()).rejects.toMatchObject({ code: "auth_failed" });
    expect(t.invalidate).toHaveBeenCalledTimes(1);
  });

  it("enforces the per-run request budget across retries", async () => {
    const d = router(() => json({}, 503));
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 3 });
    await expect(client.listAccounts()).rejects.toMatchObject({ code: "request_budget_exceeded" });
    expect(d.urls.length).toBe(3);
  });

  it("refuses malformed resource names before any request is made", async () => {
    const d = router(() => json({}));
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 10 });
    await expect(client.listReviewsPage("accounts/1/../../x", "locations/2")).rejects.toMatchObject({ code: "bad_request" });
    await expect(client.listLocations("accounts/abc")).rejects.toMatchObject({ code: "bad_request" });
    expect(d.urls).toHaveLength(0);
  });

  it("sets the notification setting for NEW_REVIEW and UPDATED_REVIEW only", async () => {
    let sent: { method?: string; body?: unknown } = {};
    const d = router((_url, init) => {
      sent = { method: init.method, body: JSON.parse(String(init.body)) };
      return json({});
    });
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 10 });
    await client.setNotificationSetting("accounts/1", "projects/my-proj-123/topics/gbp-reviews");
    expect(sent.method).toBe("PATCH");
    expect(sent.body).toMatchObject({ notificationTypes: ["NEW_REVIEW", "UPDATED_REVIEW"] });
    await expect(client.setNotificationSetting("accounts/1", "not-a-topic")).rejects.toMatchObject({ code: "bad_request" });
  });

  it("treats a repeated page token as a loop and reports the read INCOMPLETE rather than spinning", async () => {
    const d = router(() => json({ reviews: [{ name: "n", reviewId: "abcdefgh" }], nextPageToken: "same" }));
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 50 });
    const result = await client.listReviews("accounts/1", "locations/2", 10);
    expect(result.truncated).toBe(true);
    expect(d.urls.length).toBeLessThanOrEqual(3);
  });

  it("fails a looping account/location listing instead of spinning", async () => {
    const d = router(() => json({ accounts: [{ name: "accounts/1" }], nextPageToken: "same" }));
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 50 });
    await expect(client.listAccounts()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("paces requests at least minRequestIntervalMs apart", async () => {
    const sleeps: number[] = [];
    let clock = 1000;
    const d = { ...router(() => json({ accounts: [] })), sleep: async (ms: number) => void sleeps.push(ms) };
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 50, minRequestIntervalMs: 150, now: () => clock });
    await client.listAccounts();
    clock += 50;
    await client.listAccounts();
    expect(sleeps).toEqual([100]);
  });

  it("reads the account's notification setting, and returns null when none exists", async () => {
    const d = router(() => json({ pubsubTopic: "projects/p-123456/topics/t", notificationTypes: ["NEW_REVIEW"] }));
    const client = createGbpClient({ tokens: tokens(), deps: d, maxRequests: 10 });
    expect(await client.getNotificationSetting("accounts/1")).toEqual({ pubsubTopic: "projects/p-123456/topics/t", notificationTypes: ["NEW_REVIEW"] });
    const none = createGbpClient({ tokens: tokens(), deps: router(() => json({}, 404)), maxRequests: 10 });
    expect(await none.getNotificationSetting("accounts/1")).toBeNull();
  });
});
