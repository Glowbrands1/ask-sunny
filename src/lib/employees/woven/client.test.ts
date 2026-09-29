import { describe, expect, it } from "vitest";

import { WovenApiError, WovenClient, extractPage } from "./client";
import { createFakeWoven, FAKE_COMPANY_ID, FAKE_CREDENTIALS, wovenEmployee, type FakeWovenOptions } from "./test-support";

/**
 * ============================================================================
 * THE WOVEN CLIENT — headers, the token, pagination, and every failure mode
 * ============================================================================
 *
 * Against a fake Operations API (`test-support.ts`) built from the official
 * OpenAPI export. The clock and the sleep are injected, so pacing, backoff and token
 * expiry are asserted exactly and the suite does not wait for real time.
 */

const BASE = "https://gateway-api.woven.team/api";

async function failure(promise: Promise<unknown>): Promise<WovenApiError> {
  try {
    await promise;
  } catch (error) {
    return error as WovenApiError;
  }
  throw new Error("expected the call to fail");
}

/** One clock for the client AND the fake server, because TokenExpirationDate is an absolute instant. */
const time = { now: 1_000_000 };

function fakeWoven(options: FakeWovenOptions) {
  time.now = 1_000_000;
  return createFakeWoven({ ...options, clock: () => time.now });
}

function harness(fake: ReturnType<typeof createFakeWoven>, extra: Partial<ConstructorParameters<typeof WovenClient>[0]> = {}) {
  const sleeps: number[] = [];
  const client = new WovenClient({
    baseUrl: BASE,
    credentials: FAKE_CREDENTIALS,
    fetch: fake.fetch,
    now: () => time.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      time.now += ms;
    },
    ...extra,
  });
  return {
    client,
    sleeps,
    advance: (ms: number) => {
      time.now += ms;
    },
  };
}

function employees(count: number) {
  return Array.from({ length: count }, (_, i) => wovenEmployee(String(1000 + i)));
}

describe("headers and the token exchange", () => {
  it("sends Subscription-Key and ApiVersion 1.0 on every call, and AccessToken on reads", async () => {
    const fake = fakeWoven({ employees: employees(2) });
    const { client } = harness(fake);

    await client.listEmployees({}, 100);

    const [token, ...reads] = fake.calls;
    expect(token.method).toBe("POST");
    expect(token.path).toBe("/tokens/v2");
    expect(token.headers["subscription-key"]).toBe(FAKE_CREDENTIALS.subscriptionKey);
    expect(token.headers["apiversion"]).toBe("1.0");
    expect(token.headers["accesstoken"]).toBeUndefined();

    for (const read of reads) {
      expect(read.method).toBe("GET");
      expect(read.headers["subscription-key"]).toBe(FAKE_CREDENTIALS.subscriptionKey);
      expect(read.headers["apiversion"]).toBe("1.0");
      expect(read.headers["accesstoken"]).toBe("token-1");
    }
  });

  it("never puts a credential in a URL", async () => {
    const fake = fakeWoven({ employees: employees(3) });
    const { client } = harness(fake);
    await client.listEmployees({}, 100);

    for (const call of fake.calls) {
      const url = `${call.path}?${new URLSearchParams(call.query)}`;
      expect(url).not.toContain(FAKE_CREDENTIALS.subscriptionKey);
      expect(url).not.toContain(FAKE_CREDENTIALS.password);
      expect(url).not.toContain("token-");
    }
  });

  it("caches the token across calls", async () => {
    const fake = fakeWoven({ employees: employees(1), tokenLifetimeSeconds: 3600 });
    const { client } = harness(fake);

    await client.get("/employees");
    await client.get("/employees");
    await client.get("/employees");

    expect(client.tokenRequestsMade).toBe(1);
  });

  it("refreshes the token once it has expired, before using it", async () => {
    const fake = fakeWoven({ employees: employees(1), tokenLifetimeSeconds: 600 });
    const { client, advance } = harness(fake);

    await client.get("/employees");
    advance(10 * 60 * 1000);
    await client.get("/employees");

    expect(client.tokenRequestsMade).toBe(2);
    expect(fake.calls.at(-1)?.headers["accesstoken"]).toBe("token-2");
  });

  it("assumes a short lifetime when the token response states none", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    const { client, advance } = harness(fake);

    await client.get("/employees");
    advance(14 * 60 * 1000);
    await client.get("/employees");

    expect(client.tokenRequestsMade).toBe(2);
  });

  it("logs in again ONCE when a token is revoked early, then succeeds", async () => {
    const fake = fakeWoven({ employees: employees(1), tokenLifetimeSeconds: 3600 });
    const { client } = harness(fake);

    await client.get("/employees");
    fake.expireTokens();
    await expect(client.get("/employees")).resolves.toBeDefined();

    expect(client.tokenRequestsMade).toBe(2);
  });

  it("stops after one re-login when every token is refused (401)", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override((c) => c.method === "GET", () => fake.json({}, 401), 10);
    const { client } = harness(fake);

    const error = await failure(client.get("/employees"));
    expect(error).toBeInstanceOf(WovenApiError);
    expect(error.code).toBe("auth_failed");
    expect(client.tokenRequestsMade).toBe(2);
  });

  it("reports wrong credentials as auth_failed without retrying the login", async () => {
    const fake = fakeWoven({ employees: [], password: "something-else" });
    const { client } = harness(fake);

    const error = await failure(client.get("/employees"));
    expect(error.code).toBe("auth_failed");
    expect(error.status).toBe(400);
    expect(client.tokenRequestsMade).toBe(1);
  });

  it("reports a 403 as forbidden and does not retry it", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override((c) => c.method === "GET", () => fake.json({ message: "Subscription not approved" }, 403), 5);
    const { client } = harness(fake);

    const error = await failure(client.get("/employees"));
    expect(error.code).toBe("forbidden");
    expect(fake.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("reports a 403 on the token exchange as forbidden (subscription not approved)", async () => {
    const fake = fakeWoven({ employees: [] });
    fake.override((c) => c.path === "/tokens/v2", () => fake.json({}, 403));
    const { client } = harness(fake);

    const error = await failure(client.get("/employees"));
    expect(error.code).toBe("forbidden");
    expect(error.path).toBe("/tokens/v2");
  });

  it("never quotes a response body, a credential or a token in an error message", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override(
      (c) => c.method === "GET",
      () => fake.json({ message: "employee Jane Doe jane@home.test not allowed" }, 400),
    );
    const { client } = harness(fake);

    const error = await failure(client.get("/employees"));
    expect(error.code).toBe("request_rejected");
    for (const secret of ["Jane", "jane@home.test", FAKE_CREDENTIALS.subscriptionKey, FAKE_CREDENTIALS.password, "token-1"]) {
      expect(String(error.message)).not.toContain(secret);
    }
  });
});

