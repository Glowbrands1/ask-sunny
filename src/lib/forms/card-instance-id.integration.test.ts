import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMigratedTestDatabase, type KnowledgeTestDatabase } from "@/test/pglite-knowledge-db";

vi.mock("server-only", () => ({}));

/**
 * ============================================================================
 * ONE FORM PER CARD, ENFORCED BY THE FORMS TABLE'S OWN PRIMARY KEY
 * ============================================================================
 *
 * QA, 22 Oct 2026, round 3. `cardInstanceId` derives a form's row id from the
 * manager and the chat card, so two creates for the same card — on any server,
 * at the same instant — insert the same id, and Postgres admits one. This runs
 * the repository's own forms migrations, WITHOUT the claims-table migration,
 * on real Postgres (PGlite): the guard needs no migration.
 */
const APPLIED = [
  "20260829000100_extensions",
  "20260829000200_knowledge_schema",
  "20260904001000_forms_engine",
];

const PLATFORM = `
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`;

let harness: KnowledgeTestDatabase;
let templateId: string;
let versionId: string;

beforeAll(async () => {
  harness = await createMigratedTestDatabase(APPLIED, { platform: PLATFORM });
  const template = await harness.db.query<{ id: string }>(
    `insert into public.form_templates (key, name, short_name, layout_family, required_permission)
     values ('dpoa', 'Corrective Action Form', 'CA', (enum_range(null::public.form_layout_family))[1], 'create_forms') returning id`,
  );
  templateId = template.rows[0]!.id;
  const version = await harness.db.query<{ id: string }>(
    `insert into public.form_template_versions (template_id, version, document) values ($1, 1, '{}'::jsonb) returning id`,
    [templateId],
  );
  versionId = version.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

const insertWithId = (id: string) =>
  harness.db
    .query(
      `insert into public.form_instances (id, template_id, template_version_id, employee_name, created_by, source)
       values ($1, $2, $3, 'Tess Varga', 'manager-1', 'ask_sunny')`,
      [id, templateId, versionId],
    )
    .then(
      () => "inserted",
      (error: { code?: string }) => error.code ?? "error",
    );

describe("cardInstanceId on real Postgres", () => {
  it("is a valid uuid the table accepts, and a second insert of it is a unique violation (23505)", async () => {
    const { cardInstanceId } = await import("./create-once");
    const id = cardInstanceId("manager-1", "6ba45454-5227-422c-ad84-4e480717f22e");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await insertWithId(id)).toBe("inserted");
    expect(await insertWithId(id)).toBe("23505");
  });

  it("differs by manager and by card", async () => {
    const { cardInstanceId } = await import("./create-once");
    const card = "6ba45454-5227-422c-ad84-4e480717f22e";
    expect(cardInstanceId("manager-1", card)).not.toBe(cardInstanceId("manager-2", card));
    expect(cardInstanceId("manager-1", card)).not.toBe(cardInstanceId("manager-1", "2366caae-1be3-4b60-b855-632ed11bbbd0"));
    expect(cardInstanceId("manager-1", card)).toBe(cardInstanceId("manager-1", card));
  });
});
