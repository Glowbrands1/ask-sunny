import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE WOVEN PEOPLE ROUTES — manage_integrations AND manage_users
 * ============================================================================
 *
 * Every route that returns names, emails or mapping decisions about people
 * asks `authorizeRequest` for `manage_users` and then checks the caller also
 * holds `manage_integrations`. The read models are stubbed: these tests are
 * about who may call, and that the routes change nothing they should not.
 */

const MOCKED = [
  "@/lib/api/respond",
  "@/lib/auth/server",
  "@/lib/employees/woven/directory",
  "@/lib/employees/woven/locations",
  "@/lib/employees/woven/positions",
  "@/lib/employees/woven/access-preview",
  "@/lib/employees/woven/access/link-store",
];

afterEach(() => {
  for (const m of MOCKED) vi.doUnmock(m);
});

interface Seen {
  permissions: string[];
  writes: { what: string; input: Record<string, unknown> }[];
}

async function load(
  route: string,
  options: { deny?: string[]; role?: string } = {},
): Promise<{ handlers: Record<string, (req: Request, ctx?: unknown) => Promise<Response>>; seen: Seen }> {
  vi.resetModules();
  const seen: Seen = { permissions: [], writes: [] };

  vi.doMock("@/lib/api/respond", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  }));
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => {
      seen.permissions.push(permission);
      if (options.deny?.includes(permission)) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity: { subject: "admin-1", email: "admin@suntancity.test", role: options.role ?? "admin" }, permission };
    },
  }));
  vi.doMock("@/lib/employees/woven/directory", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/directory")>()),
    loadDirectoryRows: async () => [],
    loadChangePage: async () => ({ rows: [], total: 0, page: 1, pageSize: 50, kindCounts: {} }),
    loadRuns: async () => [],
    reviewChange: async (input: Record<string, unknown>) => {
      seen.writes.push({ what: "change", input });
      return "reviewed";
    },
  }));
  vi.doMock("@/lib/employees/woven/locations", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/locations")>()),
    listWovenLocations: async () => [],
    reviewWovenLocation: async (input: Record<string, unknown>) => {
      seen.writes.push({ what: "location", input });
      return "reviewed";
    },
  }));
  vi.doMock("@/lib/employees/woven/positions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/positions")>()),
    listWovenPositions: async () => [],
    reviewWovenPosition: async (input: Record<string, unknown>) => {
      seen.writes.push({ what: "position", input });
      return "reviewed";
    },
  }));
  vi.doMock("@/lib/employees/woven/access-preview", () => ({ loadAccessPreviewRows: async () => [] }));
  vi.doMock("@/lib/employees/woven/access/link-store", () => ({
    recordLinkReview: async (input: Record<string, unknown>, reviewer: string) => {
      seen.writes.push({ what: "link", input: { ...input, reviewer } });
      return {
        app_user_id: input.appUserId,
        management: input.decision === "confirm" ? "woven_linked" : "not_woven_managed",
        external_employee_id: input.decision === "confirm" ? input.externalEmployeeId : null,
        managed_status: false,
        managed_location: false,
        managed_role: false,
      };
    },
  }));

  const handlers = (await import(`./${route}/route`)) as Record<string, (req: Request, ctx?: unknown) => Promise<Response>>;
  return { handlers, seen };
}

