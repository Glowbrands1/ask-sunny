import { afterEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * WHO MAY REACH THE RESIGNATION/EXIT FORM — THROUGH THE ROUTES, NOT THE UI
 * ============================================================================
 *
 * Live mode, the REAL permission matrix applied the way `authorizeRequest`
 * applies it, and the real route handlers. The question is not whether a card
 * is shown but whether somebody without `create_exit_form` can obtain the
 * template or a new exit form by calling the API with its key directly —
 * "stc-exit", or any of the words it answers to in chat.
 */

const EXIT = TEMPLATE_SEEDS.find((entry) => entry.key === "stc-exit")!;
const COACHING = TEMPLATE_SEEDS.find((entry) => entry.key === "coaching")!;
const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: [] };

const calls = {
  created: [] as Record<string, unknown>[],
  drafted: 0,
  repositoryReads: 0,
};

async function load(role: string, scope: AccessScope = SALON) {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();
  calls.created = [];
  calls.drafted = 0;
  calls.repositoryReads = 0;

  vi.doMock("@/lib/api/respond", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api/respond")>();
    return {
      ...actual,
      assertLiveMode: () => {},
      assertNoConfigurationProblems: () => {},
      assertWithinRateLimit: () => {},
    };
  });

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: {
            subject: "user-1",
            email: "person@example.com",
            displayName: role,
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

  const templateRow = {
    id: "tpl-exit",
    key: "stc-exit",
    name: EXIT.name,
    shortName: EXIT.shortName,
    description: EXIT.description,
    category: EXIT.category,
    layoutFamily: EXIT.layoutFamily,
    requiredPermission: EXIT.requiredPermission,
    active: true,
    displayOrder: EXIT.displayOrder,
  };

  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async (key: string) => {
      calls.repositoryReads += 1;
      return key === "stc-exit" ? templateRow : null;
    },
    listTemplateSummaries: async () => {
      calls.repositoryReads += 1;
      return [templateRow];
    },
    listVersions: async () => [],
    getCurrentVersion: async () => null,
    listAssets: async () => [],
  }));

  const coaching = {
    id: "inst-coaching",
    templateKey: "coaching",
    templateName: "Coaching Form",
    layoutFamily: "coaching",
    variantKey: null,
    employeeName: "Sam Lee",
    employeeRole: null,
    locationId: "loc-0311",
    locationName: "NE Lincoln O Street",
    createdBy: "someone-else",
    formDate: "2026-09-28",
    status: "draft",
  };

  const instance = {
    id: "inst-exit",
    templateKey: "stc-exit",
    templateName: EXIT.name,
    layoutFamily: "exit",
    variantKey: null,
    employeeName: "Jane Smith",
    employeeRole: null,
    locationId: "loc-0311",
    locationName: "NE Lincoln O Street",
    createdBy: "someone-else",
    formDate: "2026-09-28",
    status: "draft",
  };

  vi.doMock("@/lib/forms/instances", () => ({
    createInstance: async (input: Record<string, unknown>) => {
      calls.created.push(input);
      return { id: "inst-new", ...input };
    },
    loadInstance: async (id: string) =>
      id === "inst-exit"
        ? {
            instance,
            version: { version: 1, document: parseFormDocument(EXIT.document), variants: [] },
            values: [],
            events: [],
          }
        : id === "inst-coaching"
          ? {
              instance: coaching,
              version: { version: 1, document: parseFormDocument(COACHING.document), variants: [] },
              values: [],
              events: [],
            }
          : null,
    applyAssistantDraft: async () => {
      calls.drafted += 1;
      return { accepted: { values: {}, checked: {} }, rejected: [], policyRefused: [] };
    },
    listInstances: async () => [instance, coaching],
    markExported: async () => {},
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    deleteDemoInstances: async () => ({ deleted: 0 }),
    InstanceProtectedError: class extends Error {},
  }));

  return {
    instances: await import("./instances/route"),
    template: await import("./templates/[key]/route"),
    templates: await import("./templates/route"),
    preview: await import("./templates/[key]/preview/route"),
    draft: await import("./instances/[id]/draft/route"),
    instance: await import("./instances/[id]/route"),
    pdf: await import("./instances/[id]/pdf/route"),
  };
}

