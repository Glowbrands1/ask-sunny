import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase, type KnowledgeTestDatabase } from "@/test/pglite-knowledge-db";

/**
 * ============================================================================
 * THE CLAIM TABLE ON A REAL POSTGRES (PGlite), FROM THE REPOSITORY'S OWN SQL
 * ============================================================================
 *
 * `create-once.ts` relies on exactly one thing from migration
 * 20261022001000: a second insert of the same (manager, card) fails with
 * 23505. The route tests model that in the fake; this proves the migration
 * really gives it, on top of the forms schema it references, and that the table is as
 * closed to `authenticated` as every other forms table. Not applied anywhere.
 */

/*
 * The forms schema the claim refers to, in order, then the claim. Not every
 * migration: a Google Reviews migration's own self-check cannot run on PGlite,
 * and nothing the claim touches comes from it.
 */
const APPLIED = [
  "20260829000100_extensions",
  // Defines `touch_updated_at`, which the forms tables use.
  "20260829000200_knowledge_schema",
  "20260904001000_forms_engine",
  "20260904002000_forms_guard_execute_revoke",
  "20260904003000_forms_instance_archive",
  "20260904004000_forms_follow_up_tracking",
  "20260907001000_forms_hiring_interview_category",
  "20261022001000_form_create_claims",
];

const PLATFORM = `
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`;

let harness: KnowledgeTestDatabase;

beforeAll(async () => {
  harness = await createMigratedTestDatabase(APPLIED, { platform: PLATFORM });
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

const CARD = "6ba45454-5227-422c-ad84-4e480717f22e";

describe("form_create_claims", () => {
  it("admits one claim per manager and card: the second is a unique violation, 23505", async () => {
    await harness.db.query(`insert into public.form_create_claims (created_by, proposal_id) values ($1, $2)`, [
      "manager-1",
      CARD,
    ]);
    const second = await harness.db
      .query(`insert into public.form_create_claims (created_by, proposal_id) values ($1, $2)`, ["manager-1", CARD])
      .then(
        () => null,
        (error: { code?: string }) => error.code,
      );
    expect(second).toBe("23505");
  });

  it("lets another manager claim a card with the same id", async () => {
    await expect(
      harness.db.query(`insert into public.form_create_claims (created_by, proposal_id) values ($1, $2)`, [
        "manager-2",
        CARD,
      ]),
    ).resolves.toBeTruthy();
  });

  it("refuses an id that is not a card id", async () => {
    const code = await harness.db
      .query(`insert into public.form_create_claims (created_by, proposal_id) values ($1, $2)`, [
        "manager-1",
        "'; drop table x; --",
      ])
      .then(
        () => null,
        (error: { code?: string }) => error.code,
      );
    expect(code).toBe("23514");
  });

  it("is closed to the authenticated role", async () => {
    const denied = await harness
      .asAuthenticated(`select * from public.form_create_claims`)
      .then(
        () => null,
        (error: { code?: string }) => error.code,
      );
    expect(denied).toBe("42501");
  });
});
