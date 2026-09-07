import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * INSTALLING THE LIBRARY, AND RE-ISSUING A FORM.
 *
 * The rule these tests exist for: WHEN THE BUSINESS HANDS OVER A NEW COPY OF A
 * FORM THAT ALREADY EXISTS, the new copy has to become the one people fill,
 * without the old one becoming unreadable and without overwriting an
 * administrator who has taken the form over.
 *
 * That is three separate promises, and each is easy to break in a way nothing
 * else would notice:
 *
 *   the new document is published and becomes current;
 *   the OLD version still exists, archived, so every form already signed
 *   against it still renders;
 *   a template a person has authored a version of is LEFT ALONE.
 *
 * The fake client is described in `src/test/fake-supabase.ts`.
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

function reset() {
  store.form_templates = [];
  store.form_template_versions = [];
  store.form_template_current = [];
  store.form_template_assets = [];
}

const coachingSeed = TEMPLATE_SEEDS.find((seed) => seed.key === "coaching")!;

/** The Coaching Form as revision 1 had it — the topics that were replaced. */
const SUPERSEDED_COACHING = {
  paper: "letter",
  blocks: [
    { kind: "letterhead", brand: "SUN TAN CITY", title: "Coaching Form" },
    { kind: "section", label: "Topic Of Coaching" },
    {
      kind: "checkbox_group",
      key: "coaching_topics",
      options: [
        { key: "salon_tours", label: "Salon Tours" },
        { key: "lotion_basics", label: "Lotion Basics" },
      ],
      responsibility: "ai",
      columns: 2,
    },
    { kind: "section", label: "Acknowledgement of Training" },
  ],
};

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

beforeEach(reset);

describe("installing an empty library", () => {
  it("creates every template once, at its seed revision", async () => {
    const result = await ensureTemplateLibrary("system");

    expect(result.created).toHaveLength(TEMPLATE_SEEDS.length);
    expect(result.existing).toEqual([]);
    expect(result.revised).toEqual([]);
    expect(store.form_templates).toHaveLength(TEMPLATE_SEEDS.length);

    // Exactly one Coaching Form, at revision 2 — the current source document.
    expect(store.form_templates!.filter((row) => row.key === "coaching")).toHaveLength(1);
    expect(currentVersionOf("coaching")).toMatchObject({ version: 1, seed_revision: 2 });
  });

  it("records each template's category, so the page can group them", async () => {
    await ensureTemplateLibrary("system");
    expect(templateRow("coaching").category).toBe("hr_performance");
    for (const key of [
      "prescreen-phone-interview",
      "tanning-consultant-interview",
      "management-interview-round-1",
      "management-interview-round-2",
    ]) {
      expect(templateRow(key).category, key).toBe("hiring");
      expect(templateRow(key).layout_family, key).toBe("interview");
    }
  });

  it("does nothing at all the second time", async () => {
    await ensureTemplateLibrary("system");
    const before = JSON.stringify(store);

    const again = await ensureTemplateLibrary("system");

    expect(again.created).toEqual([]);
    expect(again.revised).toEqual([]);
    expect(again.existing).toHaveLength(TEMPLATE_SEEDS.length);
    expect(JSON.stringify(store)).toBe(before);
  });
});

describe("a form the business has re-issued", () => {
  /**
   * A database as it was BEFORE this batch: Coaching installed at revision 1,
   * carrying the superseded document.
   *
   * The DOCUMENT is put back as well as the counter. A database at revision 1
   * has revision 1's content, and the seeder now compares the two — so a
   * fixture that moved only the number would be testing nothing.
   */
  async function databaseAtRevisionOne() {
    await ensureTemplateLibrary("system");
    for (const row of versionsOf("coaching")) {
      row.seed_revision = 1;
      row.document = SUPERSEDED_COACHING;
    }
  }

  it("publishes the new document as a NEW version and points the form at it", async () => {
    await databaseAtRevisionOne();

    const result = await ensureTemplateLibrary("system");

    expect(result.revised).toEqual(["coaching"]);
    expect(currentVersionOf("coaching")).toMatchObject({
      version: 2,
      status: "published",
      seed_revision: 2,
    });
    expect(currentVersionOf("coaching")?.document).toEqual(coachingSeed.document);
  });

  it("keeps the old version, archived, so signed forms still render", async () => {
    await databaseAtRevisionOne();
    const originalId = currentVersionOf("coaching")!.id;

    await ensureTemplateLibrary("system");

    const original = versionsOf("coaching").find((row) => row.id === originalId);
    expect(original, "the superseded version was deleted").toBeTruthy();
    expect(original).toMatchObject({ status: "archived" });
    expect(original!.archived_at).toBeTruthy();
    // Two versions of one template — not two templates.
    expect(versionsOf("coaching")).toHaveLength(2);
    expect(store.form_templates!.filter((row) => row.key === "coaching")).toHaveLength(1);
  });

  it("leaves every other template exactly where it was", async () => {
    await databaseAtRevisionOne();

    const result = await ensureTemplateLibrary("system");

    expect(result.revised).toEqual(["coaching"]);
    for (const key of ["dpoa", "policy-review", "sdit-epp", "dmit-epp-tsd"]) {
      expect(versionsOf(key), key).toHaveLength(1);
      expect(currentVersionOf(key), key).toMatchObject({ version: 1 });
    }
  });

  it("does nothing when the published form already says what the seed says", async () => {
    /*
     * THE CASE THIS PROTECTS, AND IT IS NOT HYPOTHETICAL. The re-issued Coaching
     * Form reached Ask Sunny Dev as a published version BEFORE this code did —
     * an administrator's draft was corrected and published against the official
     * PDF. Without this check the next deploy would publish a byte-identical
     * version 3, archive theirs, and leave two versions saying the same thing.
     */
    await ensureTemplateLibrary("system");
    // A database where a person published the new document as version 2, which
     // is what a `seed_revision` of 1 looks like after the column is added.
    for (const row of versionsOf("coaching")) row.seed_revision = 1;

    const result = await ensureTemplateLibrary("system");

    expect(result.revised).toEqual([]);
    expect(result.heldBack).toEqual([]);
    expect(result.existing).toContain("coaching");
    expect(versionsOf("coaching")).toHaveLength(1);
  });

  it("publishes it once, not on every visit to the page", async () => {
    await databaseAtRevisionOne();
    await ensureTemplateLibrary("system");

    const again = await ensureTemplateLibrary("system");

    expect(again.revised).toEqual([]);
    expect(versionsOf("coaching")).toHaveLength(2);
  });
});

