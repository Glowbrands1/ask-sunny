import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/*
 * NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED (ported from the sibling app;
 * Pau, 30 Oct 2026, of this app's Assistant Salon Director: "same pls"). Her
 * words there: "yes all forms but they can only see their own forms in the
 * form register or form monitoring", and of the Form Monitoring she had turned
 * off for them: "lift the block". One flag: the Assistant Salon Director
 * creates the Salon Director's forms, keeps Form Monitoring, and sees only the
 * forms they created. Invented ids and people only.
 */

const FLAG = "NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED";
const ORIGINAL = { ...process.env };

const SALON_A: AccessScope = { level: "salon", primaryAreaId: "loc-a", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

type Row = { id: string; createdBy: string | null; createdByRole: string; family?: string };
let rows: Row[] = [];
let created: unknown[] = [];

function instanceRow(row: Row) {
  return {
    id: row.id,
    templateId: "tpl-coaching",
    templateKey: row.family === "exit" ? "resignation-exit" : "coaching",
    templateName: row.family === "exit" ? "Resignation/Exit Form" : "Coaching Form",
    templateShortName: "coaching",
    layoutFamily: row.family ?? "coaching",
    templateVersionId: "ver-1",
    templateVersion: 1,
    variantKey: null,
    employeeName: "Synthetic Person",
    employeeRole: null,
    locationId: "loc-a",
    locationName: null,
    createdBy: row.createdBy,
    createdByRole: row.createdByRole,
    source: "manual",
    status: "draft",
    formDate: "2026-10-26",
    followUpDate: null,
    followedUpAt: null,
    followedUpBy: null,
    finalizedAt: null,
    exportedAt: null,
    archivedAt: null,
    revisesInstanceId: null,
    createdAt: "2026-10-26T12:00:00Z",
    updatedAt: "2026-10-26T12:00:00Z",
  };
}

/** Every viewer, with the location or estate their account covers. */
const VIEWERS = {
  "assistant salon director": { role: "assistant_salon_director", subject: "asd-1", scope: SALON_A },
  "salon director": { role: "salon_director", subject: "sd-1", scope: SALON_A },
  "district manager": { role: "district_manager", subject: "dm-1", scope: SALON_A },
  admin: { role: "admin", subject: "admin-1", scope: GLOBAL },
  employee: { role: "employee", subject: "emp-1", scope: SALON_A },
} as const;
type Viewer = keyof typeof VIEWERS;

/** The templates the tests create, with the permission each requires. */
const TEMPLATES: Record<string, { name: string; family: string; permission: string }> = {
  coaching: { name: "Coaching Form", family: "coaching", permission: "create_coaching_form" },
  dpoa: { name: "Corrective Action Form", family: "corrective", permission: "create_corrective_action" },
  "resignation-exit": { name: "Resignation/Exit Form", family: "exit", permission: "create_exit_form" },
  epp: { name: "Employee Performance Plan", family: "epp", permission: "create_epp" },
};

async function load(viewer: Viewer, env: { flag?: boolean; noRegister?: boolean } = {}) {
  const { role, subject, scope } = VIEWERS[viewer];
  delete process.env[FLAG];
  delete process.env.NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED;
  if (env.flag) process.env[FLAG] = "true";
  if (env.noRegister) process.env.NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED = "true";
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();
  const saved: string[] = [];

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: { subject, email: "a@example.com", displayName: "A", role, scope, verified: true },
          permission,
          provider: "supabase",
        };
      },
    };
  });
  vi.doMock("@/lib/forms/repository", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/forms/repository")>()),
    getTemplateByKey: async (key: string) => ({
      id: `tpl-${key}`,
      key,
      name: TEMPLATES[key]?.name ?? key,
      shortName: key,
      description: "",
      layoutFamily: TEMPLATES[key]?.family ?? key,
      requiredPermission: TEMPLATES[key]?.permission ?? "manage_form_templates",
      active: true,
      displayOrder: 1,
    }),
  }));
  vi.doMock("@/lib/forms/instances", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/forms/instances")>()),
    loadInstance: async (id: string) => {
      const row = rows.find((entry) => entry.id === id);
      return row
        ? {
            instance: instanceRow(row),
            version: { id: "ver-1", document: { paper: "letter", blocks: [] }, variants: [] },
            values: [],
            events: [],
          }
        : null;
    },
    // Honours the limit, newest (listed first) first, so a page can fill with private rows.
    listInstances: async (_view: string, limit?: number) => {
      return rows.slice(0, limit ?? 200).map(instanceRow);
    },
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    createInstance: async (input: unknown) => {
      created.push(input);
      return { ...instanceRow({ id: "33333333-3333-4333-8333-333333333333", createdBy: subject, createdByRole: role }) };
    },
    saveInstanceValues: async (id: string) => {
      saved.push(id);
      return { rejected: [] };
    },
    InstanceProtectedError: class extends Error {},
    UnverifiedPolicyError: class extends Error {},
  }));

  const detail = await import("./instances/[id]/route");
  const list = await import("./instances/route");
  return { detail, list, saved };
}

