import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase, type KnowledgeTestDatabase } from "@/test/pglite-knowledge-db";

/**
 * ============================================================================
 * THE DATABASE STILL REFUSES AN IN-PLACE EDIT OF A FINALIZED FORM
 * ============================================================================
 *
 * FORM_REVISIONS_ENABLED adds a reason and a revision number to the revision
 * flow; it adds no migration and changes no trigger. This runs the
 * repository's own forms migrations on PGlite and proves the guard
 * `forms_guard_finalized_values` still refuses every value write on a
 * finalized or revised form, while the revision beside it is written freely,
 * and that a `created` event carries the reason and the number as plain jsonb.
 */

const FORMS_MIGRATIONS = [
  // `touch_updated_at()`, which the forms triggers reuse, is defined here.
  "20260829000100_extensions",
  "20260829000200_knowledge_schema",
  "20260904001000_forms_engine",
  "20260904002000_forms_guard_execute_revoke",
  "20260904003000_forms_instance_archive",
  "20260904003100_forms_event_kind_archive",
  "20260904004000_forms_follow_up_tracking",
  "20260904004100_forms_event_kind_follow_up",
] as const;

let harness: KnowledgeTestDatabase;
let original: string;
let revision: string;

const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await harness.db.query<T>(sql, params)).rows[0]!;

async function refused(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await harness.db.query(sql, params);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

beforeAll(async () => {
  harness = await createMigratedTestDatabase(FORMS_MIGRATIONS);
  const template = await one<{ id: string }>(
    `insert into public.form_templates (key, name, short_name, layout_family, required_permission)
     values ('dpoa', 'Corrective Action Form', 'Corrective Action', 'corrective', 'create_corrective_action') returning id`,
  );
  const version = await one<{ id: string }>(
    `insert into public.form_template_versions (template_id, version, status, document, published_at, published_by)
     values ($1, 1, 'published', '{"blocks": []}'::jsonb, now(), 'system') returning id`,
    [template.id],
  );
  original = (
    await one<{ id: string }>(
      `insert into public.form_instances (template_id, template_version_id, employee_name, created_by)
       values ($1, $2, 'Marisol Quenby', 'manager-1') returning id`,
      [template.id, version.id],
    )
  ).id;
  await harness.db.query(
    `insert into public.form_instance_values (instance_id, field_key, value) values ($1, 'observation', 'As finalized.')`,
    [original],
  );
  await harness.db.query(`update public.form_instances set status = 'finalized', finalized_at = now() where id = $1`, [original]);

  revision = (
    await one<{ id: string }>(
      `insert into public.form_instances (template_id, template_version_id, employee_name, created_by, revises_instance_id)
       values ($1, $2, 'Marisol Quenby', 'manager-1', $3) returning id`,
      [template.id, version.id, original],
    )
  ).id;
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

describe("forms_guard_finalized_values with revisions in use", () => {
  it("refuses an update, an insert and a delete on the finalized original", async () => {
    expect(await refused(`update public.form_instance_values set value = 'Changed.' where instance_id = $1`, [original])).toContain(
      "This form is finalized",
    );
    expect(
      await refused(`insert into public.form_instance_values (instance_id, field_key, value) values ($1, 'action_plan', 'New.')`, [original]),
    ).toContain("This form is finalized");
    expect(await refused(`delete from public.form_instance_values where instance_id = $1`, [original])).toContain(
      "This form is finalized",
    );
  });

  it("writes the revision freely, and records the reason and number on its created event", async () => {
    await harness.db.query(
      `insert into public.form_instance_values (instance_id, field_key, value) values ($1, 'observation', 'As corrected.')`,
      [revision],
    );
    await harness.db.query(
      `insert into public.form_instance_events (instance_id, kind, actor, detail) values ($1, 'created', 'manager-1', $2::jsonb)`,
      [revision, JSON.stringify({ revisionOf: original, kind: "revised", reason: "Wrong offense date.", revisionNumber: 1 })],
    );
    const event = await one<{ detail: Record<string, unknown> }>(
      `select detail from public.form_instance_events where instance_id = $1 and kind = 'created'`,
      [revision],
    );
    expect(event.detail).toEqual({ revisionOf: original, kind: "revised", reason: "Wrong offense date.", revisionNumber: 1 });
  });

  it("keeps refusing once the original is marked revised, and freezes the finalized revision too", async () => {
    await harness.db.query(`update public.form_instances set status = 'finalized', finalized_at = now() where id = $1`, [revision]);
    await harness.db.query(`update public.form_instances set status = 'revised' where id = $1`, [original]);
    expect(await refused(`update public.form_instance_values set value = 'Changed.' where instance_id = $1`, [original])).toContain(
      "This form is finalized",
    );
    expect(await refused(`update public.form_instance_values set value = 'Changed.' where instance_id = $1`, [revision])).toContain(
      "This form is finalized",
    );
    const kept = await one<{ value: string }>(`select value from public.form_instance_values where instance_id = $1`, [original]);
    expect(kept.value).toBe("As finalized.");
  });
});
