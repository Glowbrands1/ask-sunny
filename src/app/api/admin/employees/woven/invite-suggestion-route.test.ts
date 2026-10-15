import { afterEach, describe, expect, it, vi } from "vitest";

/** `GET /invite-suggestion`: who may ask, and that it changes nothing. */

const MOCKED = [
  "@/lib/api/respond",
  "@/lib/auth/server",
  "@/lib/employees/woven/directory",
  "@/lib/employees/woven/locations",
  "@/lib/employees/woven/positions",
];

afterEach(() => {
  for (const m of MOCKED) vi.doUnmock(m);
});

async function load(options: { deny?: string[]; role?: string } = {}) {
  vi.resetModules();
  const permissions: string[] = [];
  vi.doMock("@/lib/api/respond", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
  }));
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => {
      permissions.push(permission);
      if (options.deny?.includes(permission)) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity: { subject: "admin-1", email: "admin@suntancity.test", role: options.role ?? "admin" }, permission };
    },
  }));
  const reads = { directory: 0 };
  vi.doMock("@/lib/employees/woven/directory", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/directory")>()),
    loadDirectoryRows: async () => {
      reads.directory += 1;
      return [];
    },
  }));
  vi.doMock("@/lib/employees/woven/locations", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/locations")>()),
    listWovenLocations: async () => [],
  }));
  vi.doMock("@/lib/employees/woven/positions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/positions")>()),
    listWovenPositions: async () => [],
  }));
  const { GET } = await import("./invite-suggestion/route");
  return { GET, permissions, reads };
}

const get = (query: string) =>
  new Request(`https://ask-sunny.test/api/admin/employees/woven/invite-suggestion${query}`);

describe("GET /invite-suggestion", () => {
  it("answers an administrator, with no-store, and an unknown email is not_found", async () => {
    const { GET, permissions } = await load();
    const response = await GET(get("?email=nobody%40suntancity.com"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "not_found" });
    expect(permissions).toEqual(["manage_users"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is refused without manage_users, and reads nothing", async () => {
    const { GET, reads } = await load({ deny: ["manage_users"] });
    expect((await GET(get("?email=a%40b.co"))).status).toBe(403);
    expect(reads.directory).toBe(0);
  });

  it("is refused for a role without manage_integrations, and reads nothing", async () => {
    const { GET, reads } = await load({ role: "salon_director" });
    expect((await GET(get("?email=a%40b.co"))).status).toBe(403);
    expect(reads.directory).toBe(0);
  });

  it("refuses a missing or oversized address", async () => {
    const { GET } = await load();
    expect((await GET(get(""))).status).toBe(400);
    expect((await GET(get(`?email=${"a".repeat(300)}`))).status).toBe(400);
  });
});
