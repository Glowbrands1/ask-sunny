import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

import { TEMPLATE_SYNC_ENABLED_ENV, templateSyncDecision } from "./template-sync-policy";

/**
 * ============================================================================
 * A PREVIEW MAY NOT WRITE THE TEMPLATE LIBRARY INTO PRODUCTION'S DATABASE
 * ============================================================================
 *
 * Preview and Production read one Supabase database. Opening Forms → Form
 * Templates runs `ensureTemplateLibrary`, which installs and publishes the
 * library THIS BUILD ships — so on a Preview it would publish a PR's template
 * revision into Production before Production runs the code it needs. Found in
 * the PR #84 review (Corrective Action revision 5). See
 * `template-sync-policy.ts`.
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

const supabaseCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => {
    supabaseCalls.count += 1;
    return fakeSupabase(store);
  },
}));

// The route and the page, with identity settled: what is under test is the
// environment, not who may manage templates (that has its own tests).
vi.mock("@/lib/forms/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/access")>()),
  authorizeForms: async () => ({ id: "admin-1", role: "owner", name: "Admin" }),
}));
vi.mock("@/lib/auth/page", () => ({ requirePagePermission: async () => null }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  assertWithinRateLimit: () => {},
}));
vi.mock("@/features/forms/template-library", () => ({ TemplateLibrary: () => null }));
vi.mock("@/features/forms/forms-gate", () => ({ FormsAccessNotice: () => null }));

const { ensureTemplateLibrary, openDraft, publishDraft, getTemplateByKey, getCurrentVersion } =
  await import("./repository");
const { TEMPLATE_SEEDS } = await import("./library");
const templatesRoute = await import("@/app/api/forms/templates/route");
const { default: FormTemplatesPage } = await import("@/app/(app)/forms/templates/page");

function reset() {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  supabaseCalls.count = 0;
}

function snapshot() {
  return JSON.stringify({
    templates: store.form_templates,
    versions: store.form_template_versions,
    current: store.form_template_current,
    assets: store.form_template_assets,
  });
}

const PRODUCTION = { VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" };
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "production" };

const caSeed = TEMPLATE_SEEDS.find((seed) => seed.key === "dpoa")!;

/** The Corrective Action Form as revision 4 published it: two previous-action lines, no closing. */
function revision4Document() {
  const document = JSON.parse(JSON.stringify(caSeed.document)) as { blocks: Record<string, unknown>[] };
  document.blocks = document.blocks.flatMap((block) => {
    const field = block.field as Record<string, unknown> | undefined;
    if (field?.key === "prior_actions") {
      return [
        { kind: "field", field: { key: "previous_action", label: "Previous corrective action for this policy or issue", input: "text", responsibility: "ai" } },
        { kind: "field", field: { key: "previous_action_date", label: "Date of previous corrective action", input: "date", responsibility: "ai" } },
      ];
    }
    if (field?.key === "action_plan") {
      const rest = { ...field };
      delete rest.requiredClosing;
      return [{ ...block, field: rest }];
    }
    return [block];
  });
  return document;
}

/**
 * Production's library as it stands today: everything installed, and the
 * Corrective Action Form's current version at seed revision 4 — the state in
 * which a Preview of PR #84 would publish revision 5.
 */
async function productionLibraryAtRevision4() {
  await ensureTemplateLibrary("system", PRODUCTION);
  const template = store.form_templates!.find((row) => row.key === "dpoa")!;
  const current = store.form_template_current!.find((row) => row.template_id === template.id)!;
  const version = store.form_template_versions.find((row) => row.id === current.version_id)!;
  version.seed_revision = 4;
  version.document = revision4Document();
  supabaseCalls.count = 0;
  return { templateId: String(template.id), versionId: String(version.id) };
}

