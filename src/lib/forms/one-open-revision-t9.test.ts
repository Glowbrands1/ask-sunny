import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDatabase } from "@/test/pglite-knowledge-db";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * T9 (QA, 25 Oct 2026): two presses of "Edit as new draft" at the same moment
 * opened two revision drafts of one finalized form. `reviseInstance` checks
 * for an open revision first, but both presses can pass that check before
 * either inserts.
 *
 * The fix is a partial unique index on `revises_instance_id` over open drafts
 * (supabase/migrations/20261025233000_form_instances_one_open_revision.sql),
 * and `reviseInstance` answering the refused insert with the revision the
 * other press opened.
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

/** Whether the fake refuses a second open draft of one form, as the index does. */
let indexApplied = false;

type Result = { data: unknown; error: unknown };

/**
 * The index, modelled where the fake inserts: the check and the insert run in
 * the same synchronous step, as the database does them in one statement.
 */
function withOneOpenRevision(client: ReturnType<typeof fakeSupabase>) {
  return {
    from(table: string) {
      const query = client.from(table);
      if (table !== "form_instances") return query;
      const insert = query.insert.bind(query);
      (query as { insert: unknown }).insert = (payload: Record<string, unknown>) => {
        const real = insert(payload as never);
        const refused = () =>
          indexApplied &&
          !Array.isArray(payload) &&
          payload.status === "draft" &&
          payload.revises_instance_id != null &&
          store.form_instances.some(
            (row) => row.status === "draft" && row.revises_instance_id === payload.revises_instance_id,
          );
        const chain = {
          select: () => chain,
          single: () => {
            real.single();
            return chain;
          },
          then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
            refused()
              ? Promise.resolve({
                  data: null,
                  error: {
                    code: "23505",
                    message: 'duplicate key value violates unique constraint "form_instances_one_open_revision"',
                  },
                }).then(resolve, reject)
              : real.then(resolve as never, reject),
        };
        return chain;
      };
      return query;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => withOneOpenRevision(fakeSupabase(store)),
}));

const { ensureTemplateLibrary } = await import("./repository");
const { createInstance, reviseInstance } = await import("./instances");

beforeEach(async () => {
  store.form_instances = [];
  store.form_instance_values = [];
  store.form_instance_events = [];
  store.form_template_versions = [];
  store.form_templates = [];
  store.form_template_current = [];
  store.form_template_assets = [];
  indexApplied = false;
  await ensureTemplateLibrary("system");
});

async function finalizedCoachingForm() {
  const instance = await createInstance({
    templateKey: "coaching",
    variantKey: null,
    employeeName: "Rowan Pell",
    employeeRole: "Tanning Consultant",
    locationId: "loc-1",
    locationName: "Test Salon",
    createdBy: "manager-a",
    source: "manual",
    formDate: "2026-10-20",
  });
  const row = store.form_instances.find((entry) => entry.id === instance.id)!;
  row.status = "finalized";
  row.finalized_at = "2026-10-20T12:00:00Z";
  return instance;
}

const openRevisionsOf = (id: string) =>
  store.form_instances.filter((row) => row.status === "draft" && row.revises_instance_id === id);

describe("two presses of Edit as new draft at once (T9)", () => {
  it("without the index, both presses open a draft (the race the index closes)", async () => {
    const original = await finalizedCoachingForm();
    await Promise.all([
      reviseInstance(original.id, "manager-a", "revised"),
      reviseInstance(original.id, "manager-a", "revised"),
    ]);
    expect(openRevisionsOf(original.id)).toHaveLength(2);
  });

  it("with the index, both presses get the same single revision", async () => {
    indexApplied = true;
    const original = await finalizedCoachingForm();
    const [first, second] = await Promise.all([
      reviseInstance(original.id, "manager-a", "revised"),
      reviseInstance(original.id, "manager-a", "revised"),
    ]);
    expect(openRevisionsOf(original.id)).toHaveLength(1);
    expect(first.id).toBe(second.id);
    expect(first.revisesInstanceId).toBe(original.id);
  });

  it("a press after the first still returns the open revision", async () => {
    indexApplied = true;
    const original = await finalizedCoachingForm();
    const first = await reviseInstance(original.id, "manager-a", "revised");
    const again = await reviseInstance(original.id, "manager-a", "revised");
    expect(again.id).toBe(first.id);
    expect(openRevisionsOf(original.id)).toHaveLength(1);
  });
});

describe("the one-open-revision index, in Postgres", () => {
  it("refuses a second open draft of one form, and nothing else", async () => {
    const harness = await createMigratedTestDatabase(
      ["20260904001000_forms_engine", "20261025233000_form_instances_one_open_revision"],
      {
        platform: `
          create extension if not exists pgcrypto with schema extensions;
          create function public.touch_updated_at() returns trigger language plpgsql as $$
          begin new.updated_at := now(); return new; end; $$;
        `,
      },
    );
    try {
      const { db } = harness;
      await db.exec(`
        insert into public.form_templates (id, key, name, short_name, layout_family, required_permission)
        values ('00000000-0000-4000-8000-000000000001', 'coaching', 'Coaching Form', 'Coaching',
          (select enum_range(null::public.form_layout_family))[1], 'create_coaching');
        insert into public.form_template_versions (id, template_id, version, document)
        values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 1, '{}'::jsonb);
        insert into public.form_instances (id, template_id, template_version_id, employee_name, created_by, status, finalized_at)
        values ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002', 'Rowan Pell', 'manager-a', 'finalized', now());
      `);
      const draft = (id: string, revises: string | null) => `
        insert into public.form_instances (id, template_id, template_version_id, employee_name, created_by, status, revises_instance_id)
        values ('${id}', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
          'Rowan Pell', 'manager-a', 'draft', ${revises ? `'${revises}'` : "null"});
      `;

      await db.exec(draft("00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000010"));
      await expect(
        db.exec(draft("00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000010")),
      ).rejects.toThrow(/form_instances_one_open_revision/);

      // Drafts that revise nothing are not covered.
      await db.exec(draft("00000000-0000-4000-8000-000000000013", null));
      await db.exec(draft("00000000-0000-4000-8000-000000000014", null));

      // Once the revision is finalized, the form can be revised again.
      await db.exec(`
        update public.form_instances set status = 'finalized', finalized_at = now()
        where id = '00000000-0000-4000-8000-000000000011';
      `);
      await db.exec(draft("00000000-0000-4000-8000-000000000015", "00000000-0000-4000-8000-000000000010"));

      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.form_instances
         where status = 'draft' and revises_instance_id = '00000000-0000-4000-8000-000000000010'`,
      );
      expect(rows[0]!.n).toBe(1);
    } finally {
      await harness.close();
    }
  }, 60_000);
});