afterEach(() => {
  for (const name of [
    "@/lib/api/respond",
    "@/lib/auth/server",
    "@/lib/forms/repository",
    "@/lib/forms/instances",
  ]) {
    vi.doUnmock(name);
  }
  vi.resetModules();
});

const create = (templateKey: string) =>
  new Request("https://app.test/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateKey, employeeName: "Jane Smith", locationId: "loc-0311", source: "ask_sunny" }),
  });
const get = (url: string) => new Request(`https://app.test${url}`);
const params = (key: string) => ({ params: Promise.resolve({ key }) });

describe("an authorized role — Salon Director", () => {
  it("can create an exit form through the API", async () => {
    const routes = await load("salon_director");
    const response = await routes.instances.POST(create("stc-exit"));
    expect(response.status).toBe(200);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({
      templateKey: "stc-exit",
      employeeName: "Jane Smith",
      locationId: "loc-0311",
      locationName: "NE Lincoln O Street",
      source: "ask_sunny",
    });
  });

  it("still cannot open the template management routes, which are for template managers", async () => {
    const routes = await load("salon_director");
    expect((await routes.template.GET(get("/api/forms/templates/stc-exit"), params("stc-exit"))).status).toBe(403);
  });
});

describe.each(["assistant_salon_director", "employee"])("an unauthorized role — %s", (role) => {
  it("cannot create an exit form by its key", async () => {
    const routes = await load(role);
    const response = await routes.instances.POST(create("stc-exit"));
    expect(response.status).toBe(403);
    expect(calls.created).toEqual([]);
  });

  it.each(["exit form", "Resignation/Exit Form", "termination paperwork", "tpl-exit"])(
    "cannot create one by guessing another name for it: %s",
    async (guess) => {
      const routes = await load(role);
      const response = await routes.instances.POST(create(guess));
      // Unknown keys are a 404 before any permission is spent; the real key is a 403.
      expect([403, 404]).toContain(response.status);
      expect(calls.created).toEqual([]);
    },
  );

  it("cannot read the template, the library or its blank preview", async () => {
    const routes = await load(role);
    expect((await routes.template.GET(get("/api/forms/templates/stc-exit"), params("stc-exit"))).status).toBe(403);
    expect((await routes.templates.GET(get("/api/forms/templates"))).status).toBe(403);
    expect(
      (await routes.preview.GET(get("/api/forms/templates/stc-exit/preview"), params("stc-exit"))).status,
    ).toBe(403);
    // Authorization comes first, so nothing about the template was even read.
    expect(calls.repositoryReads).toBe(0);
  });

  it("cannot have Ask Sunny draft into an existing exit form", async () => {
    const routes = await load(role);
    const response = await routes.draft.POST(
      new Request("https://app.test/api/forms/instances/inst-exit/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "Jane Smith quit on the spot yesterday." }),
      }),
      { params: Promise.resolve({ id: "inst-exit" }) },
    );
    expect(response.status).toBe(403);
    expect(calls.drafted).toBe(0);
  });
});

describe("the builder page itself", () => {
  it("no longer exists — there is no URL to create a form outside Ask Sunny", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync("src/app/(app)/forms/create/page.tsx")).toBe(false);
  });
});

/* ================================================ filed exit forms == */

const at = (id: string) => ({ params: Promise.resolve({ id }) });
const read = (routes: Awaited<ReturnType<typeof load>>, id: string) =>
  routes.instance.GET(get(`/api/forms/instances/${id}`), at(id));
const pdf = (routes: Awaited<ReturnType<typeof load>>, id: string) =>
  routes.pdf.GET(get(`/api/forms/instances/${id}/pdf`), at(id));