beforeEach(() => {
  reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* -------------------------------------------------------------- policy --- */

describe("the decision, from VERCEL_ENV", () => {
  it.each([
    [{ VERCEL: "1", VERCEL_ENV: "production" }, true, "production"],
    [{ VERCEL_ENV: "production" }, true, "production"],
    [{ VERCEL_ENV: " Production " }, true, "production"],
    [{ VERCEL: "1", NEXT_PUBLIC_VERCEL_ENV: "production" }, true, "production"],
    [{ VERCEL: "1", VERCEL_ENV: "preview" }, false, "preview"],
    [{ VERCEL: "1", VERCEL_ENV: "development" }, false, "development"],
    // On Vercel but with no readable environment: fails closed.
    [{ VERCEL: "1" }, false, "unknown"],
    // The test runner, off Vercel.
    [{ NODE_ENV: "test" }, true, "test"],
    // A local `next dev` / `next start`, off Vercel, without the opt-in.
    [{ NODE_ENV: "development" }, false, "local"],
    [{ NODE_ENV: "production" }, false, "local"],
    [{}, false, "local"],
  ])("%j -> allowed: %s", (env, allowed, environment) => {
    const decision = templateSyncDecision(env);
    expect(decision.allowed).toBe(allowed);
    expect(decision.environment).toBe(environment);
  });

  it("lets a local build opt in, on purpose", () => {
    expect(templateSyncDecision({ NODE_ENV: "development", [TEMPLATE_SYNC_ENABLED_ENV]: "true" }).allowed).toBe(true);
  });

  it("never lets the opt-in, or a test runner, open a Vercel Preview", () => {
    for (const extra of [{ [TEMPLATE_SYNC_ENABLED_ENV]: "true" }, { NODE_ENV: "test" }]) {
      expect(templateSyncDecision({ ...PREVIEW, ...extra }).allowed).toBe(false);
      expect(templateSyncDecision({ VERCEL: "1", VERCEL_ENV: "development", ...extra }).allowed).toBe(false);
    }
  });

  it("says why, in words an administrator can act on", () => {
    const decision = templateSyncDecision(PREVIEW);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toMatch(/Preview/);
      expect(decision.reason).toMatch(/share one database/);
      expect(decision.reason).toMatch(/Nothing was installed, published or renamed/);
    }
  });
});

/* ----------------------------------------------------------- the library --- */

describe("ensureTemplateLibrary on Production", () => {
  it("still installs the library", async () => {
    const result = await ensureTemplateLibrary("system", PRODUCTION);
    expect(result.skipped).toBeUndefined();
    expect(result.created.sort()).toEqual(TEMPLATE_SEEDS.map((seed) => seed.key).sort());
  });

  it("still publishes a newer seed revision — Corrective Action revision 5 over 4", async () => {
    const { templateId, versionId } = await productionLibraryAtRevision4();

    const result = await ensureTemplateLibrary("system", PRODUCTION);

    expect(result.revised).toEqual(["dpoa"]);
    const current = await getCurrentVersion(templateId);
    expect(current?.seedRevision).toBe(caSeed.revision);
    expect(current?.id).not.toBe(versionId);
    // The old version is archived, not replaced.
    expect(store.form_template_versions.find((row) => row.id === versionId)?.status).toBe("archived");
  });
});

describe("ensureTemplateLibrary on a Preview", () => {
  it("reads and writes nothing at all", async () => {
    const result = await ensureTemplateLibrary("system", PREVIEW);
    expect(result).toEqual({
      created: [],
      existing: [],
      revised: [],
      renamed: [],
      heldBack: [],
      skipped: { environment: "preview", reason: expect.stringMatching(/Preview/) },
    });
    expect(supabaseCalls.count).toBe(0);
    expect(store.form_templates).toEqual([]);
  });

  it("does not publish Corrective Action revision 5 over Production's revision 4", async () => {
    const { templateId, versionId } = await productionLibraryAtRevision4();
    const before = snapshot();

    const result = await ensureTemplateLibrary("system", PREVIEW);

    expect(result.revised).toEqual([]);
    expect(result.skipped?.environment).toBe("preview");
    expect(snapshot()).toBe(before);
    expect((await getCurrentVersion(templateId))?.id).toBe(versionId);
  });

  it("reads the deployment's own environment when none is passed", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    const result = await ensureTemplateLibrary();
    expect(result.skipped?.environment).toBe("preview");
    expect(supabaseCalls.count).toBe(0);
  });
});

