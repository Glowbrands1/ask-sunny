import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * GET /api/admin/employees/woven/home-address — admins only (Pau, 26 Nov 2026, approved by Curt). Woven itself is
 * stubbed: these tests are about who may call and what comes back.
 */

const ID = "3f9c2a1e-0000-4000-8000-000000000001";
const MOCKED = ["@/lib/api/respond", "@/lib/auth/server", "@/lib/employees/woven/home-address-lookup"];

afterEach(() => {
  for (const m of MOCKED) vi.doUnmock(m);
});

async function call(options: { role?: string; deny?: string[]; id?: string } = {}) {
  vi.resetModules();
  const looked: string[] = [];
  vi.doMock("@/lib/api/respond", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
  }));
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => {
      if (options.deny?.includes(permission)) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity: { subject: "u-1", email: "someone@suntancity.test", role: options.role ?? "admin" }, permission };
    },
  }));
  vi.doMock("@/lib/employees/woven/home-address-lookup", () => ({
    lookUpWovenHomeAddress: async (id: string) => {
      looked.push(id);
      return { status: "found", address: "412 Invented Ln, Faketown, NE 68000" };
    },
  }));
  const { GET } = await import("./route");
  const response = await GET(new Request(`https://ask-sunny.test/api/admin/employees/woven/home-address?id=${options.id ?? ID}`));
  return { response, looked };
}

describe("GET /home-address", () => {
  it("an admin gets the address, uncached", async () => {
    const { response, looked } = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "found", address: "412 Invented Ln, Faketown, NE 68000" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(looked).toEqual([ID]);
  });

  it("refuses without manage_users, and asks Woven nothing", async () => {
    const { response, looked } = await call({ deny: ["manage_users"] });
    expect(response.status).toBe(403);
    expect(looked).toEqual([]);
  });

  it("refuses a manager (they see it on the exit form only), and asks Woven nothing", async () => {
    const { response, looked } = await call({ role: "district_manager" });
    expect(response.status).toBe(403);
    expect(looked).toEqual([]);
  });

  it("rejects a missing or malformed id", async () => {
    const { response, looked } = await call({ id: "not-an-id" });
    expect(response.status).toBe(400);
    expect(looked).toEqual([]);
  });
});
