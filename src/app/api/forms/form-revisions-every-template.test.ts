import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * EVERY TEMPLATE: FINALIZE, EDIT WITH A REASON, EDIT, FINALIZE AGAIN
 * ============================================================================
 *
 * `FORM_REVISIONS_ENABLED` on. Every template the library seeds, hidden or
 * not, goes through the same lifecycle through the real routes: a manual form
 * is finalized, edited as a revision with a reason, a field the manager may
 * write is changed on the revision, and the revision is finalized. The
 * original keeps every value it was finalized with and is marked `revised`;
 * the revision's `created` event carries the reason and the number 1.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return { ...actual, assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} };
});

vi.mock("@/lib/auth/server", () => ({
  authorizeRequest: async (_request: Request, permission: string) => ({
    identity: {
      subject: "admin-1",
      email: "admin@example.com",
      displayName: "Admin",
      role: "admin",
      scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
      verified: true,
    },
    permission,
    provider: "supabase",
  }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { TEMPLATE_SEEDS, defaultVariantKey } = await import("@/lib/forms/library");
const { fieldsForVariant, parseFormDocument } = await import("@/lib/forms/document");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");

function joinedOnRead(): FakeStore["form_instances"] {
  return new Proxy([] as FakeStore["form_instances"], {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property === "string" && /^\d+$/.test(property) && value) {
        const row = value as Record<string, unknown>;
        const template = store.form_templates!.find((entry) => entry.id === row.template_id);
        const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
        Object.assign(row, {
          form_date: row.form_date ?? "2026-10-20",
          template_key: template?.key,
          template_name: template?.name,
          template_short_name: template?.short_name,
          layout_family: template?.layout_family,
          template_version: version?.version,
        });
      }
      return value;
    },
  });
}

async function send(method: "POST" | "PATCH" | "GET", url: string, body?: unknown) {
  const request = new Request(`https://app.test${url}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const id = /^\/api\/forms\/instances\/([^/]+)$/.exec(url)?.[1];
  const context = { params: Promise.resolve({ id: id ?? "" }) };
  const response =
    url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : method === "POST"
        ? await instanceRoute.POST(request, context)
        : method === "PATCH"
          ? await instanceRoute.PATCH(request, context)
          : await instanceRoute.GET(request, context);
  const payload = (await response.json()) as Record<string, unknown> & { error?: string };
  expect(response.status, `${method} ${url}: ${payload.error}`).toBe(200);
  return payload;
}

beforeAll(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = joinedOnRead();
  process.env.FORM_REVISIONS_ENABLED = "true";
  await ensureTemplateLibrary("system");
});

afterAll(() => {
  delete process.env.FORM_REVISIONS_ENABLED;
});

describe("finalize, revise with a reason, edit and finalize, for every template", () => {
  it("covers the whole seeded library", () => {
    expect(TEMPLATE_SEEDS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(TEMPLATE_SEEDS.map((seed) => seed.key))("%s", async (templateKey) => {
    const created = (await send("POST", "/api/forms/instances", {
      templateKey,
      variantKey: defaultVariantKey(templateKey),
      employeeName: "Rowan Kestrel",
      locationId: "loc-0310",
      source: "manual",
    })) as { instance: { id: string } };
    const original = created.instance.id;

    const loaded = (await send("GET", `/api/forms/instances/${original}`)) as {
      instance: { variantKey: string | null };
      version: { document: unknown };
    };
    const field = fieldsForVariant(parseFormDocument(loaded.version.document), loaded.instance.variantKey).find(
      (entry) => (entry.input === "text" || entry.input === "long_text") && (entry.responsibility === "manager" || entry.responsibility === "ai"),
    );
    expect(field, `${templateKey} has a field a manager may write`).toBeTruthy();
    await send("PATCH", `/api/forms/instances/${original}`, { values: { [field!.key]: "As finalized." }, checked: {} });
    await send("POST", `/api/forms/instances/${original}`, { action: "finalize", acknowledgeUnverifiedPolicy: true });

    const reason = `Correcting the ${field!.label} line.`;
    const revision = ((await send("POST", `/api/forms/instances/${original}`, { action: "revise", reason })) as { instance: { id: string } })
      .instance.id;
    expect(revision).not.toBe(original);
    const created_ = store.form_instance_events.find((event) => event.instance_id === revision && event.kind === "created");
    expect(created_?.detail).toMatchObject({ revisionOf: original, reason, revisionNumber: 1 });

    await send("PATCH", `/api/forms/instances/${revision}`, { values: { [field!.key]: "As corrected." }, checked: {} });
    await send("POST", `/api/forms/instances/${revision}`, { action: "finalize", acknowledgeUnverifiedPolicy: true });

    const valueOf = (id: string) =>
      store.form_instance_values.find((row) => row.instance_id === id && row.field_key === field!.key)?.value;
    expect(valueOf(original)).toBe("As finalized.");
    expect(valueOf(revision)).toBe("As corrected.");
    expect(store.form_instances.find((row) => row.id === original)?.status).toBe("revised");
    expect(store.form_instances.find((row) => row.id === revision)?.status).toBe("finalized");
  });
});
