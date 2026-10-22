import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * THE TEMPLATE SYNC IS OBSERVABLE: ITS RESULT AND ITS FAILURES
 * ============================================================================
 *
 * Ported from Ask Bubbles, where production's template sync did not run and
 * nothing on the server could say why: a failure was caught by the Form
 * Templates page and shown on screen only. Ask Sunny's sync had the same shape.
 * These tests pin the behaviour that makes the next run legible:
 *
 *   that a run publishes the expected revisions and a second publishes
 *   nothing more;
 *   that one template failing is reported accurately and does not stop the
 *   rest, with the failure logged as one redacted structured line;
 *   that the administrator is shown what happened;
 *   that a publish interrupted between its steps is reported as a failure
 *   and finished by the next run.
 *
 * The fake database never returns an error by itself, so faults are injected
 * by wrapping the client below.
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
const faults = vi.hoisted(() => ({
  /** Template keys whose NEW (version > 1) row insert fails, with the message. */
  failVersionInsertFor: new Map<string, string>(),
  /** Template keys whose pointer move onto a version > 1 fails (the version row is already stored). */
  failPointerFor: new Map<string, string>(),
  /** Template keys whose archiving of a published version fails. */
  failArchiveFor: new Map<string, string>(),
  /** When set, reading the template list fails with this message. */
  failLibraryRead: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => {
    supabaseCalls.count += 1;
    const base = fakeSupabase(store);
    return {
      ...base,
      from(table: string) {
        const query = base.from(table) as unknown as Record<string, unknown> & {
          insert: (payload: Record<string, unknown>) => unknown;
          select: (...args: unknown[]) => unknown;
        };
        if (table === "form_template_versions") {
          const insert = query.insert.bind(query);
          query.insert = (payload: Record<string, unknown>) => {
            const template = store.form_templates!.find((row) => row.id === payload.template_id);
            const message = template ? faults.failVersionInsertFor.get(String(template.key)) : undefined;
            if (message !== undefined && Number(payload.version) > 1) {
              return { select: () => ({ single: async () => ({ data: null, error: { message } }) }) };
            }
            return insert(payload);
          };
        }
        if (table === "form_template_current") {
          const upsert = (query as unknown as { upsert: (...args: unknown[]) => unknown }).upsert.bind(query);
          (query as unknown as { upsert: (...args: unknown[]) => unknown }).upsert = (...args: unknown[]) => {
            const payload = args[0] as { template_id: unknown; version_id: unknown };
            const template = store.form_templates!.find((row) => row.id === payload.template_id);
            const target = store.form_template_versions.find((row) => row.id === payload.version_id);
            const message = template ? faults.failPointerFor.get(String(template.key)) : undefined;
            if (message !== undefined && Number(target?.version) > 1) {
              return { then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { message } }) };
            }
            return upsert(...args);
          };
        }
        if (table === "form_template_versions") {
          const update = (query as unknown as { update: (...args: unknown[]) => unknown }).update.bind(query);
          (query as unknown as { update: (...args: unknown[]) => unknown }).update = (...args: unknown[]) => {
            const patch = args[0] as { status?: string };
            if (patch.status !== "archived") return update(...args);
            return {
              eq: (_column: string, id: unknown) => {
                const version = store.form_template_versions.find((row) => row.id === id);
                const template = store.form_templates!.find((row) => row.id === version?.template_id);
                const message = template ? faults.failArchiveFor.get(String(template.key)) : undefined;
                if (message !== undefined) {
                  return { then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { message } }) };
                }
                return (update(...args) as { eq: (c: string, v: unknown) => unknown }).eq("id", id);
              },
            };
          };
        }
        if (table === "form_templates" && faults.failLibraryRead !== null) {
          const message = faults.failLibraryRead;
          const select = query.select.bind(query);
          query.select = (...args: unknown[]) => {
            // Only the sync's own read (no filters yet) is replaced.
            if (args[0] === "id, key, name, short_name, description") {
              return { then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { message } }) };
            }
            return select(...args);
          };
        }
        return query;
      },
    };
  },
}));

// Identity is settled: who may manage templates has its own tests.
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

const { ensureTemplateLibrary } = await import("./repository");
const { TEMPLATE_SEEDS } = await import("./library");
const templatesRoute = await import("@/app/api/forms/templates/route");
const { default: FormTemplatesPage } = await import("@/app/(app)/forms/templates/page");
const { TemplateSyncReport } = await import("@/features/forms/template-sync-report");

