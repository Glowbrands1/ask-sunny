import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDatabase, type KnowledgeTestDatabase } from "@/test/pglite-knowledge-db";

/**
 * Board f066 (QA, Pau approved 20 Nov 2026): four Test Testy drafts were deleted between 17 and 20 Nov and nothing
 * recorded who deleted them or when (`form_instance_events` goes with the form; `activity_events` has no delete
 * entry). Every delete of a form now leaves a permanent, append-only record
 * (`supabase/migrations/20261120001000_form_instance_deletions.sql`).
 *
 * On a real Postgres (PGlite) with the repository's own forms migrations, through the real DELETE route.
 */

let harness: KnowledgeTestDatabase;

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => harness.client }));
/* The route's authorization, as a District Manager with manage_form_records; the delete path below it is real. */
vi.mock("@/lib/forms/instance-scope", async (original) => ({
  ...(await original<typeof import("@/lib/forms/instance-scope")>()),
  authorizeInstance: async () => ({ actor: { id: "dm-quill-harrow", role: "district_manager", verified: true, scope: null, visibility: null }, loaded: null }),
}));

const TEMPLATE = "00000000-0000-4000-8000-000000000001";
const VERSION = "00000000-0000-4000-8000-000000000002";
const DRAFT = "28e76a95-0000-4000-8000-000000000001";

beforeAll(async () => {
  harness = await createMigratedTestDatabase(
    [
      "20260904001000_forms_engine",
      "20260904003000_forms_instance_archive",
      "20260904004000_forms_follow_up_tracking",
      "20261025233000_form_instances_one_open_revision",
      "20261120001000_form_instance_deletions",
    ],
    {
      platform: `
        create extension if not exists pgcrypto with schema extensions;
        create function public.touch_updated_at() returns trigger language plpgsql as $$
        begin new.updated_at := now(); return new; end; $$;
      `,
    },
  );
  await harness.db.exec(`
    insert into public.form_templates (id, key, name, short_name, layout_family, required_permission)
    values ('${TEMPLATE}', 'dpoa', 'Corrective Action Form', 'CA',
      (select enum_range(null::public.form_layout_family))[1], 'create_corrective_action');
    insert into public.form_template_versions (id, template_id, version, document)
    values ('${VERSION}', '${TEMPLATE}', 1, '{}'::jsonb);
  `);
}, 60_000);

afterAll(async () => harness?.close());

beforeEach(async () => {
  await harness.db.exec(`
    insert into public.form_instances (id, template_id, template_version_id, employee_name, location_id, location_name, created_by, status, form_date)
    values ('${DRAFT}', '${TEMPLATE}', '${VERSION}', 'Test Testy', 'loc-0309', 'NE Kearney', 'manager-a', 'draft', '2026-11-17')
    on conflict do nothing;
    insert into public.form_instance_values (instance_id, field_key, value, filled_by)
    select '${DRAFT}', 'observation', 'Test Testy was late to her shift.', 'ai'
    where not exists (select 1 from public.form_instance_values where instance_id = '${DRAFT}');
  `);
});

type Deletion = { instance_id: string; template_name: string; employee_name: string; form_date: string; status: string; location_name: string; deleted_by: string | null; deleted_by_role: string | null; deleted_via: string; deleted_at: string; snapshot: { instance: Record<string, unknown>; values: { field_key: string; value: string }[] } };

const recordsOf = async (id: string) =>
  (await harness.db.query<Deletion>(`select * from public.form_instance_deletions where instance_id = $1 order by deleted_at`, [id])).rows;

describe("a deleted form leaves a permanent record (f066)", () => {
  it("a delete through the Form Monitoring route records who, their role, how, when and what the form held", async () => {
    const { DELETE } = await import("@/app/api/forms/instances/[id]/route");
    const response = await DELETE(new Request(`http://localhost/api/forms/instances/${DRAFT}`, { method: "DELETE" }), { params: Promise.resolve({ id: DRAFT }) });
    expect(response.status).toBe(200);

    expect((await harness.db.query(`select 1 from public.form_instances where id = $1`, [DRAFT])).rows).toHaveLength(0);
    const [record, ...more] = await recordsOf(DRAFT);
    expect(more).toHaveLength(0);
    expect(record).toMatchObject({
      template_name: "Corrective Action Form",
      employee_name: "Test Testy",
      status: "draft",
      location_name: "NE Kearney",
      deleted_by: "dm-quill-harrow",
      deleted_by_role: "district_manager",
      deleted_via: "route",
    });
    expect(String(record!.form_date)).toMatch(/2026-11-17|Nov 17 2026/);
    expect(record!.deleted_at).toBeTruthy();
    expect(record!.snapshot.instance.employee_name).toBe("Test Testy");
    expect(record!.snapshot.values).toEqual([expect.objectContaining({ field_key: "observation", value: "Test Testy was late to her shift." })]);
  });

  it("a delete the app did not make (direct SQL) is still recorded, as 'other' with no app user", async () => {
    await harness.db.exec(`delete from public.form_instances where id = '${DRAFT}'`);
    const latest = (await recordsOf(DRAFT)).at(-1)!;
    expect(latest).toMatchObject({ deleted_via: "other", deleted_by: null, deleted_by_role: null, employee_name: "Test Testy" });
  });

  it("a stamp older than ten minutes (an earlier delete that failed) is not taken as who deleted it", async () => {
    await harness.db.exec(`
      update public.form_instances set deletion_requested_by = 'someone-else', deletion_requested_role = 'salon_director',
        deletion_requested_via = 'chat', deletion_requested_at = now() - interval '1 hour' where id = '${DRAFT}';
      delete from public.form_instances where id = '${DRAFT}';
    `);
    expect((await recordsOf(DRAFT)).at(-1)).toMatchObject({ deleted_via: "other", deleted_by: null });
  });

  it("the record cannot be changed or removed, by anyone", async () => {
    await harness.db.exec(`delete from public.form_instances where id = '${DRAFT}'`);
    await expect(harness.db.exec(`update public.form_instance_deletions set deleted_by = 'nobody' where instance_id = '${DRAFT}'`)).rejects.toThrow(/append-only/);
    await expect(harness.db.exec(`delete from public.form_instance_deletions where instance_id = '${DRAFT}'`)).rejects.toThrow(/append-only/);
    expect((await recordsOf(DRAFT)).length).toBeGreaterThan(0);
  });

  it("anon and authenticated cannot read it", async () => {
    await expect(harness.asAuthenticated(`select * from public.form_instance_deletions`)).rejects.toThrow(/permission denied/);
  });
});
