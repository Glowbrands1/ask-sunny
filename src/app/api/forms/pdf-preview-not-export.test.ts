import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

/**
 * A PREVIEW IS NOT AN EXPORT (Pau, 26 Nov 2026, of the employee search's View link: "i just need a preview pop up
 * please not another tabv"). The pop-up reads the real PDF route with `?preview=1`: the same document, served inline,
 * and nothing recorded. Download PDF (no `preview`) still records the export, as before. Invented people only.
 */

const ORIGINAL = { ...process.env };
const WORNALL: AccessScope = { level: "salon", primaryAreaId: "loc-wornall", alsoCoversAreaIds: [] };
const CREATOR = "sd-marigold";

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
} as FakeStore;
const extra = store as unknown as Record<string, Record<string, unknown>[]>;

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
vi.mock("@/lib/auth/server", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "salon_director" as never, permission as never)) throw new AuthError("forbidden", "No.");
      return {
        identity: { subject: CREATOR, email: "marigold@example.com", displayName: "Marigold", role: "salon_director", scope: WORNALL, verified: true },
        permission,
        provider: "supabase",
      };
    },
  };
});
vi.mock("@/lib/forms/forms-visibility", () => ({ resolveFormsVisibility: async () => WORNALL }));

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInstance, saveInstanceValues } = await import("@/lib/forms/instances");
const pdfRoute = await import("./instances/[id]/pdf/route");

beforeEach(async () => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  for (const key of Object.keys(store)) (store as unknown as Record<string, unknown[]>)[key] = [];
  extra.app_users = [{ id: CREATOR, email: "marigold@example.com", display_name: "Marigold", status: "active" }];
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

async function aForm() {
  const instance = await createInstance({
    templateKey: "policy-review",
    variantKey: null,
    employeeName: "Juniper Ashdown",
    employeeRole: "Tanning Consultant",
    locationId: "loc-wornall",
    locationName: "KC Wornall",
    createdBy: CREATOR,
    source: "manual",
    formDate: "2026-11-23",
  });
  await saveInstanceValues(instance.id, { values: {}, checked: {} }, CREATOR);
  return instance.id;
}

function get(id: string, query = "") {
  return pdfRoute.GET(new Request(`http://localhost/api/forms/instances/${id}/pdf${query}`), { params: Promise.resolve({ id }) });
}

const exportedAt = (id: string) => (store.form_instances as unknown as { id: string; exported_at: string | null }[]).find((row) => row.id === id)?.exported_at ?? null;
const exportEvents = (id: string) =>
  (store.form_instance_events as unknown as { instance_id: string; kind: string }[]).filter((row) => row.instance_id === id && row.kind === "exported");

describe("the View pop-up's PDF", () => {
  it("?preview=1 serves the form inline and records no export", async () => {
    const id = await aForm();
    const response = await get(id, "?preview=1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(exportedAt(id)).toBeNull();
    expect(exportEvents(id)).toEqual([]);
  });

  it("Download PDF (no preview) is still an attachment and still records the export", async () => {
    const id = await aForm();
    const response = await get(id);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(exportedAt(id)).not.toBeNull();
    expect(exportEvents(id)).toHaveLength(1);
  });
});