describe("standing down", () => {
  it("will not publish over a version a person authored", async () => {
    await ensureTemplateLibrary("system");
    for (const row of versionsOf("coaching")) row.seed_revision = 1;
    // An administrator published their own version — `openDraft` marks it 0.
    const template = templateRow("coaching");
    store.form_template_versions.push({
      id: "authored-1",
      template_id: template.id,
      version: 2,
      status: "published",
      document: { paper: "letter", blocks: [] },
      variants: [],
      seed_revision: 0,
      notes: "Cloned from version 1.",
      created_by: "dana",
    });

    const result = await ensureTemplateLibrary("system");

    expect(result.revised).toEqual([]);
    expect(result.heldBack.map((entry) => entry.key)).toEqual(["coaching"]);
    expect(result.heldBack[0].reason).toContain("authored here");
    expect(versionsOf("coaching")).toHaveLength(2);
  });

  it("will not publish under an open draft", async () => {
    await ensureTemplateLibrary("system");
    for (const row of versionsOf("coaching")) row.seed_revision = 1;
    const template = templateRow("coaching");
    store.form_template_versions.push({
      id: "draft-1",
      template_id: template.id,
      version: 2,
      status: "draft",
      document: { paper: "letter", blocks: [] },
      variants: [],
      seed_revision: 1,
      notes: "Cloned from version 1.",
      created_by: "system",
    });

    const result = await ensureTemplateLibrary("system");

    expect(result.revised).toEqual([]);
    expect(result.heldBack[0]?.reason).toContain("draft");
  });
});

describe("the migration the seeding depends on", () => {
  /*
   * A FAKE CLIENT CANNOT PROVE A SCHEMA. The tests above run against an
   * in-memory store that would happily accept a column Postgres does not have,
   * so the three things the seeder writes are asserted against the migration
   * SQL itself — which is the artefact that has to be applied for any of this
   * to work on a real database.
   */
  const sql = readFileSync(
    "supabase/migrations/20260907001000_forms_hiring_interview_category.sql",
    "utf8",
  );

  it("adds the layout family the four hiring templates are seeded with", () => {
    expect(sql).toMatch(
      /alter type public\.form_layout_family add value if not exists 'interview'/i,
    );
  });

  it("adds the category column the page groups by, defaulting to the existing group", () => {
    expect(sql).toMatch(/alter table public\.form_templates\s+add column if not exists category/i);
    expect(sql).toMatch(/default 'hr_performance'/i);
  });

  it("adds the seed revision column, defaulting to the revision already installed", () => {
    expect(sql).toMatch(
      /alter table public\.form_template_versions\s+add column if not exists seed_revision integer not null default 1/i,
    );
  });

  it("adds nothing destructive", () => {
    // Reversibility is the promise this migration was written under. The one
    // irreversible line — an enum value, which Postgres cannot drop — is stated
    // in the file's own header rather than hidden.
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdrop column\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
  });
});

describe("the migration the proposal drafts depend on", () => {
  const sql = readFileSync(
    "supabase/migrations/20260907002000_forms_version_proposal.sql",
    "utf8",
  );

  it("adds the column a proposed draft records its source in", () => {
    expect(sql).toMatch(
      /alter table public\.form_template_versions\s+add column if not exists proposal jsonb not null default/i,
    );
  });

  it("adds nothing destructive, and nothing that publishes anything", () => {
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdrop column\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    // Which version is current is not this column's business, and a migration
    // that touched that table would be changing live forms on deploy.
    expect(sql).not.toMatch(/form_template_current/i);
  });
});
