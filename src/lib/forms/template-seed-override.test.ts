import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * TEMPLATE_SEED_OVERRIDE (Pau, 5 Nov 2026). Production's Corrective Action
 * Form is version 7, published by an administrator (`seed_revision` 0, its
 * earlier seeded versions archived), so the sync held revision 8 — the Type of
 * Offense HR approved — back. The override names one key at one revision.
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

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => fakeSupabase(store),
}));

const { ensureTemplateLibrary } = await import("./repository");
const { TEMPLATE_SEEDS } = await import("./library");
const { DPOA_OFFENSE_REVISION } = await import("./payroll-amount-field");
const { seedOverrideAllows } = await import("./template-seed-override");
const { default: REVISION_7 } = await import("@/test/fixtures/forms/corrective-action-revision-7.json");

const caSeed = TEMPLATE_SEEDS.find((seed) => seed.key === "dpoa")!;

function templateRow(key: string) {
  return store.form_templates!.find((row) => row.key === key)!;
}
function versionsOf(key: string) {
  const id = templateRow(key).id;
  return store.form_template_versions.filter((row) => row.template_id === id);
}
function currentVersionOf(key: string) {
  const id = templateRow(key).id;
  const pointer = store.form_template_current!.find((row) => row.template_id === id);
  return store.form_template_versions.find((row) => row.id === pointer?.version_id);
}

/** As production stands: seeded versions archived, an administrator's version 7 current. */
function asProduction(key: string, document: unknown) {
  const template = templateRow(key);
  for (const row of versionsOf(key)) {
    row.seed_revision = Math.min(5, TEMPLATE_SEEDS.find((seed) => seed.key === key)!.revision - 1);
    row.status = "archived";
  }
  store.form_template_versions.push({
    id: `authored-${key}`,
    template_id: template.id,
    version: 7,
    status: "published",
    document,
    variants: [],
    seed_revision: 0,
    notes: "Published by an administrator.",
    created_by: "admin",
  });
  const pointer = store.form_template_current!.find((row) => row.template_id === template.id)!;
  pointer.version_id = `authored-${key}`;
}

let info: { mock: { calls: unknown[][] }; mockRestore: () => void };

beforeEach(async () => {
  store.form_templates = [];
  store.form_template_versions = [];
  store.form_template_current = [];
  store.form_template_assets = [];
  delete process.env.TEMPLATE_SEED_OVERRIDE;
  await ensureTemplateLibrary("system");
  asProduction("dpoa", REVISION_7);
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.TEMPLATE_SEED_OVERRIDE;
  info.mockRestore();
});

describe("TEMPLATE_SEED_OVERRIDE", () => {
  it("unset: revision 8 is held back under the administrator's version 7", async () => {
    const result = await ensureTemplateLibrary("system");
    expect(result.revised).toEqual([]);
    expect(result.heldBack.map((entry) => entry.key)).toEqual(["dpoa"]);
    expect(currentVersionOf("dpoa")?.id).toBe("authored-dpoa");
  });

  it("dpoa:8: revision 8 is published as the seed's document, version 7 archived as it was, and the log says so", async () => {
    process.env.TEMPLATE_SEED_OVERRIDE = `dpoa:${DPOA_OFFENSE_REVISION}`;
    const result = await ensureTemplateLibrary("system");

    expect(result.revised).toEqual(["dpoa"]);
    expect(result.heldBack).toEqual([]);
    const current = currentVersionOf("dpoa")!;
    expect(current).toMatchObject({ status: "published", seed_revision: DPOA_OFFENSE_REVISION, version: 8 });
    expect(current.document).toEqual(caSeed.document);
    const old = versionsOf("dpoa").find((row) => row.id === "authored-dpoa");
    expect(old).toMatchObject({ status: "archived", seed_revision: 0 });
    // Forms filed on version 7 keep the document they were signed on.
    expect(old?.document).toEqual(REVISION_7);

    const logged: string[] = info.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes("forms.template_sync.override") && line.includes('"key":"dpoa"'))).toBe(true);
  });

  it("idempotent: a second visit with the override still set publishes nothing", async () => {
    process.env.TEMPLATE_SEED_OVERRIDE = `dpoa:${DPOA_OFFENSE_REVISION}`;
    await ensureTemplateLibrary("system");
    const versions = versionsOf("dpoa").length;

    const again = await ensureTemplateLibrary("system");
    expect(again.revised).toEqual([]);
    expect(again.heldBack).toEqual([]);
    expect(again.existing).toContain("dpoa");
    expect(versionsOf("dpoa")).toHaveLength(versions);
  });

  it("only the named key at the named revision: another revision or another key stays held back", async () => {
    asProduction("coaching", { paper: "letter", blocks: [] });

    process.env.TEMPLATE_SEED_OVERRIDE = `dpoa:${DPOA_OFFENSE_REVISION - 1}`;
    let result = await ensureTemplateLibrary("system");
    expect(result.heldBack.map((entry) => entry.key).sort()).toEqual(["coaching", "dpoa"]);

    process.env.TEMPLATE_SEED_OVERRIDE = `dpoa:${DPOA_OFFENSE_REVISION}`;
    result = await ensureTemplateLibrary("system");
    expect(result.revised).toEqual(["dpoa"]);
    expect(result.heldBack.map((entry) => entry.key)).toEqual(["coaching"]);
    expect(currentVersionOf("coaching")?.id).toBe("authored-coaching");
  });

  it("an open draft still holds the publish back", async () => {
    store.form_template_versions.push({
      id: "draft-dpoa",
      template_id: templateRow("dpoa").id,
      version: 8,
      status: "draft",
      document: REVISION_7,
      variants: [],
      seed_revision: 0,
      notes: "A draft.",
      created_by: "admin",
    });
    process.env.TEMPLATE_SEED_OVERRIDE = `dpoa:${DPOA_OFFENSE_REVISION}`;
    const result = await ensureTemplateLibrary("system");
    expect(result.revised).toEqual([]);
    expect(result.heldBack[0]?.reason).toContain("draft");
  });
});

describe("seedOverrideAllows", () => {
  it("reads key:revision entries, exactly", () => {
    expect(seedOverrideAllows("dpoa", 8, { TEMPLATE_SEED_OVERRIDE: "dpoa:8" })).toBe(true);
    expect(seedOverrideAllows("dpoa", 8, { TEMPLATE_SEED_OVERRIDE: " coaching:3 , dpoa:8 " })).toBe(true);
    expect(seedOverrideAllows("dpoa", 8, { TEMPLATE_SEED_OVERRIDE: "dpoa:7" })).toBe(false);
    expect(seedOverrideAllows("dpoa", 8, { TEMPLATE_SEED_OVERRIDE: "dpoa" })).toBe(false);
    expect(seedOverrideAllows("dpoa", 8, { TEMPLATE_SEED_OVERRIDE: "dpoa:8x" })).toBe(false);
    expect(seedOverrideAllows("dpoa", 8, {})).toBe(false);
  });
});