describe("who may read a filed exit form", () => {
  it.each(["salon_director", "district_manager", "admin", "owner"])(
    "%s, at the form's salon, may view it and download its PDF",
    async (role) => {
      const scope: AccessScope =
        role === "salon_director" || role === "district_manager"
          ? SALON
          : ({ level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as never);
      const routes = await load(role, scope);
      expect((await read(routes, "inst-exit")).status, role).toBe(200);
      const file = await pdf(routes, "inst-exit");
      expect(file.status, role).toBe(200);
      expect(file.headers.get("content-type")).toBe("application/pdf");
    },
  );

  it("an ASD opening the instance URL gets the same 404 as a form that does not exist", async () => {
    const routes = await load("assistant_salon_director");
    const response = await read(routes, "inst-exit");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No such form." });
  });

  it("an ASD opening the PDF URL gets a 404, and no PDF", async () => {
    const routes = await load("assistant_salon_director");
    const response = await pdf(routes, "inst-exit");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toBe("application/pdf");
  });

  it("the ASD's ordinary Form Monitoring access is untouched for other forms", async () => {
    const routes = await load("assistant_salon_director");
    expect((await read(routes, "inst-coaching")).status).toBe(200);
  });

  it("an Employee is refused both URLs outright", async () => {
    const routes = await load("employee");
    expect((await read(routes, "inst-exit")).status).toBe(403);
    expect((await pdf(routes, "inst-exit")).status).toBe(403);
  });

  it.each(["salon_director", "assistant_salon_director", "employee"])(
    "a guessed instance id is a 404 for %s",
    async (role) => {
      const routes = await load(role);
      expect((await read(routes, "00000000-0000-0000-0000-000000000000")).status).toBe(404);
      expect((await pdf(routes, "inst-exi")).status).toBe(404);
    },
  );

  it("salon scoping still applies: a Salon Director at another salon gets a 404", async () => {
    const routes = await load("salon_director", {
      level: "salon",
      primaryAreaId: "loc-0309",
      alsoCoversAreaIds: [],
    });
    expect((await read(routes, "inst-exit")).status).toBe(404);
    expect((await pdf(routes, "inst-exit")).status).toBe(404);
  });

  it("the monitoring list drops exit forms for an ASD and keeps them for a Salon Director", async () => {
    const asd = await load("assistant_salon_director");
    const listed = (await (await asd.instances.GET(get("/api/forms/instances"))).json()) as {
      instances: { id: string }[];
    };
    expect(listed.instances.map((row) => row.id)).toEqual(["inst-coaching"]);

    const sd = await load("salon_director");
    const all = (await (await sd.instances.GET(get("/api/forms/instances"))).json()) as {
      instances: { id: string }[];
    };
    expect(all.instances.map((row) => row.id).sort()).toEqual(["inst-coaching", "inst-exit"]);
  });
});

describe("the server pages apply the same rule", () => {
  it("Form Monitoring, the Overview queue and the rail's badge all filter unreadable rows", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "src/app/(app)/forms/monitoring/page.tsx",
      "src/app/(app)/page.tsx",
      "src/app/(app)/layout.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/pageCan\("create_exit_form"\)/);
      expect(source, file).toMatch(/withoutUnreadable\(/);
    }
  });

  it("withoutUnreadable keeps exit rows only for a reader holding create_exit_form", async () => {
    const { withoutUnreadable } = await import("@/lib/forms/instance-scope");
    const rows = [{ layoutFamily: "exit" }, { layoutFamily: "coaching" }, { layoutFamily: "corrective" }];
    expect(withoutUnreadable(rows, () => false)).toEqual([{ layoutFamily: "coaching" }, { layoutFamily: "corrective" }]);
    expect(withoutUnreadable(rows, (permission) => permission === "create_exit_form")).toEqual(rows);
  });
});
