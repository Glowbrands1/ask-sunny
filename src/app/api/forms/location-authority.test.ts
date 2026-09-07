import { readFileSync } from "node:fs";

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
  templateKey?: string;
  variantKey?: string | null;
  locationId: string | null;
  locationName: string | null;
  employeeName: string;
  createdBy: string;
  source?: string;
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

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      /*
       * The REAL matrix, applied the way `authorizeRequest` applies it. A mock
       * that returned an identity regardless of the permission would make every
       * permission assertion below vacuous — which it did, until requirement 15
       * caught it by passing against an Assistant Salon Director.
       */
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
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
        };
      },
    };
  });

  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async (key: string) => {
      if (key === "dpoa") {
        return {
          id: "tpl-1",
          key: "dpoa",
          name: "Disciplinary Plan of Action",
          shortName: "DPOA",
          description: "",
          layoutFamily: "corrective",
          requiredPermission: "create_corrective_action",
          active,
          displayOrder: 2,
        };
      }
      if (key === "coaching") {
        return {
          id: "tpl-2",
          key: "coaching",
          name: "Coaching Form",
          shortName: "Coaching",
          description: "",
          layoutFamily: "coaching",
          requiredPermission: "create_coaching_form",
          active,
          displayOrder: 1,
        };
      }
      return null;
    },
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

  it("is dropped in LIVE mode even when the id beside it was authorized", async () => {
    /*
     * There is no salon roster. The only source of a display name is
     * `DEMO_LOCATIONS`, which `primaryLocationName` reads and which falls back
     * to the raw id when the lookup misses — so a name arriving here is demo
     * data or the id again, bound to the validated location by nothing.
     *
     * A wrong salon NAME on a disciplinary record reads as verified to everyone
     * who opens the file later, and the record outlives the caveat.
     */
    const { route, created } = await load();
    await route.POST(
      post({
        templateKey: "dpoa",
        employeeName: "Sarah Jones",
        locationId: "loc-0101",
        locationName: "Whatever They Typed",
      }),
    );

    expect(created[0]!.locationId).toBe("loc-0101");
    expect(created[0]!.locationName).toBeNull();
  });

  it("is kept in DEMO mode, where it is explicitly synthetic", async () => {
    // Preview carries the standing synthetic-data notice, the demo salon names
    // are the point of the fixture, and nothing there is an HR record.
    const { route, created } = await load({ demo: true, scope: null });
    await route.POST(
      new Request("https://app.test/api/forms/instances", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ask-sunny-demo-role": "salon_director",
        },
        body: JSON.stringify({
          templateKey: "dpoa",
          employeeName: "Synthetic Person",
          locationId: "loc-101",
          locationName: "Riverbend Commons",
        }),
      }),
    );

    expect(created[0]!.locationName).toBe("Riverbend Commons");
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


/* ==================================================================== */
/*  REQUIREMENTS 15-17, 46-48 — WHAT A CHAT-CREATED FORM GOES THROUGH  */
/* ==================================================================== */

/**
 * ============================================================================
 * THE PROPOSAL SELECTS AN INTENT; THIS ROUTE CREATES THE RECORD
 * ============================================================================
 *
 * A `ChatFormProposal` lives in the browser's IndexedDB. By the time it comes
 * back as a create request it is untrusted orchestration metadata — a manager
 * with dev tools, a stale conversation, a bug — so nothing on it is taken as
 * settled. These tests drive the SAME route the Create a Form workspace uses,
 * with a body shaped exactly the way `createInlineForm` shapes one.
 */