const req = (method: string, body?: unknown) =>
  new Request("https://app.test/api/forms/instances/x", {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function listed(viewer: Viewer, env: { flag?: boolean; noRegister?: boolean }): Promise<string[]> {
  const { list } = await load(viewer, env);
  const response = await list.GET(new Request("https://app.test/api/forms/instances"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { instances: { id: string }[] }).instances.map((entry) => entry.id);
}

async function create(viewer: Viewer, env: { flag?: boolean; noRegister?: boolean }, templateKey = "coaching") {
  const { list } = await load(viewer, env);
  return list.POST(
    new Request("https://app.test/api/forms/instances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateKey, employeeName: "Rowan Kestrel", locationId: "loc-a", source: "manual" }),
    }),
  );
}

/* One form at the Assistant Salon Director's store by each kind of creator, and two of their own. */
const BY = {
  admin: "a0000000-0000-4000-8000-000000000001",
  district_manager: "a0000000-0000-4000-8000-000000000002",
  salon_director: "a0000000-0000-4000-8000-000000000003",
  peer: "a0000000-0000-4000-8000-000000000004",
  own: "a0000000-0000-4000-8000-000000000005",
  ownExit: "a0000000-0000-4000-8000-000000000006",
} as const;
const OTHERS = [BY.admin, BY.district_manager, BY.salon_director, BY.peer];
const OWN = [BY.own, BY.ownExit];
const ALL = [...OTHERS, ...OWN];

beforeEach(() => {
  rows = [
    { id: BY.admin, createdBy: "admin-9", createdByRole: "admin" },
    { id: BY.district_manager, createdBy: "dm-9", createdByRole: "district_manager" },
    { id: BY.salon_director, createdBy: "sd-9", createdByRole: "salon_director" },
    { id: BY.peer, createdBy: "asd-9", createdByRole: "assistant_salon_director" },
    { id: BY.own, createdBy: "asd-1", createdByRole: "assistant_salon_director" },
    { id: BY.ownExit, createdBy: "asd-1", createdByRole: "assistant_salon_director", family: "exit" },
  ];
  created = [];
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) vi.doUnmock(mod);
  vi.resetModules();
});

describe("Pau: an Assistant Salon Director may create forms (flag on)", () => {
  it.each(["coaching", "dpoa", "resignation-exit"])("creates a %s form at their salon", async (key) => {
    expect((await create("assistant salon director", { flag: true }, key)).status).toBe(200);
    expect(created).toHaveLength(1);
  });

  it("off, as reported: refused", async () => {
    expect((await create("assistant salon director", {})).status).toBe(403);
    expect(created).toEqual([]);
  });

  it("a performance plan (EPP) is not in the set: still refused", async () => {
    expect((await create("assistant salon director", { flag: true }, "epp")).status).toBe(403);
  });

  it("a team member still cannot create forms", async () => {
    expect((await create("employee", { flag: true })).status).toBe(403);
  });

  it("the permission matrix: the salon director's create set and the register, nothing that manages", async () => {
    process.env[FLAG] = "true";
    process.env.NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED = "true";
    vi.resetModules();
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    for (const permission of [
      "create_coaching_form",
      "create_corrective_action",
      "create_policy_review",
      "create_hiring_form",
      "create_exit_form",
      "create_employment_change_form",
      "view_form_monitoring",
    ] as const) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "assistant_salon_director", permission), permission).toBe(true);
    }
    for (const permission of ["create_epp", "manage_form_records", "manage_form_templates", "manage_users"] as const) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "assistant_salon_director", permission), permission).toBe(false);
    }
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", "create_coaching_form")).toBe(false);
  });
});

