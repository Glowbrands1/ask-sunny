import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/*
 * PRIVATE_CREATOR_FORMS_ENABLED + PRIVATE_FORM_CREATOR_IDS (requested 26 Oct
 * 2026, both apps): forms created by the listed accounts are seen only by
 * their creator and by admin/owner/developer. Invented ids and roles only.
 */

const FLAG = "PRIVATE_CREATOR_FORMS_ENABLED";
const IDS = "PRIVATE_FORM_CREATOR_IDS";
const ORIGINAL = { ...process.env };

const SALON_A: AccessScope = { level: "salon", primaryAreaId: "loc-a", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const CREATOR = "creator-1";
const PRIVATE = "11111111-1111-4111-8111-111111111111";
const PUBLIC = "22222222-2222-4222-8222-222222222222";

let rows: { id: string; createdBy: string }[] = [];

function instanceRow(row: { id: string; createdBy: string }) {
  return {
    id: row.id,
    templateId: "tpl-coaching",
    templateKey: "coaching",
    templateName: "Coaching Form",
    templateShortName: "coaching",
    layoutFamily: "coaching",
    templateVersionId: "ver-1",
    templateVersion: 1,
    variantKey: null,
    employeeName: "Synthetic Person",
    employeeRole: null,
    locationId: "loc-a",
    locationName: null,
    createdBy: row.createdBy,
    createdByRole: "district_manager",
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

/** Every viewer, with the salon or estate their account covers. */
const VIEWERS = {
  creator: { role: "district_manager", subject: CREATOR, scope: SALON_A },
  "another district manager": { role: "district_manager", subject: "dm-2", scope: SALON_A },
  "regional manager": { role: "regional_manager", subject: "rm-1", scope: SALON_A },
  "salon director": { role: "salon_director", subject: "sd-1", scope: SALON_A },
  "assistant salon director": { role: "assistant_salon_director", subject: "asd-1", scope: SALON_A },
  admin: { role: "admin", subject: "admin-1", scope: GLOBAL },
  owner: { role: "owner", subject: "owner-1", scope: GLOBAL },
  developer: { role: "developer", subject: "dev-1", scope: GLOBAL },
} as const;
type Viewer = keyof typeof VIEWERS;
const SEES_PRIVATE: Viewer[] = ["creator", "admin", "owner", "developer"];

async function load(viewer: Viewer, env: { flag?: boolean; ids?: string } = {}) {
  const { role, subject, scope } = VIEWERS[viewer];
  delete process.env[FLAG];
  delete process.env[IDS];
  if (env.flag) process.env[FLAG] = "true";
  if (env.ids !== undefined) process.env[IDS] = env.ids;
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
  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async () => ({
      id: "tpl-coaching",
      key: "coaching",
      name: "Coaching Form",
      shortName: "Coaching",
      description: "",
      layoutFamily: "coaching",
      requiredPermission: "create_coaching_form",
      active: true,
      displayOrder: 1,
    }),
  }));
  vi.doMock("@/lib/forms/instances", () => ({
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
    listInstances: async (_view: string, limit = 200) => rows.slice(0, limit).map(instanceRow),
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
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

async function listed(viewer: Viewer, env: { flag?: boolean; ids?: string }): Promise<string[]> {
  const { list } = await load(viewer, env);
  const response = await list.GET(new Request("https://app.test/api/forms/instances"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { instances: { id: string }[] }).instances.map((entry) => entry.id);
}

beforeEach(() => {
  rows = [
    { id: PRIVATE, createdBy: CREATOR },
    { id: PUBLIC, createdBy: "sd-1" },
  ];
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) vi.doUnmock(mod);
  vi.resetModules();
});

const ON = { flag: true, ids: ` ${CREATOR} , someone-else ` };

describe("flag on, creator listed: each viewer", () => {
  it.each(Object.keys(VIEWERS) as Viewer[])("%s", async (viewer) => {
    const sees = SEES_PRIVATE.includes(viewer);
    expect(await listed(viewer, ON)).toEqual(sees ? [PRIVATE, PUBLIC] : [PUBLIC]);

    const { detail } = await load(viewer, ON);
    expect((await detail.GET(req("GET"), params(PRIVATE))).status).toBe(sees ? 200 : 404);
    expect((await detail.GET(req("GET"), params(PUBLIC))).status).toBe(200);
  });
});

describe("writes by id", () => {
  it("another district manager cannot save the private form: 404, nothing stored", async () => {
    const { detail, saved } = await load("another district manager", ON);
    const response = await detail.PATCH(req("PATCH", { values: { coaching_details: "x" } }), params(PRIVATE));
    expect(response.status).toBe(404);
    expect(saved).toEqual([]);
  });

  it("the creator still saves it", async () => {
    const { detail, saved } = await load("creator", ON);
    const response = await detail.PATCH(req("PATCH", { values: { coaching_details: "x" } }), params(PRIVATE));
    expect(response.status).toBe(200);
    expect(saved).toEqual([PRIVATE]);
  });
});

describe("off, or nobody listed: as today", () => {
  it.each(Object.keys(VIEWERS) as Viewer[])("%s sees both with the flag off", async (viewer) => {
    expect(await listed(viewer, { ids: CREATOR })).toEqual([PRIVATE, PUBLIC]);
  });

  it.each(Object.keys(VIEWERS) as Viewer[])("%s sees both with the flag on and an empty list", async (viewer) => {
    expect(await listed(viewer, { flag: true, ids: " , " })).toEqual([PRIVATE, PUBLIC]);
  });

  it("the flag reads off by default", async () => {
    delete process.env[FLAG];
    const { privateCreatorFormsEnabled } = await import("@/lib/forms/private-creators");
    expect(privateCreatorFormsEnabled()).toBe(false);
  });
});

describe("a page of private rows does not hide visible ones", () => {
  it("over-reads, so the public row behind 250 private ones is still listed", async () => {
    rows = [
      ...Array.from({ length: 250 }, (_, index) => ({ id: `p-${index}`, createdBy: CREATOR })),
      { id: PUBLIC, createdBy: "sd-1" },
    ];
    expect(await listed("salon director", ON)).toEqual([PUBLIC]);
  });

  it("trims back to the page of 200 for the creator", async () => {
    rows = Array.from({ length: 250 }, (_, index) => ({ id: `p-${index}`, createdBy: CREATOR }));
    expect(await listed("creator", ON)).toHaveLength(200);
  });
});

describe("every read path goes through the one check", () => {
  it("actorMaySeeInstance tests privacy before any other rule", () => {
    const source = readFileSync("src/lib/forms/instance-scope.ts", "utf8");
    const body = source.slice(source.indexOf("export function actorMaySeeInstance"));
    expect(body.indexOf("hiddenAsPrivate(actor, instance)")).toBeGreaterThan(-1);
    expect(body.indexOf("hiddenAsPrivate(actor, instance)")).toBeLessThan(body.indexOf("visibility.level"));
  });

  it.each([
    "src/lib/forms/prior-forms.ts",
    "src/lib/forms/chat-form-records.ts",
    "src/lib/forms/chat-reopen.ts",
    "src/app/api/forms/instances/route.ts",
    "src/app/(app)/forms/monitoring/page.tsx",
    "src/app/(app)/layout.tsx",
    "src/app/(app)/page.tsx",
  ])("%s over-reads and re-checks every bounded list", (path) => {
    const source = readFileSync(path, "utf8");
    const reads = source.match(/await (?:listInstances|listOutstandingFollowUps)\(/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect((source.match(/privateAwareLimit\(/g) ?? []).length).toBeGreaterThanOrEqual(reads.length);
    expect(source).toMatch(/visibleInstances|actorMaySeeInstance|mayRead/);
  });
});
