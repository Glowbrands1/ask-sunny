import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  MIGRATED_EMBEDDING_DIMENSIONS,
} from "./models";

/**
 * THE EMBEDDING DIMENSION INVARIANT.
 *
 * `MIGRATED_EMBEDDING_DIMENSIONS` is a hand-written constant claiming to
 * describe what the SQL says. A comment cannot enforce that; this test can.
 *
 * If the two ever drift, ingestion writes vectors of one width into a column of
 * another: Postgres rejects the insert, or — worse, if only the RPC signature
 * drifts — retrieval silently returns nothing and Sunny answers "the knowledge
 * base does not cover that" for every question. So the SQL is parsed and
 * checked rather than trusted.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
    }));
}

/** Strips `--` comment lines so prose cannot satisfy a SQL assertion. */
function statementsOnly(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");
}

/**
 * The privilege-granting SQL across the RLS migration and its corrective
 * follow-up, comments removed and whitespace collapsed. Both files must agree:
 * a fresh project applies the corrected original, an existing one applies the
 * correction, and they converge on the same end state.
 */
function privilegeSql(): string {
  return migrationFiles()
    .filter((file) => file.name.includes("rls") || file.name.includes("privilege"))
    .map((file) => statementsOnly(file.sql))
    .join(" ");
}

/** Every `vector(n)` in a file, ignoring the ones inside SQL comments. */
function declaredVectorWidths(sql: string): number[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return [...withoutComments.matchAll(/vector\s*\(\s*(\d+)\s*\)/gi)].map((match) =>
    Number(match[1]),
  );
}

describe("embedding dimension consistency", () => {
  it("finds the migrations directory with the expected files", () => {
    const names = migrationFiles().map((file) => file.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("20260829000200_knowledge_schema.sql");
    expect(names).toContain("20260829000300_match_knowledge_chunks.sql");
    expect(names).toContain("20260829000400_rls.sql");
  });

  it("declares the same vector width in every migration that names one", () => {
    const widths = migrationFiles().flatMap((file) => declaredVectorWidths(file.sql));

    // The schema column, the RPC argument, and both grant signatures.
    expect(widths.length).toBeGreaterThanOrEqual(4);
    expect(new Set(widths).size).toBe(1);
  });

  it("matches MIGRATED_EMBEDDING_DIMENSIONS to what the SQL actually declares", () => {
    for (const file of migrationFiles()) {
      for (const width of declaredVectorWidths(file.sql)) {
        expect(width, `vector(${width}) in ${file.name}`).toBe(
          MIGRATED_EMBEDDING_DIMENSIONS,
        );
      }
    }
  });

  it("matches the configured model's width to the migrated column width", () => {
    // If this fails, a migration altering the column and re-embedding every
    // chunk is required before live mode can be enabled.
    expect(EMBEDDING_DIMENSIONS).toBe(MIGRATED_EMBEDDING_DIMENSIONS);
  });

  it("resolves the configured dimension from the model registry", () => {
    expect(EMBEDDING_MODELS[EMBEDDING_MODEL].dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("only registers widths the Voyage 4 embedding space supports", () => {
    // 256, 512, 1024 and 2048 via Matryoshka truncation. Requesting anything
    // else would be rejected at call time.
    const SUPPORTED = [256, 512, 1024, 2048];
    for (const [model, config] of Object.entries(EMBEDDING_MODELS)) {
      expect(SUPPORTED, `${model} requests ${config.dimensions}`).toContain(
        config.dimensions,
      );
    }
  });

  it("keeps every registered batch size within the Voyage per-request limit", () => {
    for (const [model, config] of Object.entries(EMBEDDING_MODELS)) {
      expect(config.maxBatch, `${model}`).toBeGreaterThan(0);
      expect(config.maxBatch, `${model}`).toBeLessThanOrEqual(128);
    }
  });
});

describe("migration safety expectations", () => {
  it("keeps the knowledge bucket private", () => {
    const bucket = migrationFiles().find((file) => file.name.includes("storage_bucket"));
    expect(bucket).toBeDefined();
    // The `public` column of storage.buckets must be false. Company policy
    // documents behind a public URL is the failure this asserts against.
    expect(bucket!.sql).toMatch(/'knowledge-documents',\s*\n?\s*false/);
    expect(bucket!.sql).not.toMatch(/'knowledge-documents',\s*\n?\s*true/);
  });

  it("enables row level security on both knowledge tables", () => {
    const rls = migrationFiles().find((file) => file.name.includes("rls"));
    expect(rls).toBeDefined();
    expect(rls!.sql).toContain("alter table public.knowledge_documents enable row level security");
    expect(rls!.sql).toContain("alter table public.knowledge_chunks    enable row level security");
  });

  it("grants the anonymous role nothing", () => {
    // Checked against STATEMENTS, not raw file text: the migration's comments
    // quote Supabase's own `grant all on tables to anon, authenticated` default
    // when explaining the defect, and prose must not fail — or satisfy — a
    // privilege assertion.
    const sql = privilegeSql();

    expect(sql).toContain("revoke all on public.knowledge_documents from anon");
    expect(sql).toContain("revoke all on public.knowledge_chunks from anon");
    // No executable statement may grant anything to `anon`.
    expect(sql).not.toMatch(/to anon\b/);
  });

  it("revokes the browser roles' default table privileges before granting", () => {
    /*
     * REGRESSION. Supabase ships `alter default privileges ... grant all on
     * tables to anon, authenticated`, so both roles hold INSERT/UPDATE/DELETE
     * the moment a table is created in `public`. A `grant select` is additive
     * and does NOT take those away — the original migration granted select and
     * left the write privileges in place, which post-application verification
     * caught. `authenticated` must be revoked from, not only `anon`.
     */
    const sql = privilegeSql();

    for (const table of ["knowledge_documents", "knowledge_chunks"]) {
      expect(sql, `${table} must have its authenticated grants revoked`).toContain(
        `revoke all on public.${table} from anon, authenticated;`,
      );
    }
  });

  it("revokes the retrieval function's PUBLIC execute grant", () => {
    /*
     * REGRESSION. Postgres grants EXECUTE on every new function to PUBLIC,
     * which `anon` inherits. Revoking from `anon` alone leaves the inherited
     * PUBLIC grant intact, so PUBLIC has to be named explicitly.
     */
    const sql = privilegeSql();

    expect(sql).toContain(
      "revoke execute on function public.match_knowledge_chunks( extensions.vector(1024), text, integer, double precision, text[] ) from public, anon, authenticated;",
    );
  });

  it("enables pgvector before the schema that depends on it", () => {
    const files = migrationFiles();
    const extensions = files.findIndex((file) => file.name.includes("extensions"));
    const schema = files.findIndex((file) => file.name.includes("knowledge_schema"));

    expect(extensions).toBeGreaterThanOrEqual(0);
    expect(extensions).toBeLessThan(schema);
    expect(files[extensions]!.sql).toContain("create extension if not exists vector");
  });
});
