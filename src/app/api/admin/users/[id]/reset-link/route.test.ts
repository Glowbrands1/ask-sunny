import { describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/users/<id>/reset-link, end to end through the route.
 *
 * `manage_users` is enforced before anything is looked up, the target comes
 * from the path and never from the body, the link is built on this site's
 * origin in the scanner-safe shape, and the response is not cacheable.
 */

const HASH = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4";

const EMPLOYEE_ROW = {
  id: "emp-1",
  email: "sam@suntancity.test",
  display_name: "Sam",
  role: "employee",
  status: "active",
  scope_level: "global",
  scope_primary_area_id: null,
  scope_also_covers_area_ids: [],
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

async function loadRoute(options: { permitted?: boolean } = {}) {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_SITE_URL;

  const seen = { lookups: [] as string[], generated: [] as unknown[], authorized: 0 };

  vi.doMock("@/lib/api/respond", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
  }));

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => {
      seen.authorized += 1;
      if (permission !== "manage_users" || options.permitted === false) {
        // Imported here so it is the same class instance the route's module graph sees.
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "You do not have permission to manage users.");
      }
      return {
        identity: { subject: "admin-1", email: "admin@suntancity.test", role: "admin" },
      };
    },
  }));

  vi.doMock("@/lib/supabase/server", () => ({
    KNOWLEDGE_BUCKET: "knowledge-documents",
    getSupabaseAdmin: () => ({
      from: (table: string) => {
        if (table === "app_user_audit") return { insert: async () => ({ error: null }) };
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (_column: string, value: string) => {
            seen.lookups.push(value);
            return chain;
          },
          maybeSingle: async () => ({
            data: seen.lookups.at(-1) === EMPLOYEE_ROW.id ? EMPLOYEE_ROW : null,
            error: null,
          }),
        };
        return chain;
      },
      auth: {
        admin: {
          generateLink: async (args: unknown) => {
            seen.generated.push(args);
            return {
              data: {
                properties: {
                  action_link: `https://project.supabase.co/auth/v1/verify?token=${HASH}`,
                  email_otp: "123456",
                  hashed_token: HASH,
                  redirect_to: "",
                  verification_type: "recovery",
                },
                user: { id: EMPLOYEE_ROW.id },
              },
              error: null,
            };
          },
        },
      },
    }),
  }));

  const { POST } = await import("./route");
  const call = (id: string, body?: unknown) =>
    POST(
      new Request(`https://ask-sunny.vercel.app/api/admin/users/${id}/reset-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  return { call, seen };
}

describe("authorization", () => {
  it("REFUSES a caller without manage_users, before any lookup or link", async () => {
    const { call, seen } = await loadRoute({ permitted: false });
    const response = await call("emp-1");

    expect(response.status).toBe(403);
    expect(seen.lookups).toEqual([]);
    expect(seen.generated).toEqual([]);
    const payload = await response.json();
    expect(payload.url).toBeUndefined();
  });
});

describe("a permitted administrator", () => {
  it("gets the scanner-safe link on this site's origin, uncacheable", async () => {
    const { call, seen } = await loadRoute();
    const response = await call("emp-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(["email", "url"]);
    expect(payload.url).toBe(
      `https://ask-sunny.vercel.app/auth/recovery-start?token_hash=${HASH}&type=recovery`,
    );
    expect(seen.generated).toEqual([{ type: "recovery", email: "sam@suntancity.test" }]);
  });

  it("uses the configured site URL when there is one", async () => {
    const { call } = await loadRoute();
    process.env.NEXT_PUBLIC_SITE_URL = "https://site-url.example/";
    const payload = await (await call("emp-1")).json();
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(payload.url).toBe(
      `https://site-url.example/auth/recovery-start?token_hash=${HASH}&type=recovery`,
    );
  });

  it("ignores any email or target in the body — the path id is the only input", async () => {
    const { call, seen } = await loadRoute();
    const response = await call("emp-1", { email: "attacker@evil.example", id: "admin-1" });

    const payload = await response.json();
    expect(payload.email).toBe("sam@suntancity.test");
    expect(seen.generated).toEqual([{ type: "recovery", email: "sam@suntancity.test" }]);
  });

  it("refuses an unknown user with a 404 and no link", async () => {
    const { call, seen } = await loadRoute();
    const response = await call("nobody");

    expect(response.status).toBe(404);
    expect(seen.generated).toEqual([]);
    expect((await response.json()).url).toBeUndefined();
  });
});