describe("Pau: \"they can only see their own forms\" (flag on)", () => {
  it("the Form Monitoring lists only their own forms", async () => {
    expect((await listed("assistant salon director", { flag: true })).sort()).toEqual([...OWN].sort());
  });

  it.each(OTHERS)("GET by id of anyone else's form is a 404, as if it did not exist (%s)", async (id) => {
    const { detail } = await load("assistant salon director", { flag: true });
    expect((await detail.GET(req("GET"), params(id))).status).toBe(404);
  });

  it("their own coaching form opens and saves", async () => {
    const { detail, saved } = await load("assistant salon director", { flag: true });
    expect((await detail.GET(req("GET"), params(BY.own))).status).toBe(200);
    expect((await detail.PATCH(req("PATCH", { values: { coaching_details: "x" } }), params(BY.own))).status).toBe(200);
    expect(saved).toEqual([BY.own]);
  });

  it("their own exit form opens (the exit read rule is met: they may create exit forms)", async () => {
    const { detail } = await load("assistant salon director", { flag: true });
    expect((await detail.GET(req("GET"), params(BY.ownExit))).status).toBe(200);
  });

  it("someone else's form cannot be written to by id", async () => {
    const { detail, saved } = await load("assistant salon director", { flag: true });
    const response = await detail.PATCH(req("PATCH", { values: { coaching_details: "x" } }), params(BY.salon_director));
    expect(response.status).toBe(404);
    expect(saved).toEqual([]);
  });

  it("an older form with no creator recorded is not theirs: hidden from the list and 404 by id", async () => {
    const OLD = "a0000000-0000-4000-8000-000000000009";
    rows.push({ id: OLD, createdBy: null, createdByRole: "salon_director" });
    expect(await listed("assistant salon director", { flag: true })).not.toContain(OLD);
    const { detail } = await load("assistant salon director", { flag: true });
    expect((await detail.GET(req("GET"), params(OLD))).status).toBe(404);
  });

  it("judged by who created it, not the role stored with it: their own form from before a role change still opens", async () => {
    const MINE_AS_LM = "a0000000-0000-4000-8000-000000000010";
    const OTHER_AS_AM = "a0000000-0000-4000-8000-000000000011";
    rows.push(
      { id: MINE_AS_LM, createdBy: "asd-1", createdByRole: "salon_director" },
      { id: OTHER_AS_AM, createdBy: "asd-9", createdByRole: "assistant_salon_director" },
    );
    const ids = await listed("assistant salon director", { flag: true });
    expect(ids).toContain(MINE_AS_LM);
    expect(ids).not.toContain(OTHER_AS_AM);
    const { detail } = await load("assistant salon director", { flag: true });
    expect((await detail.GET(req("GET"), params(MINE_AS_LM))).status).toBe(200);
    expect((await detail.GET(req("GET"), params(OTHER_AS_AM))).status).toBe(404);
  });

  it.each(["salon director", "district manager", "admin"] as const)("%s still sees every form", async (viewer) => {
    expect((await listed(viewer, { flag: true })).sort()).toEqual([...ALL].sort());
  });
});

describe("Pau's block on the register (NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED on too)", () => {
  it("the register is back, own forms only", async () => {
    expect((await listed("assistant salon director", { flag: true, noRegister: true })).sort()).toEqual([...OWN].sort());
  });

  it("their own form opens; anyone else's does not", async () => {
    const { detail } = await load("assistant salon director", { flag: true, noRegister: true });
    expect((await detail.GET(req("GET"), params(BY.own))).status).toBe(200);
    expect((await detail.GET(req("GET"), params(BY.peer))).status).toBe(404);
    expect((await detail.GET(req("GET"), params(BY.admin))).status).toBe(404);
  });

  it("and they can create", async () => {
    expect((await create("assistant salon director", { flag: true, noRegister: true })).status).toBe(200);
  });

  it("flag off, as today: no register for them", async () => {
    const { list } = await load("assistant salon director", { noRegister: true });
    expect((await list.GET(new Request("https://app.test/api/forms/instances"))).status).toBe(403);
  });
});

describe("off: as today", () => {
  it("the Assistant Salon Director lists every form at their salon except the exit record", async () => {
    expect((await listed("assistant salon director", {})).sort()).toEqual([...OTHERS, BY.own].sort());
  });

  it("the flag reads off by default", async () => {
    delete process.env[FLAG];
    vi.resetModules();
    const { assistantManagerCreateEnabled } = await import("@/lib/permissions/assistant-manager-create");
    expect(assistantManagerCreateEnabled()).toBe(false);
  });
});

describe("every read path goes through the one check", () => {
  it("the own-forms rule sits in hiddenAsPrivate, which actorMaySeeInstance tests first", () => {
    const source = readFileSync("src/lib/forms/private-creators.ts", "utf8");
    expect(source).toMatch(/hiddenFromAssistantManager\(reader, instance\)/);
  });
});
