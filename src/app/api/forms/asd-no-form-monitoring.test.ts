import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/*
 * NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED. Requested for Ask Sunny only:
 * an Assistant Salon Director does not see Form Monitoring. With the flag on
 * the role loses `view_form_monitoring` but still opens (and downloads) a form
 * it created itself in chat. Off, every role is exactly as before.
 */

const FLAG = "NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED";
const ORIGINAL = { ...process.env };

const SALON_A: AccessScope = { level: "salon", primaryAreaId: "loc-a", alsoCoversAreaIds: [] };

const ASD_OWN = "11111111-1111-4111-8111-111111111111";
const SD_OWN = "22222222-2222-4222-8222-222222222222";

const ROWS: Record<string, { createdBy: string }> = {
  [ASD_OWN]: { createdBy: "asd-1" },
  // Same salon, someone else's: only the creator check can refuse it.
  [SD_OWN]: { createdBy: "sd-1" },
};

function instanceRow(id: string) {
  return {
    id,
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
    createdBy: ROWS[id]!.createdBy,
    createdByRole: "assistant_salon_director",
    source: "chat",
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

async function permissions(flag: string | undefined) {
  if (flag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flag;
  vi.resetModules();
  return import("@/lib/permissions");
}

async function load(options: { flag?: string; role?: string; subject?: string }) {
  const { flag, role = "assistant_salon_director", subject = "asd-1" } = options;
  if (flag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flag;
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: { subject, email: "a@example.com", displayName: "A", role, scope: SALON_A, verified: true },
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
    loadInstance: async (id: string) =>
      ROWS[id]
        ? {
            instance: instanceRow(id),
            version: { id: "ver-1", document: { paper: "letter", blocks: [] }, variants: [] },
            values: [],
            events: [],
          }
        : null,
    saveInstanceValues: async () => ({ rejected: [] }),
    InstanceProtectedError: class extends Error {},
    UnverifiedPolicyError: class extends Error {},
  }));

  const scope = await import("@/lib/forms/instance-scope");
  const detail = await import("./instances/[id]/route");
  return { scope, detail };
}

const request = () => new Request("https://app.test/api/forms/instances/x");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => vi.resetModules());
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) vi.doUnmock(mod);
  vi.resetModules();
});

describe("the permission matrix", () => {
  it("keeps Form Monitoring for an ASD with the flag off (today)", async () => {
    const { DEFAULT_PERMISSION_MATRIX } = await permissions(undefined);
    expect(DEFAULT_PERMISSION_MATRIX.assistant_salon_director).toContain("view_form_monitoring");
  });

  it("drops it for an ASD with the flag on", async () => {
    const { DEFAULT_PERMISSION_MATRIX } = await permissions("true");
    expect(DEFAULT_PERMISSION_MATRIX.assistant_salon_director).not.toContain("view_form_monitoring");
  });

  it("changes nothing else for an ASD, and nothing at all for any other role", async () => {
    const off = (await permissions(undefined)).DEFAULT_PERMISSION_MATRIX;
    const on = (await permissions("true")).DEFAULT_PERMISSION_MATRIX;
    expect(on.assistant_salon_director).toEqual(
      off.assistant_salon_director.filter((permission) => permission !== "view_form_monitoring"),
    );
    for (const role of Object.keys(off) as (keyof typeof off)[]) {
      if (role === "assistant_salon_director") continue;
      expect(on[role], role).toEqual(off[role]);
    }
    for (const role of ["salon_director", "district_manager", "regional_manager", "admin"] as const) {
      expect(on[role], role).toContain("view_form_monitoring");
    }
  });
});

describe("an ASD opens the coaching form it created in chat", () => {
  it("is served its own form (the GET the card and the PDF use) with the flag on", async () => {
    const { detail } = await load({ flag: "true" });
    const response = await detail.GET(request(), params(ASD_OWN));
    expect(response.status).toBe(200);
  });

  it("passes the same view check the PDF and history routes call", async () => {
    const { scope } = await load({ flag: "true" });
    const { actor } = await scope.authorizeInstance(request(), ASD_OWN, "view");
    expect(actor.id).toBe("asd-1");
  });

  it("cannot open someone else's form at the same salon: 404, as if missing", async () => {
    const { detail, scope } = await load({ flag: "true" });
    const response = await detail.GET(request(), params(SD_OWN));
    expect(response.status).toBe(404);
    await expect(scope.authorizeInstance(request(), SD_OWN, "view")).rejects.toBeInstanceOf(
      scope.InstanceNotVisibleError,
    );
  });

  it("with the flag off, still opens both as today", async () => {
    const { detail } = await load({});
    expect((await detail.GET(request(), params(ASD_OWN))).status).toBe(200);
    expect((await detail.GET(request(), params(SD_OWN))).status).toBe(200);
  });

  it("a Salon Director still opens every form at their salon with the flag on", async () => {
    const { detail } = await load({ flag: "true", role: "salon_director", subject: "sd-1" });
    expect((await detail.GET(request(), params(ASD_OWN))).status).toBe(200);
    expect((await detail.GET(request(), params(SD_OWN))).status).toBe(200);
  });

  it("the creator exemption is for viewing only, never editing", () => {
    const source = readFileSync("src/lib/forms/instance-scope.ts", "utf8");
    expect(source).toContain('if (action !== "view" || !asdNoFormMonitoringEnabled()) return authorizeForms(request, permission);');
  });
});

describe("no dead link or 403 widget for an ASD", () => {
  it("hides the sidebar entry (the sidebar draws only what the role can do)", async () => {
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await permissions("true");
    const { NAV_SECTIONS } = await import("@/components/shell/navigation");
    const visible = NAV_SECTIONS.flatMap((section) => section.items).filter(
      (item) => !item.permission || hasPermission(DEFAULT_PERMISSION_MATRIX, "assistant_salon_director", item.permission),
    );
    expect(visible.map((item) => item.href)).not.toContain("/forms/monitoring");
  });

  it("gates every Form Monitoring link it would otherwise meet on the flag and the permission", () => {
    const gate = '!asdNoFormMonitoringEnabled() || can("view_form_monitoring")';
    expect(readFileSync("src/features/dashboard/overview.tsx", "utf8")).toContain(gate);
    expect(readFileSync("src/features/chat/inline-form.tsx", "utf8")).toContain(gate);
    expect(readFileSync("src/components/shell/global-search.tsx", "utf8")).toContain("useHidesFormMonitoring()");
    expect(readFileSync("src/components/shell/hides-form-monitoring.ts", "utf8")).toContain(
      'asdNoFormMonitoringEnabled() && !can("view_form_monitoring")',
    );
    expect(readFileSync("src/app/(app)/page.tsx", "utf8")).toContain(
      'asdNoFormMonitoringEnabled() && !(await pageCan("view_form_monitoring"))',
    );
  });
});
