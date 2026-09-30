import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessScope, Role } from "@/types";

/**
 * ============================================================================
 * "CREATE DRAFT" FOR 'coaching - avery testperson', ROLE BY ROLE, AT THE ROUTE
 * ============================================================================
 *
 * The chat card is a proposal; `POST /api/forms/instances` is the boundary.
 * This drives it with the body `createInlineForm` sends for the lower-case
 * separator prompt the 30 September fix was for, as each representative role,
 * with the REAL permission matrix applied the way `authorizeRequest` applies it.
 *
 * What it pins:
 *   - the lower-case name passes the route's re-read of the conversation for
 *     every role that may create the form (the fix is not Admin-only here either);
 *   - a role without `create_coaching_form` is refused 403 before the
 *     conversation is read, and nothing is created;
 *   - a salon outside the caller's scope is refused, and a district or regional
 *     caller is refused ANY salon, because the forms path does not yet expand
 *     their area into salons. Without a salon they may create the form — which
 *     is exactly what chat does not currently offer them.
 */

const ORIGINAL = { ...process.env };

interface Created {
  templateKey?: string;
  employeeName: string;
  locationId: string | null;
  createdByRole?: string | null;
}

async function load(role: Role, scope: AccessScope) {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();
  const created: Created[] = [];

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: { subject: `user-${role}`, email: `${role}@example.com`, displayName: role, role, scope, verified: true },
          permission,
          provider: "supabase",
        };
      },
    };
  });

  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async (key: string) =>
      key === "coaching"
        ? { id: "tpl-coaching", key: "coaching", name: "Coaching Form", requiredPermission: "create_coaching_form", active: true }
        : null,
  }));

  vi.doMock("@/lib/forms/instances", () => ({
    createInstance: async (input: Created) => {
      created.push(input);
      return { id: "inst-1", ...input };
    },
    applyStatedFacts: async () => undefined,
    listInstances: async () => [],
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    deleteDemoInstances: async () => ({ deleted: 0 }),
    InstanceProtectedError: class extends Error {},
  }));

  const route = await import("./instances/route");
  return { route, created };
}

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/forms/repository");
  vi.doUnmock("@/lib/forms/instances");
});

/* The body `createInlineForm` sends for the card the prompt produced. */
function create(locationId: string | null) {
  return new Request("https://app.test/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      templateKey: "coaching",
      employeeName: "avery testperson",
      locationId,
      source: "ask_sunny",
      conversation: [
        { id: "m-1", role: "user", content: "coaching - avery testperson" },
        { id: "m-2", role: "assistant", content: "Here is what I would put on a Coaching Form." },
      ],
    }),
  });
}

const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const SALON_0311: AccessScope = { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: [] };
const DUGAN: AccessScope = { level: "district", primaryAreaId: "dist-dugan-rachael", alsoCoversAreaIds: [] };
const REGION: AccessScope = { level: "region", primaryAreaId: "reg-patterson-madeline", alsoCoversAreaIds: [] };

describe("roles that may create a Coaching Form", () => {
  it("Admin (global): created, with no salon", async () => {
    const { route, created } = await load("admin", GLOBAL);
    const response = await route.POST(create(null));
    expect(response.status).toBe(200);
    expect(created).toEqual([expect.objectContaining({ employeeName: "avery testperson", locationId: null, createdByRole: "admin" })]);
  });

  it("Salon Director: created at their own salon, refused at another", async () => {
    const own = await load("salon_director", SALON_0311);
    expect((await own.route.POST(create("loc-0311"))).status).toBe(200);
    expect(own.created[0]!.locationId).toBe("loc-0311");

    const other = await load("salon_director", SALON_0311);
    expect((await other.route.POST(create("loc-0306"))).status).toBe(403);
    expect(other.created).toHaveLength(0);
  });

  it.each([
    ["district_manager", DUGAN],
    ["regional_manager", REGION],
  ] as const)("%s: created without a salon — the case chat does not currently offer", async (role, scope) => {
    const { route, created } = await load(role, scope);
    const response = await route.POST(create(null));
    expect(response.status).toBe(200);
    expect(created[0]).toEqual(expect.objectContaining({ employeeName: "avery testperson", locationId: null }));
  });

  it.each([
    ["district_manager", DUGAN, "loc-0311"],
    ["regional_manager", REGION, "loc-0306"],
  ] as const)("%s: refused a salon even inside their own area (fails closed today)", async (role, scope, locationId) => {
    const { route, created } = await load(role, scope);
    const response = await route.POST(create(locationId));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toMatch(/cannot yet verify/i);
    expect(created).toHaveLength(0);
  });
});

describe("roles that may not create a Coaching Form", () => {
  it.each([
    ["employee", SALON_0311],
    ["assistant_salon_director", SALON_0311],
  ] as const)("%s: refused 403, nothing created, whatever salon is sent", async (role, scope) => {
    for (const locationId of [null, "loc-0311"]) {
      const { route, created } = await load(role, scope);
      const response = await route.POST(create(locationId));
      expect(response.status).toBe(403);
      expect(created).toHaveLength(0);
      // The refusal is about permission, never about the conversation.
      expect(((await response.json()) as { code?: string }).code).not.toBe("proposal_superseded");
    }
  });
});