describe("the token request, as the OpenAPI export defines it", () => {
  it("sends Username and Password, and no CompanyID or Platform unless configured", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    const { client } = harness(fake);
    await client.get("/employees");

    const body = JSON.parse(fake.calls[0].body ?? "{}");
    expect(body).toEqual({ Username: FAKE_CREDENTIALS.username, Password: FAKE_CREDENTIALS.password });
    expect(client.tokenInfo?.companyIdSent).toBe(false);
  });

  it("sends a configured CompanyID and Platform", async () => {
    const fake = fakeWoven({ employees: employees(1), requiredCompanyId: FAKE_COMPANY_ID });
    const { client } = harness(fake, { companyId: FAKE_COMPANY_ID, platform: 1 });
    await client.get("/employees");

    const body = JSON.parse(fake.calls[0].body ?? "{}");
    expect(body.CompanyID).toBe(FAKE_COMPANY_ID);
    expect(body.Platform).toBe(1);
    expect(client.tokenInfo?.companyIdSent).toBe(true);
  });

  it("reads the lifetime from TokenExpirationDate", async () => {
    const fake = fakeWoven({ employees: employees(1), tokenLifetimeSeconds: 3600 });
    const { client } = harness(fake);
    await client.get("/employees");

    expect(client.tokenInfo?.lifetimeSource).toBe("expires_at");
    expect(client.tokenInfo?.lifetimeSeconds).toBe(3600);
  });

  it("reports the company Woven chose, so WOVEN_COMPANY_ID can be discovered — and never the token", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    const { client } = harness(fake);
    await client.get("/employees");

    const info = client.tokenInfo!;
    expect(info.companyId).toBe(FAKE_COMPANY_ID);
    expect(info.companyName).toBe("Sun Tan City (test)");
    expect(info.companyOptions).toEqual([{ companyId: FAKE_COMPANY_ID, companyName: "Sun Tan City (test)" }]);
    expect(JSON.stringify(info)).not.toContain("token-1");
    expect(JSON.stringify(info)).not.toContain("SENSITIVE-REFRESH-TOKEN");
  });
});