describe("15. a chat-created form is authorized like any other", () => {
  it("applies the TEMPLATE's own permission, not chat's opinion of it", async () => {
    // An Assistant Salon Director holds `create_coaching` — a different
    // permission from `create_coaching_form` — and no form permission at all.
    const { route, created } = await load({ role: "assistant_salon_director" });
    const response = await route.POST(
      post({
        templateKey: "coaching",
        employeeName: "Sarah Jones",
        locationId: "loc-0101",
        source: "ask_sunny",
      }),
    );

    expect(response.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it("refuses a template the library does not have, whatever chat sent", async () => {
    const { route, created } = await load();
    const response = await route.POST(
      post({
        templateKey: "coaching-v2-from-a-stale-conversation",
        employeeName: "Sarah Jones",
        source: "ask_sunny",
      }),
    );

    expect(response.status).toBe(404);
    expect(created).toHaveLength(0);
  });

  it("refuses a template the library has marked inactive", async () => {
    const { route, created } = await load({ active: false });
    const response = await route.POST(
      post({ templateKey: "coaching", employeeName: "Sarah Jones", source: "ask_sunny" }),
    );

    expect(response.status).toBe(404);
    expect(created).toHaveLength(0);
  });
});

describe("14. the server pins the version; the browser never names one", () => {
  const source = readFileSync("src/lib/forms/instances.ts", "utf8");
  const createInstance = source.slice(
    source.indexOf("export async function createInstance"),
    source.indexOf("export async function", source.indexOf("export async function createInstance") + 40),
  );

  it("resolves the current published version inside createInstance", () => {
    expect(createInstance).toContain("getCurrentVersion");
    expect(createInstance).toContain("template_version_id: version.id");
    // And refuses when there is not one, rather than storing a null version.
    expect(createInstance).toContain("has no published version yet");
  });

  it("reads no version from the request body", () => {
    const route = readFileSync("src/app/api/forms/instances/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(route).not.toContain("templateVersionId");
    expect(route).not.toContain("templateVersion");
  });
});

describe("16-17. a foreign salon cannot be created by bypassing the UI", () => {
  it("refuses the exact body a tampered proposal would produce", async () => {
    /*
     * The attack the inline flow makes easy to attempt: the proposal is in
     * IndexedDB, so `locationId` is one edit away. The UI never offers Create
     * draft for an unresolved salon — and that is irrelevant, because this
     * route does not know or care what the UI offered.
     */
    const { route, created } = await load();
    const response = await route.POST(
      post({
        templateKey: "coaching",
        employeeName: "Sarah Jones",
        locationId: "loc-0999",
        source: "ask_sunny",
      }),
    );

    expect(response.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it("refuses a district actor even when chat would never have offered it", async () => {
    const { route, created } = await load({
      role: "district_manager",
      scope: { level: "district", primaryAreaId: "dist-01", alsoCoversAreaIds: [] },
    });
    const response = await route.POST(
      post({
        templateKey: "coaching",
        employeeName: "Sarah Jones",
        locationId: "loc-0101",
        source: "ask_sunny",
      }),
    );

    expect(response.status).toBe(403);
    expect(created).toHaveLength(0);
  });
});

describe("46. a chat-created form is a canonical instance", () => {
  it("records source ask_sunny, and nothing chat-specific alongside it", async () => {
    const { route, created } = await load();
    await route.POST(
      post({
        templateKey: "coaching",
        employeeName: "Sarah Jones",
        locationId: "loc-0101",
        source: "ask_sunny",
      }),
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.source).toBe("ask_sunny");
    expect(created[0]!.templateKey).toBe("coaching");
    expect(created[0]!.locationId).toBe("loc-0101");
  });

  it("carries no salon display name, because none is authoritative", async () => {
    // `createInlineForm` sends no `locationName`, and the route would drop one
    // anyway if the id had been refused. See docs/chat-phase-3.md.
    const { route, created } = await load();
    await route.POST(
      post({
        templateKey: "coaching",
        employeeName: "Sarah Jones",
        locationId: "loc-0101",
        source: "ask_sunny",
      }),
    );

    expect(created[0]!.locationName).toBeNull();
  });

  it("falls back to manual for any source that is not ask_sunny", async () => {
    // The route allow-lists rather than echoing, so a caller cannot invent a
    // third provenance value that Form Monitoring has never heard of.
    const { route, created } = await load();
    await route.POST(
      post({
        templateKey: "coaching",
        employeeName: "Sarah Jones",
        source: "something_else",
      }),
    );

    expect(created[0]!.source).toBe("manual");
  });
});

describe("47-48. no second forms engine, and no second monitoring store", () => {
  const code = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("routes every chat form write through the existing Forms API", () => {
    const chat = code("src/features/chat/create-inline-form.ts");
    const urls = [...chat.matchAll(/"(\/api\/[^"]+)"|`(\/api\/[^`$]*)/g)].map(
      (match) => match[1] ?? match[2],
    );

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url!.startsWith("/api/forms/")).toBe(true);
  });

  it("introduces no chat-owned form storage", () => {
    for (const file of [
      "src/features/chat/create-inline-form.ts",
      "src/features/chat/inline-form.tsx",
      "src/features/chat/message-bubble.tsx",
    ]) {
      const source = code(file);
      // No direct database access, and no second table.
      expect(source, file).not.toContain("getSupabaseAdmin");
      expect(source, file).not.toContain("createClient");
      expect(source, file).not.toMatch(/from\(["'`]form_/);
      expect(source, file).not.toMatch(/chat_form|form_drafts_chat/);
    }
  });

  it("reads Form Monitoring's list without a source filter, so it sees both", () => {
    /*
     * The monitoring query is untouched by this phase, and that is the point:
     * a chat-created row is a `form_instances` row, so the existing read
     * returns it under the existing rules. A `source` filter here would be the
     * bug — chat forms would silently vanish from the history.
     */
    const instances = code("src/lib/forms/instances.ts");
    const listInstances = instances.slice(
      instances.indexOf("export async function listInstances"),
      instances.indexOf("export interface LoadedInstance"),
    );

    expect(listInstances).toContain("form_instance_overview");
    expect(listInstances).not.toMatch(/eq\(\s*["']source["']/);
    expect(listInstances).not.toContain("ask_sunny");
  });
});