const PRODUCTION = { VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" };
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "production" };

/** Three templates this database holds an older revision of. */
const REISSUED = TEMPLATE_SEEDS.slice(0, 3).map((seed) => seed.key);
/** The one whose publish is made to fail. */
const FAULTY = REISSUED[0]!;

const versionsOf = (key: string) => {
  const template = store.form_templates!.find((row) => row.key === key)!;
  return store.form_template_versions.filter((row) => row.template_id === template.id);
};

/** Production with the library installed, and REISSUED one revision behind with a different document. */
async function productionBehindTheCode() {
  await ensureTemplateLibrary("system", PRODUCTION);
  for (const key of REISSUED) {
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === key)!;
    for (const row of versionsOf(key)) {
      row.seed_revision = seed.revision - 1;
      row.document = { ...seed.document, blocks: seed.document.blocks.slice(0, -1) };
    }
  }
  supabaseCalls.count = 0;
}

const snapshot = () =>
  JSON.stringify({
    templates: store.form_templates,
    versions: store.form_template_versions,
    current: store.form_template_current,
    assets: store.form_template_assets,
  });

const post = () =>
  templatesRoute.POST(new Request("https://app.test/api/forms/templates", { method: "POST" }));

let errorLog: ReturnType<typeof vi.spyOn>;
let infoLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  supabaseCalls.count = 0;
  faults.failVersionInsertFor.clear();
  faults.failPointerFor.clear();
  faults.failArchiveFor.clear();
  faults.failLibraryRead = null;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Every text node of a rendered element tree, descending into props.children and props.title. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  return [props.title, props.children].map(textOf).join(" ");
}

function findElements(node: unknown, type: unknown, out: { props: Record<string, unknown> }[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((child) => findElements(child, type, out));
    return out;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) out.push(element as { props: Record<string, unknown> });
  if (element.props) findElements(element.props.children, type, out);
  return out;
}

const loggedEvents = () =>
  [...errorLog.mock.calls, ...infoLog.mock.calls]
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const onProduction = () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
};

/* -------------------------------------------------------------- a full run --- */

describe("a run on Production", () => {
  it("publishes a new version of exactly the templates that are behind", async () => {
    await productionBehindTheCode();

    const result = await ensureTemplateLibrary("admin-1", PRODUCTION);

    expect([...result.revised].sort()).toEqual([...REISSUED].sort());
    expect(result.failed).toEqual([]);
    for (const key of REISSUED) {
      expect(versionsOf(key).map((row) => `${row.version}:${row.status}`).sort(), key).toEqual([
        "1:archived",
        "2:published",
      ]);
    }
  });

  it("does not create duplicate versions on a second run", async () => {
    await productionBehindTheCode();
    await ensureTemplateLibrary("system", PRODUCTION);
    const afterFirst = snapshot();

    const second = await ensureTemplateLibrary("system", PRODUCTION);

    expect(second).toMatchObject({ created: [], revised: [], renamed: [], heldBack: [], failed: [] });
    expect(snapshot()).toBe(afterFirst);
  });

  it("on a Preview reads and writes nothing, and reports an empty failed list", async () => {
    await productionBehindTheCode();
    const before = snapshot();

    const result = await ensureTemplateLibrary("system", PREVIEW);

    expect(result.skipped).toBeDefined();
    expect(result.failed).toEqual([]);
    expect(supabaseCalls.count).toBe(0);
    expect(snapshot()).toBe(before);
  });
});

/* --------------------------------------------------------- partial failures --- */