describe("no Woven write endpoint is reachable", () => {
  it.each([
    "/employees/borrow",
    "/employees/borrow/locations",
    "/employees/abc/locations/def/primary",
    "/employees/abc/security",
    "/companies/abc/companywebhooks",
    "/companies/abc/companywebhooks/def/triggers",
    "/workorders",
    "/tokens",
  ])("refuses a GET to %s before anything is sent", async (path) => {
    const fake = fakeWoven({ employees: employees(1) });
    const { client } = harness(fake);

    await expect(client.get(path)).rejects.toThrow(/reads only the endpoints/);
    expect(fake.calls.filter((c) => c.path === path)).toHaveLength(0);
  });

  it("reads exactly the four spec read endpoints", async () => {
    const fake = fakeWoven({ employees: employees(1), locations: [{ LocationID: "L1" }], details: { "1000": { Locations: [] } } });
    const { client } = harness(fake);
    await client.listEmployees({}, 100);
    await client.getEmployeeDetails("1000");
    await client.listLocations();
    await client.listEnums();

    const paths = new Set(fake.calls.filter((c) => c.method === "GET").map((c) => c.path));
    expect([...paths].sort()).toEqual(["/employees", "/employees/1000/details", "/lists/enums", "/locations"]);
  });
});

describe("read-only by construction", () => {
  it("has no method that could send anything but GET, bar the token exchange", () => {
    const methods = Object.getOwnPropertyNames(WovenClient.prototype);
    for (const forbidden of ["post", "put", "patch", "delete", "create", "update", "remove"]) {
      expect(methods.some((m) => m.toLowerCase() === forbidden)).toBe(false);
    }
  });

  it("every request of a full read is a GET except the one token POST", async () => {
    const fake = fakeWoven({ employees: employees(250) });
    const { client } = harness(fake);
    await client.listEmployees({}, 100);

    const nonGet = fake.calls.filter((c) => c.method !== "GET");
    expect(nonGet).toHaveLength(1);
    expect(nonGet[0].path).toBe("/tokens/v2");
  });
});

describe("pagination with queryskip / querytake", () => {
  it("reads every page and stops at an empty one", async () => {
    const fake = fakeWoven({ employees: employees(250) });
    const { client } = harness(fake);

    const result = await client.listEmployees({ includeterminatedemployee: "true" }, 100);

    expect(result.records).toHaveLength(250);
    const pages = fake.calls.filter((c) => c.path === "/employees");
    expect(pages.map((c) => [c.query.queryskip, c.query.querytake])).toEqual([
      ["0", "100"],
      ["100", "100"],
      ["200", "100"],
      ["250", "100"],
    ]);
    expect(pages.every((c) => c.query.includeterminatedemployee === "true")).toBe(true);
  });

  it("does not stop early when the gateway caps the page below querytake", async () => {
    const fake = fakeWoven({ employees: employees(120), maxTake: 50 });
    const { client } = harness(fake);

    const result = await client.listEmployees({}, 100);
    expect(result.records).toHaveLength(120);
  });

  it("refuses an enveloped page: the spec's EmployeeArray is a bare array", async () => {
    const fake = fakeWoven({ employees: [] });
    fake.override((c) => c.path === "/employees", () => fake.json({ Items: [wovenEmployee("1")], TotalCount: 1 }));
    const { client } = harness(fake);

    const error = await failure(client.listEmployees({}, 100));
    expect(error.code).toBe("bad_response");
  });

  it("passes the spec's filter parameters by their exact names", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    const { client } = harness(fake);
    await client.listEmployees({ locationids: "WL-0306", positionids: "POS-SD", employeestatus: "1", emailaddress: "a@b.test" }, 100);

    const first = fake.calls.find((c) => c.path === "/employees")!;
    expect(first.query.locationids).toBe("WL-0306");
    expect(first.query.positionids).toBe("POS-SD");
    expect(first.query.employeestatus).toBe("1");
    expect(first.query.emailaddress).toBe("a@b.test");
  });

  it("refuses a gateway that ignores queryskip rather than counting everyone many times", async () => {
    const all = employees(100);
    const fake = fakeWoven({ employees: all });
    fake.override((c) => c.path === "/employees", () => fake.json(all), 5);
    const { client } = harness(fake);

    const error = await failure(client.listEmployees({}, 100));
    expect(error.code).toBe("pagination_not_advancing");
  });

  it("refuses a read that never ends", async () => {
    let n = 0;
    const fake = fakeWoven({ employees: [] });
    fake.override(
      (c) => c.path === "/employees",
      () => fake.json([wovenEmployee(String(++n))]),
      1000,
    );
    const { client } = harness(fake);

    const error = await failure(client.listEmployees({}, 1, { maxPages: 5 }));
    expect(error.code).toBe("pagination_runaway");
  });

  it("refuses an unrecognised page shape instead of reading it as empty", async () => {
    const fake = fakeWoven({ employees: [] });
    fake.override((c) => c.path === "/employees", () => fake.json({ Something: "else" }));
    const { client } = harness(fake);

    const error = await failure(client.listEmployees({}, 100));
    expect(error.code).toBe("bad_response");
  });

  it("recognises only a bare array, as the spec defines", () => {
    expect(extractPage([1, 2])).toEqual({ items: [1, 2], total: null });
    expect(extractPage({ Items: [1], TotalCount: 9 })).toBeNull();
    expect(extractPage({ data: [1] })).toBeNull();
    expect(extractPage("text")).toBeNull();
  });
});