const req = (method: string, body?: unknown, path = "x") =>
  new Request(`https://ask-sunny.test/api/admin/employees/woven/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const CHANGE_ID = "3f9c2a1e-0000-4000-8000-000000000001";

const CASES: { route: string; method: string; body?: unknown; ctx?: unknown }[] = [
  { route: "directory", method: "GET" },
  { route: "changes", method: "GET" },
  { route: "changes/[id]", method: "PATCH", body: { reviewStatus: "acknowledged" }, ctx: { params: Promise.resolve({ id: CHANGE_ID }) } },
  { route: "locations", method: "GET" },
  { route: "locations", method: "PATCH", body: { wovenLocationId: "WL-1", status: "ignored" } },
  { route: "positions", method: "GET" },
  { route: "positions", method: "PATCH", body: { wovenPositionId: "P-1", status: "ignored" } },
  { route: "eligibility", method: "POST", body: { email: "someone@suntancity.test" } },
  {
    route: "links",
    method: "POST",
    body: { appUserId: "3f9c2a1e-0000-4000-8000-0000000000aa", externalEmployeeId: "E-1", decision: "confirm", samePersonConfirmed: true },
  },
];

describe.each(CASES)("$method /$route", ({ route, method, body, ctx }) => {
  it("asks for manage_users, and succeeds for an administrator holding both permissions", async () => {
    const { handlers, seen } = await load(route);
    const response = await handlers[method](req(method, body), ctx);
    expect(response.status).toBe(200);
    expect(seen.permissions).toEqual(["manage_users"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is refused (403) without manage_users, and writes nothing", async () => {
    const { handlers, seen } = await load(route, { deny: ["manage_users"] });
    const response = await handlers[method](req(method, body), ctx);
    expect(response.status).toBe(403);
    expect(seen.writes).toEqual([]);
  });

  it("is refused (403) for a role with manage_users but not manage_integrations, and writes nothing", async () => {
    /* No role in today's matrix is like this; the helper still checks, so one added later is refused. */
    const { handlers, seen } = await load(route, { role: "salon_director" });
    const response = await handlers[method](req(method, body), ctx);
    expect(response.status).toBe(403);
    expect(seen.writes).toEqual([]);
  });
});

describe("GET /runs — counts only", () => {
  it("needs manage_integrations alone", async () => {
    const { handlers, seen } = await load("runs");
    const response = await handlers.GET(req("GET"));
    expect(response.status).toBe(200);
    expect(seen.permissions).toEqual(["manage_integrations"]);
  });
});

describe("decisions record the verified session as the reviewer, never the body", () => {
  it("location review", async () => {
    const { handlers, seen } = await load("locations");
    await handlers.PATCH(req("PATCH", { wovenLocationId: "WL-1", status: "ignored", reviewedBy: "someone-else" }));
    expect(seen.writes[0].input.reviewedBy).toBe("admin:admin@suntancity.test");
  });

  it("position review", async () => {
    const { handlers, seen } = await load("positions");
    await handlers.PATCH(req("PATCH", { wovenPositionId: "P-1", status: "mapped", role: "salon_director", scopeLevel: "salon", hierarchyRank: 30, reviewedBy: "x" }));
    expect(seen.writes[0]).toMatchObject({ what: "position", input: { role: "salon_director", scopeLevel: "salon", hierarchyRank: 30, reviewedBy: "admin:admin@suntancity.test" } });
  });

  it("change review", async () => {
    const { handlers, seen } = await load("changes/[id]");
    await handlers.PATCH(req("PATCH", { reviewStatus: "dismissed", reviewedBy: "x" }), { params: Promise.resolve({ id: CHANGE_ID }) });
    expect(seen.writes[0].input).toEqual({ id: CHANGE_ID, reviewStatus: "dismissed", reviewedBy: "admin:admin@suntancity.test" });
  });
});

describe("link review", () => {
  const ACCOUNT = "3f9c2a1e-0000-4000-8000-0000000000aa";

  it("records the verified session as the reviewer, never the body", async () => {
    const { handlers, seen } = await load("links");
    const response = await handlers.POST(req("POST", { appUserId: ACCOUNT, externalEmployeeId: "E-1", decision: "confirm", samePersonConfirmed: true, setBy: "someone-else" }));
    expect(await response.json()).toMatchObject({ status: "linked", link: { appUserId: ACCOUNT, externalEmployeeId: "E-1" } });
    expect(seen.writes).toEqual([{ what: "link", input: expect.objectContaining({ appUserId: ACCOUNT, reviewer: "admin:admin@suntancity.test" }) }]);
  });

  it("refuses a confirmation without the explicit same-person tick, writing nothing", async () => {
    const { handlers, seen } = await load("links");
    const response = await handlers.POST(req("POST", { appUserId: ACCOUNT, externalEmployeeId: "E-1", decision: "confirm" }));
    expect(response.status).toBe(400);
    expect(seen.writes).toEqual([]);
  });

  it("refuses an unknown decision or a malformed id", async () => {
    const { handlers, seen } = await load("links");
    expect((await handlers.POST(req("POST", { appUserId: ACCOUNT, externalEmployeeId: "E-1", decision: "merge" }))).status).toBe(400);
    expect((await handlers.POST(req("POST", { appUserId: "x", externalEmployeeId: "E-1", decision: "not_woven_managed" }))).status).toBe(400);
    expect(seen.writes).toEqual([]);
  });

  it("'different person' is recorded as not Woven-managed", async () => {
    const { handlers } = await load("links");
    const response = await handlers.POST(req("POST", { appUserId: ACCOUNT, externalEmployeeId: "E-1", decision: "not_woven_managed" }));
    expect(await response.json()).toMatchObject({ status: "marked_not_woven_managed" });
  });
});

describe("validation", () => {
  it("refuses a position mapped to a role that does not exist", async () => {
    const { handlers, seen } = await load("positions");
    const response = await handlers.PATCH(req("PATCH", { wovenPositionId: "P-1", status: "mapped", role: "superuser", scopeLevel: "salon" }));
    expect(response.status).toBe(400);
    expect(seen.writes).toEqual([]);
  });

  it("refuses a change review with an unknown status or a malformed id", async () => {
    const { handlers } = await load("changes/[id]");
    expect((await handlers.PATCH(req("PATCH", { reviewStatus: "deleted" }), { params: Promise.resolve({ id: CHANGE_ID }) })).status).toBe(400);
    expect((await handlers.PATCH(req("PATCH", { reviewStatus: "dismissed" }), { params: Promise.resolve({ id: "../x" }) })).status).toBe(400);
  });

  it("eligibility is a POST with the email in the body, never the URL, and creates nothing", async () => {
    const { handlers, seen } = await load("eligibility");
    const response = await handlers.POST(req("POST", { email: "someone@suntancity.test" }));
    const body = (await response.json()) as { result: { previewOnly: boolean; verdict: string } };
    expect(body.result.previewOnly).toBe(true);
    expect(body.result.verdict).toBe("not_eligible");
    expect(seen.writes).toEqual([]);
    expect(handlers.GET).toBeUndefined();
  });
});