describe("a partial failure", () => {
  it("is reported accurately, does not stop the other templates, and is logged once, redacted", async () => {
    await productionBehindTheCode();
    faults.failVersionInsertFor.set(
      FAULTY,
      "duplicate key value violates unique constraint; token sb_secret_ABCDEF0123456789abcdef and Bearer abcdefghijklmnop.",
    );

    const result = await ensureTemplateLibrary("system", PRODUCTION);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.key).toBe(FAULTY);
    expect(result.failed[0]!.reason).toContain("duplicate key value");
    expect(result.failed[0]!.reason).not.toMatch(/sb_secret_|Bearer abcdefghijklmnop/);
    expect([...result.revised].sort()).toEqual(REISSUED.filter((key) => key !== FAULTY).sort());

    // The failed template is exactly as it was: version 1, still published.
    expect(versionsOf(FAULTY).map((row) => `${row.version}:${row.status}`)).toEqual(["1:published"]);

    const events = loggedEvents();
    const failures = events.filter((event) => event.event === "forms.template_sync.failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ level: "error", key: FAULTY, step: "install_or_revise" });
    const summary = events.find((event) => event.event === "forms.template_sync.completed")!;
    expect(summary).toMatchObject({ level: "error", failed: [FAULTY] });
    expect((summary.revised as string[]).length).toBe(REISSUED.length - 1);
    // Nothing secret reached any log line.
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/sb_secret_|Bearer abcdefghijklmnop/);
  });

  it("heals on the next run: only the template that failed is published, nothing is duplicated", async () => {
    await productionBehindTheCode();
    faults.failVersionInsertFor.set(FAULTY, "temporary outage");
    await ensureTemplateLibrary("system", PRODUCTION);
    faults.failVersionInsertFor.clear();

    const retry = await ensureTemplateLibrary("system", PRODUCTION);

    expect(retry.revised).toEqual([FAULTY]);
    expect(retry.failed).toEqual([]);
    for (const key of REISSUED) expect(versionsOf(key), key).toHaveLength(2);
  });

  it("is a 207 from the POST route, with the failure in the body", async () => {
    await productionBehindTheCode();
    faults.failVersionInsertFor.set(FAULTY, "temporary outage");
    onProduction();

    const response = await post();

    expect(response.status).toBe(207);
    const body = (await response.json()) as { revised: string[]; failed: { key: string }[] };
    expect(body.failed.map((entry) => entry.key)).toEqual([FAULTY]);
    expect(body.revised).toHaveLength(REISSUED.length - 1);
  });

  it("is a 200 from the POST route when nothing failed", async () => {
    await productionBehindTheCode();
    onProduction();

    const response = await post();

    expect(response.status).toBe(200);
  });

  it("logs nothing for a run that changed nothing", async () => {
    await ensureTemplateLibrary("system", PRODUCTION);
    errorLog.mockClear();
    infoLog.mockClear();

    await ensureTemplateLibrary("system", PRODUCTION);

    expect(errorLog).not.toHaveBeenCalled();
    expect(infoLog).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------ what the admin sees --- */

describe("what the administrator sees on Forms → Form Templates", () => {
  it("shows what a run revised and failed", async () => {
    await productionBehindTheCode();
    faults.failVersionInsertFor.set(FAULTY, "temporary outage");
    onProduction();

    const page = await FormTemplatesPage();

    const [report] = findElements(page, TemplateSyncReport);
    expect(report).toBeDefined();
    const text = textOf(TemplateSyncReport(report!.props as never));
    expect(text).toMatch(/Template library sync/);
    expect(text).toMatch(new RegExp(`${REISSUED.length - 1} revised`));
    expect(text).toMatch(/1 failed/);
    expect(text).toMatch(new RegExp(`${FAULTY}.*temporary outage`));
  });

  it("says when a template is held back, and why", () => {
    const text = textOf(
      TemplateSyncReport({
        result: {
          created: [],
          existing: ["coaching"],
          revised: [],
          renamed: [],
          heldBack: [{ key: "dpoa", reason: "A draft (version 2) is open." }],
          failed: [],
        },
      }),
    );
    expect(text).toMatch(/1 held back/);
    expect(text).toMatch(/dpoa\s+held back:\s+A draft \(version 2\) is open/);
  });

  it("says nothing for a run a Preview skipped (its own notice covers that)", () => {
    expect(
      TemplateSyncReport({
        result: { created: [], existing: [], revised: [], renamed: [], heldBack: [], failed: [], skipped: { environment: "preview", reason: "off" } },
      }),
    ).toBeNull();
  });

  it("shows, redacts and logs a failure to read the library at all", async () => {
    faults.failLibraryRead = "connection refused sb_secret_ABCDEF0123456789abcdef";
    onProduction();

    const page = await FormTemplatesPage();

    const text = textOf(page);
    expect(text).toMatch(/The template library could not be read/);
    expect(text).toMatch(/connection refused/);
    expect(text).not.toMatch(/sb_secret_/);
    const logged = loggedEvents().find((event) => event.event === "forms.template_sync.page_failed");
    expect(logged).toMatchObject({ level: "error" });
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/sb_secret_/);
  });
});

/* ------------------------------------- an interrupted publish can always finish --- */

/**
 * The publish is three writes, not a transaction: insert the new version, point
 * `form_template_current` at it, archive the old one. A failure between them
 * must neither be reported as success, nor strand the template, nor let a retry
 * duplicate a version, lose the current one or override an administrator.
 */
describe("a publish interrupted between its steps", () => {
  /** An installed template this database is NOT behind on. */
  const UNTOUCHED = TEMPLATE_SEEDS.find((seed) => !REISSUED.includes(seed.key))!.key;

  const currentOf = (key: string) => {
    const template = store.form_templates!.find((row) => row.key === key)!;
    const pointer = store.form_template_current!.find((row) => row.template_id === template.id)!;
    return store.form_template_versions.find((row) => row.id === pointer.version_id)!;
  };
  const statuses = (key: string) =>
    versionsOf(key)
      .map((row) => `${row.version}:${row.status}`)
      .sort();

  it("stored but not made current: reported as failed, the old version stays current, and a retry completes it", async () => {
    await productionBehindTheCode();
    faults.failPointerFor.set(FAULTY, "pointer write refused");

    const first = await ensureTemplateLibrary("system", PRODUCTION);

    expect(first.failed.map((entry) => entry.key)).toEqual([FAULTY]);
    expect(first.failed[0]!.reason).toMatch(/stored but could not be made current/);
    expect(first.failed[0]!.reason).toMatch(/previous version is still current/);
    expect(first.revised).not.toContain(FAULTY);
    // Forms are still filled from version 1; the stored version 2 is waiting beside it.
    expect(currentOf(FAULTY).version).toBe(1);
    expect(statuses(FAULTY)).toEqual(["1:published", "2:published"]);

    faults.failPointerFor.clear();
    const retry = await ensureTemplateLibrary("system", PRODUCTION);

    expect(retry.failed).toEqual([]);
    expect(retry.revised).toEqual([FAULTY]);
    expect(retry.repaired).toEqual([FAULTY]);
    expect(currentOf(FAULTY).version).toBe(2);
    // No duplicate was created, and the old version is archived, not deleted.
    expect(statuses(FAULTY)).toEqual(["1:archived", "2:published"]);

    const again = await ensureTemplateLibrary("system", PRODUCTION);
    expect(again).toMatchObject({ revised: [], failed: [] });
    expect(again.repaired).toBeUndefined();
    expect(statuses(FAULTY)).toEqual(["1:archived", "2:published"]);
  });

  it("current but the old version not archived: reported as failed (not a success), the new version stays current, a retry archives the leftover", async () => {
    await productionBehindTheCode();
    faults.failArchiveFor.set(FAULTY, "archive refused");

    const first = await ensureTemplateLibrary("system", PRODUCTION);

    expect(first.failed.map((entry) => entry.key)).toEqual([FAULTY]);
    expect(first.failed[0]!.reason).toMatch(/is published and current, but the previous version could not be archived/);
    expect(first.revised).not.toContain(FAULTY);
    expect(currentOf(FAULTY).version).toBe(2);
    expect(statuses(FAULTY)).toEqual(["1:published", "2:published"]);

    faults.failArchiveFor.clear();
    const retry = await ensureTemplateLibrary("system", PRODUCTION);

    expect(retry.failed).toEqual([]);
    expect(retry.repaired).toEqual([FAULTY]);
    // Nothing new is published, and the current version is not lost or moved.
    expect(retry.revised).not.toContain(FAULTY);
    expect(currentOf(FAULTY).version).toBe(2);
    expect(statuses(FAULTY)).toEqual(["1:archived", "2:published"]);
  });

  it("a retry that fails again leaves the same state and reports it again", async () => {
    await productionBehindTheCode();
    faults.failPointerFor.set(FAULTY, "still refused");
    await ensureTemplateLibrary("system", PRODUCTION);
    const stuck = snapshot();

    const second = await ensureTemplateLibrary("system", PRODUCTION);

    expect(second.failed.map((entry) => entry.key)).toEqual([FAULTY]);
    expect(second.failed[0]!.reason).toMatch(/could not be made current/);
    expect(snapshot()).toBe(stuck);
  });

  it("an installed template whose version was stored but never pointed at is completed, without a second version", async () => {
    await productionBehindTheCode();
    const template = store.form_templates!.find((row) => row.key === UNTOUCHED)!;
    store.form_template_current = store.form_template_current!.filter((row) => row.template_id !== template.id);

    const result = await ensureTemplateLibrary("system", PRODUCTION);

    expect(result.failed).toEqual([]);
    expect(result.repaired).toEqual([UNTOUCHED]);
    expect(versionsOf(UNTOUCHED)).toHaveLength(1);
    expect(currentOf(UNTOUCHED).version).toBe(1);
  });

  it("does not override an administrator: after an interruption, an authored current version is left as it is", async () => {
    await productionBehindTheCode();
    faults.failPointerFor.set(FAULTY, "pointer write refused");
    await ensureTemplateLibrary("system", PRODUCTION);
    faults.failPointerFor.clear();
    // An administrator publishes their own version 3 in the meantime: it becomes current and archives version 1.
    const template = store.form_templates!.find((row) => row.key === FAULTY)!;
    store.form_template_versions.push({
      id: "authored-v3",
      template_id: template.id,
      version: 3,
      status: "published",
      document: { paper: "letter", blocks: [] },
      variants: [],
      seed_revision: 0,
      notes: "Authored here.",
      created_by: "dana",
      published_by: "dana",
    });
    store.form_template_current!.find((row) => row.template_id === template.id)!.version_id = "authored-v3";
    versionsOf(FAULTY).find((row) => row.version === 1)!.status = "archived";

    const retry = await ensureTemplateLibrary("system", PRODUCTION);

    expect(retry.failed).toEqual([]);
    expect(retry.repaired).toBeUndefined();
    expect(currentOf(FAULTY).id).toBe("authored-v3");
    // The stored seed version is left exactly as it was.
    expect(versionsOf(FAULTY).find((row) => row.version === 2)?.status).toBe("published");
  });

  it("does not move the current version under an open draft", async () => {
    await productionBehindTheCode();
    faults.failPointerFor.set(FAULTY, "pointer write refused");
    await ensureTemplateLibrary("system", PRODUCTION);
    faults.failPointerFor.clear();
    const template = store.form_templates!.find((row) => row.key === FAULTY)!;
    store.form_template_versions.push({
      id: "draft-v3",
      template_id: template.id,
      version: 3,
      status: "draft",
      document: { paper: "letter", blocks: [] },
      variants: [],
      seed_revision: 1,
      notes: "A draft.",
      created_by: "dana",
    });

    const retry = await ensureTemplateLibrary("system", PRODUCTION);

    expect(retry.repaired).toBeUndefined();
    expect(currentOf(FAULTY).version).toBe(1);
    expect(versionsOf(FAULTY).find((row) => row.id === "draft-v3")?.status).toBe("draft");
  });

  it("leaves a form already filed on the old version pinned to it, with its document unchanged", async () => {
    await productionBehindTheCode();
    const template = store.form_templates!.find((row) => row.key === FAULTY)!;
    const v1 = versionsOf(FAULTY)[0]!;
    const documentBefore = JSON.stringify(v1.document);
    store.form_instances.push({ id: "filed-1", template_id: template.id, template_version_id: v1.id, status: "finalized" });
    faults.failPointerFor.set(FAULTY, "pointer write refused");
    await ensureTemplateLibrary("system", PRODUCTION);
    faults.failPointerFor.clear();

    await ensureTemplateLibrary("system", PRODUCTION);

    expect(store.form_instances.find((row) => row.id === "filed-1")?.template_version_id).toBe(v1.id);
    expect(JSON.stringify(store.form_template_versions.find((row) => row.id === v1.id)!.document)).toBe(documentBefore);
    expect(store.form_template_versions.find((row) => row.id === v1.id)?.status).toBe("archived");
  });

  it("is not repaired from a Preview: nothing is read or written", async () => {
    await productionBehindTheCode();
    faults.failPointerFor.set(FAULTY, "pointer write refused");
    await ensureTemplateLibrary("system", PRODUCTION);
    faults.failPointerFor.clear();
    const stuck = snapshot();
    supabaseCalls.count = 0;

    const result = await ensureTemplateLibrary("system", PREVIEW);

    expect(result.skipped).toBeDefined();
    expect(supabaseCalls.count).toBe(0);
    expect(snapshot()).toBe(stuck);
  });

  it("is shown to the administrator, and logged", async () => {
    await productionBehindTheCode();
    faults.failPointerFor.set(FAULTY, "pointer write refused");
    await ensureTemplateLibrary("system", PRODUCTION);
    faults.failPointerFor.clear();
    errorLog.mockClear();
    infoLog.mockClear();

    const retry = await ensureTemplateLibrary("system", PRODUCTION);

    expect(loggedEvents().find((event) => event.event === "forms.template_sync.completed")).toMatchObject({
      repaired: [FAULTY],
    });
    expect(textOf(TemplateSyncReport({ result: retry }))).toMatch(
      new RegExp(`Completed after an earlier run was interrupted:\\s+${FAULTY}`),
    );
  });
});