describe("rate limits, server errors and timeouts", () => {
  it("honours Retry-After on a 429, then succeeds", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override((c) => c.method === "GET", () => fake.json({}, 429, { "Retry-After": "7" }));
    const { client, sleeps } = harness(fake);

    await expect(client.get("/employees")).resolves.toBeDefined();
    expect(sleeps).toContain(7000);
  });

  it("gives up after the retry limit on persistent 429s", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override((c) => c.method === "GET", () => fake.json({}, 429, { "Retry-After": "1" }), 10);
    const { client } = harness(fake);

    const error = await failure(client.get("/employees"));
    expect(error.code).toBe("rate_limited");
    expect(fake.calls.filter((c) => c.method === "GET")).toHaveLength(4);
  });

  it("refuses a Retry-After longer than it will wait", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override((c) => c.method === "GET", () => fake.json({}, 429, { "Retry-After": "600" }));
    const { client } = harness(fake);

    const error = await failure(client.get("/employees"));
    expect(error.code).toBe("rate_limited");
    expect(fake.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("retries a 5xx with exponential backoff", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override((c) => c.method === "GET", () => fake.json({}, 503), 2);
    const { client, sleeps } = harness(fake);

    await expect(client.get("/employees")).resolves.toBeDefined();
    expect(sleeps.filter((ms) => ms >= 1000)).toEqual([1000, 2000]);
  });

  it("times out a request that never answers, and retries within the limit", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override((c) => c.method === "GET", () => "timeout", 1);
    const { client } = harness(fake, { transport: { requestTimeoutMs: 20 } });

    await expect(client.get("/employees")).resolves.toBeDefined();
    expect(fake.calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("reports a persistent timeout as timeout", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override((c) => c.method === "GET", () => "timeout", 10);
    const { client } = harness(fake, { transport: { requestTimeoutMs: 10, maxRetries: 1 } });

    const error = await failure(client.get("/employees"));
    expect(error.code).toBe("timeout");
  });

  it("reports an unreachable host as network, without the underlying error text", async () => {
    const fake = fakeWoven({ employees: employees(1) });
    fake.override(() => true, () => "network", 10);
    const { client } = harness(fake, { transport: { maxRetries: 0 } });

    const error = await failure(client.get("/employees"));
    expect(error.code).toBe("network");
    expect(error.message).not.toContain("fetch failed");
  });

  it("never starts more than 100 requests in any 60-second window", async () => {
    const fake = fakeWoven({ employees: employees(3000) });
    let clock = 0;
    const starts: number[] = [];
    const client = new WovenClient({
      baseUrl: BASE,
      credentials: FAKE_CREDENTIALS,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        starts.push(clock);
        return fake.fetch(input, init);
      }) as typeof fetch,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    await client.listEmployees({}, 20);

    expect(starts.length).toBeGreaterThan(100);
    let busiest = 0;
    for (let i = 0; i < starts.length; i += 1) {
      const inWindow = starts.filter((t) => t >= starts[i] && t < starts[i] + 60_000).length;
      busiest = Math.max(busiest, inWindow);
    }
    expect(busiest).toBeLessThanOrEqual(100);
  });

  it("stops starting requests once the deadline has passed", async () => {
    const fake = fakeWoven({ employees: employees(500) });
    let clock = 0;
    const client = new WovenClient({
      baseUrl: BASE,
      credentials: FAKE_CREDENTIALS,
      fetch: fake.fetch,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      deadlineAt: 3_000,
    });

    const error = await failure(client.listEmployees({}, 10));
    expect(error.code).toBe("deadline_exceeded");
    expect(fake.calls.length).toBeLessThanOrEqual(6);
  });
});
