import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 27–33 — THE SALON ON AN HR RECORD IS THE SERVER'S DECISION
 * ============================================================================
 *
 * THE ROUTE, NOT THE CHAT ORCHESTRATION. `POST /api/forms/instances` is the one
 * path every form-creating caller goes through — the Create a Form workspace
 * today, a confirmed chat proposal tomorrow, and anything holding a session
 * cookie and a terminal right now. A check that lives in one caller is a check
 * the next caller does not have, which is why these tests drive the ROUTE.
 *
 * WHAT WAS EXPLOITABLE. The route read `locationId` and `locationName` from the
 * body and passed both straight to `createInstance`. A signed-in Salon Director
 * assigned to loc-0101 could file a Disciplinary Plan of Action against
 * loc-0999 by editing one field of the request — and the record would look, to
 * everybody who opened it afterwards, exactly like one filed by that salon's
 * own manager. `authorizeForms` had the scope in its hand and discarded it.
 *
 * The first test below is the GUARD ON THE GUARD: it proves the fixture can
 * express that attack, so the refusals after it mean something.
 */

const ORIGINAL = { ...process.env };

const SALON_SCOPE: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0101",
  alsoCoversAreaIds: [],
};

interface Created {
  locationId: string | null;
  locationName: string | null;
  employeeName: string;
  createdBy: string;
}

async function load(options: {
  scope?: AccessScope | null;
  role?: string;
  demo?: boolean;
  active?: boolean;
} = {}) {
  const { scope = SALON_SCOPE, role = "salon_director", demo = false, active = true } = options;

  process.env.NEXT_PUBLIC_DEMO_MODE = demo ? "true" : "false";
  vi.resetModules();

  const created: Created[] = [];

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: "user-1",
        email: "sd@example.com",
        displayName: "SD",
        role,
        scope,
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));

  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async (key: string) =>
      key === "dpoa"
        ? {
            id: "tpl-1",
            key: "dpoa",
            name: "Disciplinary Plan of Action",
            shortName: "DPOA",
            description: "",
            layoutFamily: "corrective",
            requiredPermission: "create_corrective_action",
            active,
            displayOrder: 2,
          }
        : null,
  }));

  vi.doMock("@/lib/forms/instances", () => ({
    createInstance: async (input: Created) => {
      created.push(input);
      return { id: "inst-1", ...input };
    },
    listInstances: async () => [],
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    deleteDemoInstances: async () => ({ deleted: 0 }),
    InstanceProtectedError: class extends Error {},
  }));

  const route = await import("./instances/route");
  return { route, created };
}

function post(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) {
    vi.doUnmock(mod);
  }
  vi.resetModules();
});

/* ============================================== the guard on the guard == */

describe("27. the fixture can express the attack", () => {
  it("stores whatever location it is given, when it is given one", async () => {
    // The salon on this actor's own assignment goes through, which is what
    // makes the refusal of a foreign one below a real result rather than a
    // route that stores nothing whatever it is sent.
    const { route, created } = await load();
    const response = await route.POST(
      post({ templateKey: "dpoa", employeeName: "Sarah Jones", locationId: "loc-0101" }),
    );

    expect(response.status).toBe(200);
    expect(created).toHaveLength(1);
    expect(created[0]!.locationId).toBe("loc-0101");
  });
});

/* ======================================================== the refusal == */

describe("28. a salon the caller is not assigned to is refused", () => {
  it("returns 403 and creates nothing", async () => {
    const { route, created } = await load();
    const response = await route.POST(
      post({ templateKey: "dpoa", employeeName: "Sarah Jones", locationId: "loc-0999" }),
    );

    expect(response.status).toBe(403);
    expect(created).toHaveLength(0);

    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/not one you are assigned to/i);
  });

  it("refuses even when a plausible salon NAME is supplied alongside", async () => {
    const { route, created } = await load();
    const response = await route.POST(
      post({
        templateKey: "dpoa",
        employeeName: "Sarah Jones",
        locationId: "loc-0999",
        locationName: "Sun Tan City — Brentwood",
      }),
    );

    expect(response.status).toBe(403);
    expect(created).toHaveLength(0);
  });
});

describe("29. a district manager is refused, not silently accepted", () => {
  it.each(["district", "region"] as const)("%s", async (level) => {
    const { route, created } = await load({
      role: "district_manager",
      scope: { level, primaryAreaId: `${level}-01`, alsoCoversAreaIds: [] },
    });
    const response = await route.POST(
      post({ templateKey: "dpoa", employeeName: "Sarah Jones", locationId: "loc-0101" }),
    );

    expect(response.status).toBe(403);
    expect(created).toHaveLength(0);
    expect(((await response.json()) as { error: string }).error).toMatch(/cannot yet verify/i);
  });
});

/* ===================================================== the name follows == */

describe("30. a display name is never an independent authority", () => {
  it("is dropped when no location id was authorized", async () => {
    /*
     * A location id and a display name must not become two authorities. A
     * caller sending only a name would otherwise leave a salon on the record
     * that no scope check ever saw.
     */
    const { route, created } = await load();
    const response = await route.POST(
      post({
        templateKey: "dpoa",
        employeeName: "Sarah Jones",
        locationName: "Sun Tan City — Brentwood",
      }),
    );

    expect(response.status).toBe(200);
    expect(created[0]!.locationId).toBeNull();
    expect(created[0]!.locationName).toBeNull();
  });

  it("is kept when the id beside it was authorized", async () => {
    // The limitation, stated rather than papered over: there is no roster to
    // check the name AGAINST the id. It stays caller-supplied text attached to
    // a server-validated id.
    const { route, created } = await load();
    await route.POST(
      post({
        templateKey: "dpoa",
        employeeName: "Sarah Jones",
        locationId: "loc-0101",
        locationName: "Whatever They Typed",
      }),
    );

    expect(created[0]!.locationName).toBe("Whatever They Typed");
  });
});

/* ======================================= what did NOT change (31–33) == */

describe("31. a form with no salon is still a form", () => {
  it("creates it, rather than refusing for a field nobody asked for", async () => {
    const { route, created } = await load();
    const response = await route.POST(post({ templateKey: "dpoa", employeeName: "Sarah Jones" }));

    expect(response.status).toBe(200);
    expect(created[0]!.locationId).toBeNull();
  });
});

describe("32. preview mode is unchanged", () => {
  it("does not enforce a scope the browser asserted about itself", async () => {
    const { route, created } = await load({ demo: true, scope: null });
    const request = new Request("https://app.test/api/forms/instances", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ask-sunny-demo-role": "salon_director",
      },
      body: JSON.stringify({
        templateKey: "dpoa",
        employeeName: "Synthetic Person",
        locationId: "loc-0999",
      }),
    });

    expect((await route.POST(request)).status).toBe(200);
    expect(created[0]!.locationId).toBe("loc-0999");
    expect(created[0]!.createdBy).toMatch(/^demo:/);
  });
});

describe("33. the template's own permission is still what is enforced", () => {
  it("refuses a template that does not exist before anything else", async () => {
    const { route, created } = await load();
    const response = await route.POST(
      post({ templateKey: "no-such-form", employeeName: "Sarah Jones" }),
    );

    expect(response.status).toBe(404);
    expect(created).toHaveLength(0);
  });

  it("still requires an employee name", async () => {
    const { route, created } = await load();
    expect((await route.POST(post({ templateKey: "dpoa", employeeName: "  " }))).status).toBe(400);
    expect(created).toHaveLength(0);
  });
});
