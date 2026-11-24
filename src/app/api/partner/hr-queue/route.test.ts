import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIBLING_HR_APP } from "@/lib/config/app-switcher";
import { SIBLING_HR_HEADERS, signSiblingHrRequest } from "@/lib/partner/sibling-hr-signature";

/**
 * Owner, 23 Nov 2026: "just make a 1 tab for sunny 1 tab for bubbles". The sibling app's server reads this app's HR
 * queue for its approver through this signed, read-only route; nobody else can.
 */
const calls = vi.hoisted(() => ({ emails: [] as unknown[] }));
vi.mock("@/lib/partner/sibling-hr-queue", () => ({
  hrQueueForPartner: async (email: unknown) => {
    calls.emails.push(email);
    return { app: "This App", approver: true, forms: [] };
  },
}));

import { POST } from "./route";

const SECRET = "sibling-secret-0123456789abcdef0123456789";
const ORIGINAL = { ...process.env };

function request(body: string, options: { caller?: string; signature?: string; at?: number } = {}): Request {
  const caller = options.caller ?? SIBLING_HR_APP.siblingAppId;
  const timestamp = String(options.at ?? Date.now());
  return new Request("https://app.test/api/partner/hr-queue", {
    method: "POST",
    body,
    headers: {
      [SIBLING_HR_HEADERS.caller]: caller,
      [SIBLING_HR_HEADERS.timestamp]: timestamp,
      [SIBLING_HR_HEADERS.signature]: options.signature ?? signSiblingHrRequest(SECRET, caller, timestamp, body),
    },
  });
}

beforeEach(() => {
  calls.emails = [];
  process.env.SIBLING_HR_SECRET = SECRET;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

const BODY = JSON.stringify({ approverEmail: "hr.wren@example.com", nonce: "n" });

describe("POST /api/partner/hr-queue", () => {
  it("does not exist without SIBLING_HR_SECRET", async () => {
    delete process.env.SIBLING_HR_SECRET;
    expect((await POST(request(BODY))).status).toBe(404);
    expect(calls.emails).toEqual([]);
  });

  it("refuses a bad signature, another caller (this app itself included) and an old request, reading nothing", async () => {
    expect((await POST(request(BODY, { signature: "0".repeat(64) }))).status).toBe(401);
    expect((await POST(request(BODY, { caller: SIBLING_HR_APP.thisAppId }))).status).toBe(401);
    expect((await POST(request(BODY, { caller: "leadership-hub" }))).status).toBe(401);
    expect((await POST(request(BODY, { at: Date.now() - 10 * 60_000 }))).status).toBe(401);
    expect(calls.emails).toEqual([]);
  });

  it("answers the sibling's signed request for that email, uncached", async () => {
    const response = await POST(request(BODY));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ app: "This App", approver: true, forms: [] });
    expect(calls.emails).toEqual(["hr.wren@example.com"]);
  });

  it("a signed body that is not JSON is a bad request", async () => {
    expect((await POST(request("not json"))).status).toBe(400);
  });
});