/* ------------------------------------------------- every way of reaching it --- */

describe("POST /api/forms/templates", () => {
  const post = () =>
    templatesRoute.POST(new Request("https://app.test/api/forms/templates", { method: "POST" }));

  it("is refused on a Preview, with a 409 that says why, and writes nothing", async () => {
    await productionLibraryAtRevision4();
    const before = snapshot();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");

    const response = await post();

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; environment: string; error: string };
    expect(body.code).toBe("template_sync_disabled");
    expect(body.environment).toBe("preview");
    expect(body.error).toMatch(/share one database/);
    expect(snapshot()).toBe(before);
  });

  it("still syncs on Production", async () => {
    await productionLibraryAtRevision4();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");

    const response = await post();

    expect(response.status).toBe(200);
    expect(((await response.json()) as { revised: string[] }).revised).toEqual(["dpoa"]);
  });
});

/** Every text node of a rendered server component's element tree. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  return [props.title, props.children].map(textOf).join(" ");
}

describe("opening Forms → Form Templates", () => {
  it("on a Preview, shows the library without installing or publishing anything, and says so", async () => {
    await productionLibraryAtRevision4();
    const before = snapshot();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");

    const page = await FormTemplatesPage();

    expect(snapshot()).toBe(before);
    expect(textOf(page)).toMatch(/Template sync is off on this deployment/);
  });

  it("on Production, still publishes the newer revision on the visit, with no notice", async () => {
    const { templateId } = await productionLibraryAtRevision4();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");

    const page = await FormTemplatesPage();

    expect((await getCurrentVersion(templateId))?.seedRevision).toBe(caSeed.revision);
    expect(textOf(page)).not.toMatch(/Template sync is off/);
  });
});

describe("nothing else can publish the code's library", () => {
  /** Every non-test source file under `src`. */
  function sources(dir = "src"): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.startsWith(join("src", "test")) ? [path] : [];
    });
  }

  it("calls ensureTemplateLibrary only from the page and the POST route, both covered above", () => {
    const callers = sources()
      .filter((path) => /\bensureTemplateLibrary\s*\(/.test(readFileSync(path, "utf8")))
      .sort();
    expect(callers).toEqual(
      [
        join("src", "app", "(app)", "forms", "templates", "page.tsx"),
        join("src", "app", "api", "forms", "templates", "route.ts"),
        join("src", "lib", "forms", "repository.ts"),
      ].sort(),
    );
  });

  it("checks the guard first, before the database is touched", () => {
    const source = readFileSync(join("src", "lib", "forms", "repository.ts"), "utf8");
    const body = source.slice(source.indexOf("export async function ensureTemplateLibrary("));
    expect(body.indexOf("templateSyncDecision(env)")).toBeGreaterThan(-1);
    expect(body.indexOf("templateSyncDecision(env)")).toBeLessThan(body.indexOf("getSupabaseAdmin()"));
  });

  it("writes a seed revision only from inside ensureTemplateLibrary, whose helper is not exported", () => {
    const writers = sources().filter((path) => /seed_revision:\s*seed\.revision/.test(readFileSync(path, "utf8")));
    expect(writers).toEqual([join("src", "lib", "forms", "repository.ts")]);
    const source = readFileSync(writers[0]!, "utf8");
    expect(source).toMatch(/\nasync function publishSeedRevision\(/);
    expect(source).not.toMatch(/export\s+async\s+function\s+publishSeedRevision/);
  });
});

/* -------------------------------------------- what is deliberately unchanged --- */

describe("a person's own template work, which this does not govern", () => {
  it("still opens and publishes an authored draft on a Preview", async () => {
    const { templateId } = await productionLibraryAtRevision4();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");

    const template = await getTemplateByKey("dpoa");
    const { draft } = await openDraft(template!.id, "admin-1");
    const published = await publishDraft(draft.id, "admin-1");

    expect(published.status).toBe("published");
    expect(published.seedRevision).toBe(0);
    expect((await getCurrentVersion(templateId))?.id).toBe(draft.id);
  });
});
