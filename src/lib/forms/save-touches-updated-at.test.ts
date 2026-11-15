import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

vi.setConfig({ testTimeout: 30_000 });

/*
 * FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED, widened in batch G2 (QA's live run part 2, C20): the manager's save
 * (saveInstanceValues, the PATCH behind the form page and every chat write that goes through it) moves the form's
 * updated_at when it writes any value. Off, the row is untouched as before. Runs the real instances.ts over the
 * in-memory database, as coaching-lifecycle.test.ts does. People are invented.
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
const { createInstance, saveInstanceValues } = await import("./instances");

const OLD = "2026-11-01T00:00:00.000Z";

beforeEach(async () => {
  for (const key of Object.keys(store)) store[key as keyof FakeStore] = [];
  await ensureTemplateLibrary("system");
});

async function staleForm() {
  const instance = await createInstance({
    templateKey: "coaching",
    variantKey: null,
    employeeName: "Jordan Vance",
    employeeRole: "Tanning Consultant",
    locationId: "loc-1",
    locationName: "MO Kansas City Wornall",
    createdBy: "dana",
    source: "manual",
    formDate: "2026-11-14",
  });
  const row = store.form_instances!.find((entry) => entry.id === instance.id)!;
  row.updated_at = OLD;
  return instance.id;
}
const updatedAt = (id: string) => store.form_instances!.find((entry) => entry.id === id)!.updated_at;

async function withFlag(value: string | undefined, run: () => Promise<void>) {
  const saved = process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED;
  if (value === undefined) delete process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED;
  else process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED = value;
  try {
    await run();
  } finally {
    if (saved === undefined) delete process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED;
    else process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED = saved;
  }
}

describe("FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED: the manager's save", () => {
  it("on: a manager PATCH that writes a value moves updated_at", async () => {
    await withFlag("true", async () => {
      const id = await staleForm();
      const { rejected } = await saveInstanceValues(id, { values: { coaching_details: "Walked the opening checklist together." } }, "dana");
      expect(rejected).toEqual([]);
      expect(updatedAt(id)).not.toBe(OLD);
    });
  });

  it("on: a save that writes only ticks moves it too", async () => {
    await withFlag("true", async () => {
      const id = await staleForm();
      await saveInstanceValues(id, { checked: { coaching_type: ["retraining"] } }, "dana");
      expect(updatedAt(id)).not.toBe(OLD);
    });
  });

  it("off: as before, the instance row is not touched", async () => {
    await withFlag("false", async () => {
      const id = await staleForm();
      await saveInstanceValues(id, { values: { coaching_details: "Walked the opening checklist together." } }, "dana");
      expect(updatedAt(id)).toBe(OLD);
    });
  });
});
