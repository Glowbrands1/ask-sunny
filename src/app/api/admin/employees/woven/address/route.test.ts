import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/admin/employees/woven/address — "Show address" on the Employee Directory (Pau, 26 Nov 2026: "can we list
 * their address here"). The directory's own people only (Manage users AND Manage integrations), only an id the
 * directory holds, and the address is returned uncached and stored nowhere. Invented people only.
 */

afterEach(() => {
  vi.doUnmock("@/lib/api/respond");
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/permissions");
  vi.doUnmock("@/lib/employees/woven/directory");
  vi.doUnmock("@/lib/forms/exit-woven-address");
});

async function loadRoute(options: { permitted?: boolean; integrations?: boolean } = {}) {
  vi.resetModules();
  const seen = { lookedUp: [] as string[] };
  vi.doMock("@/lib/api/respond", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
  }));
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async () => {
      if (options.permitted === false) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity: { subject: "admin-1", email: "admin@example.test", role: "admin" } };
    },
  }));
  vi.doMock("@/lib/permissions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/permissions")>()),
    hasPermission: () => options.integrations !== false,
  }));
  vi.doMock("@/lib/employees/woven/directory", () => ({
    loadDirectoryRows: async () => [
      { id: "row-1", externalEmployeeId: "woven-1" },
      { id: "row-2", externalEmployeeId: "woven-2" },
    ],
  }));
  vi.doMock("@/lib/forms/exit-woven-address", () => ({
    wovenAddressForEmployee: async (wovenId: string) => {
      seen.lookedUp.push(wovenId);
      return wovenId === "woven-1"
        ? { status: "found", address: "412 Ashgrove Ln, Lincoln, NE 68508" }
        : { status: "none", reason: "no_address" };
    },
  }));
  const route = await import("./route");
  return { GET: route.GET, seen };
}

const get = (GET: (request: Request) => Promise<Response>, id?: string) =>
  GET(new Request(`https://app.test/api/admin/employees/woven/address${id ? `?id=${id}` : ""}`));

describe('"Show address" on the Employee Directory', () => {
  it("returns one person's address from Woven, uncached", async () => {
    const { GET, seen } = await loadRoute();
    const response = await get(GET, "row-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "found", address: "412 Ashgrove Ln, Lincoln, NE 68508" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(seen.lookedUp).toEqual(["woven-1"]);
  });

  it("says when Woven has no address", async () => {
    const { GET } = await loadRoute();
    expect(await (await get(GET, "row-2")).json()).toEqual({ status: "none", reason: "no_address" });
  });

  it("looks up only an employee the directory holds", async () => {
    const { GET, seen } = await loadRoute();
    expect((await get(GET, "not-a-row")).status).toBe(404);
    expect((await get(GET)).status).toBe(400);
    expect(seen.lookedUp).toEqual([]);
  });

  it("refuses anyone without the directory's permissions, before asking Woven", async () => {
    for (const options of [{ permitted: false }, { integrations: false }]) {
      const { GET, seen } = await loadRoute(options);
      expect((await get(GET, "row-1")).status).toBe(403);
      expect(seen.lookedUp).toEqual([]);
    }
  });
});
