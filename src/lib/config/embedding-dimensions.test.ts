import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHUNKING,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_BATCH,
  EMBEDDING_MAX_INPUT_TOKENS,
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
 *
 * The migrations are a HISTORY, not a snapshot. They have already declared one
 * width (1024, for an external embedding vendor) and been corrected to another
 * (384, for the gte-small model that runs inside Supabase). Applied migrations
 * are not rewritten, so older files still name the old width truthfully. What
 * must equal MIGRATED_EMBEDDING_DIMENSIONS is therefore the width the history
 * ENDS at — checked below by reading the files in the order Postgres applies
 * them, exactly as the database sees them.
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
 * The privilege-granting SQL across the RLS migration and every corrective
 * follow-up, comments removed and whitespace collapsed. They must agree: a
 * fresh project applies them in order, an existing one applies only what it is
 * missing, and both converge on the same end state.
 *
 * The 384 migration is included because replacing the retrieval function
 * created a NEW privilege surface — a new signature is created with Postgres's
 * default EXECUTE-to-PUBLIC, and the earlier revokes named the old one.
 */
function privilegeSql(): string {
  return migrationFiles()
    .filter(
      (file) =>
        file.name.includes("rls") ||
        file.name.includes("privilege") ||
        file.name.includes("embedding_dimensions"),
    )
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

/**
 * Widths a file CREATES, excluding the ones it drops.
 *
 * A migration that narrows the column has to name the outgoing width in its
 * `drop function` — the argument type is part of the function's identity, so
 * there is no other way to remove the old signature. That mention is history,
 * not a declaration, and counting it would make a correct migration look
 * inconsistent.
 */
function createdVectorWidths(sql: string): number[] {
  return statementsOnly(sql)
    .split(";")
    .filter((statement) => !statement.trim().toLowerCase().startsWith("drop"))
    .flatMap((statement) => declaredVectorWidths(statement));
}

/** Widths named only by `drop` statements. */
function droppedVectorWidths(sql: string): number[] {
  return statementsOnly(sql)
    .split(";")
    .filter((statement) => statement.trim().toLowerCase().startsWith("drop"))
    .flatMap((statement) => declaredVectorWidths(statement));
}

/**
 * The last migration that creates a vector width, in applied order. This is the
 * file describing the schema as it stands; everything before it is history.
 */
function currentWidthMigration(): { name: string; sql: string; widths: number[] } {
  const withWidths = migrationFiles()
    .map((file) => ({ ...file, widths: createdVectorWidths(file.sql) }))
    .filter((file) => file.widths.length > 0);

  const last = withWidths.at(-1);
  if (!last) throw new Error("No migration declares a vector width.");
  return last;
}

/** The Edge Function that produces every vector this app stores. */
function embedFunctionSource(): string {
  return readFileSync(
    join(process.cwd(), "supabase", "functions", "embed", "index.ts"),
    "utf8",
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

  it("ends its migration history at MIGRATED_EMBEDDING_DIMENSIONS", () => {
    const current = currentWidthMigration();

    // Every width in the newest width-declaring migration must agree: it
    // rewrites the column, the RPC argument and both grant signatures, and a
    // partial conversion is the failure mode that breaks retrieval silently.
    expect(current.widths.length, `${current.name} declares too few widths`)
      .toBeGreaterThanOrEqual(4);

    for (const width of current.widths) {
      expect(width, `vector(${width}) in ${current.name}`).toBe(
        MIGRATED_EMBEDDING_DIMENSIONS,
      );
    }
  });

  it("drops the superseded function signature instead of overloading it", () => {
    /*
     * REGRESSION. `create or replace function` matches on the argument list, so
     * replacing vector(1024) with vector(384) creates a SECOND function of the
     * same name rather than replacing the first. PostgREST would then have two
     * candidates for one RPC name. Any width this migration drops must be one
     * an earlier migration actually created.
     */
    const files = migrationFiles();
    const current = currentWidthMigration();
    const currentIndex = files.findIndex((file) => file.name === current.name);

    const earlier = files
      .slice(0, currentIndex)
      .flatMap((file) => createdVectorWidths(file.sql));

    for (const width of droppedVectorWidths(current.sql)) {
      expect(earlier, `${current.name} drops vector(${width}), which nothing created`)
        .toContain(width);
    }
  });

  it("converts every object that carries the old width", () => {
    // A migration that narrowed the column but left the RPC at the old width
    // would apply cleanly and then never match a row. All four objects have to
    // move together.
    const { sql } = currentWidthMigration();
    const statements = statementsOnly(sql);

    expect(statements).toContain("alter table public.knowledge_chunks");
    expect(statements).toContain(
      `alter column embedding type extensions.vector(${MIGRATED_EMBEDDING_DIMENSIONS})`,
    );
    // The HNSW index is built over the declared type and has to be rebuilt.
    expect(statements).toContain("drop index if exists public.knowledge_chunks_embedding_idx");
    expect(statements).toContain("using hnsw (embedding extensions.vector_cosine_ops)");
    // A vector width is part of a function's identity, so `create or replace`
    // would ADD an overload rather than replace one. The old one must be dropped.
    expect(statements).toContain("drop function if exists public.match_knowledge_chunks");
    expect(statements).toContain(
      `create or replace function public.match_knowledge_chunks( query_embedding extensions.vector(${MIGRATED_EMBEDDING_DIMENSIONS}),`,
    );
  });

  it("refuses to narrow the column while chunks of the old width exist", () => {
    // An `alter column ... type vector(n)` re-checks every row and aborts
    // part-way through on a populated table. The guard turns that into an
    // up-front refusal that says what to do instead.
    const { sql } = currentWidthMigration();
    const statements = statementsOnly(sql);

    expect(statements).toContain("select count(*) into chunk_count from public.knowledge_chunks");
    expect(statements).toContain("raise exception");
  });

  it("matches the configured model's width to the migrated column width", () => {
    // If this fails, a migration altering the column and re-embedding every
    // chunk is required before live mode can be enabled.
    expect(EMBEDDING_DIMENSIONS).toBe(MIGRATED_EMBEDDING_DIMENSIONS);
  });

  it("resolves the configured dimension from the model registry", () => {
    expect(EMBEDDING_MODELS[EMBEDDING_MODEL].dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("registers the width the Edge Function actually asserts", () => {
    // The function checks every vector it returns against its own DIMENSIONS
    // constant. If that constant and this registry disagree, one of them is
    // wrong and ingestion fails at insert time instead of here.
    const declared = embedFunctionSource().match(/const DIMENSIONS = (\d+)/);
    expect(declared, "supabase/functions/embed/index.ts must declare DIMENSIONS").not.toBeNull();
    expect(Number(declared![1])).toBe(EMBEDDING_DIMENSIONS);
  });

  it("names the same model in the config registry and the Edge Function", () => {
    const declared = embedFunctionSource().match(/const MODEL = "([^"]+)"/);
    expect(declared, "supabase/functions/embed/index.ts must declare MODEL").not.toBeNull();
    expect(declared![1]).toBe(EMBEDDING_MODEL);
  });

  it("never sends the Edge Function more inputs than it accepts", () => {
    // EMBEDDING_MAX_BATCH is what the ingestion pipeline slices by; MAX_INPUTS
    // is what the function rejects above. Exceeding it is an HTTP 400 mid-way
    // through indexing a large document.
    const declared = embedFunctionSource().match(/const MAX_INPUTS = (\d+)/);
    expect(declared, "supabase/functions/embed/index.ts must declare MAX_INPUTS").not.toBeNull();
    expect(EMBEDDING_MAX_BATCH).toBeGreaterThan(0);
    expect(EMBEDDING_MAX_BATCH).toBeLessThanOrEqual(Number(declared![1]));
  });

  it("keeps every registered batch size positive", () => {
    for (const [model, config] of Object.entries(EMBEDDING_MODELS)) {
      expect(config.maxBatch, `${model}`).toBeGreaterThan(0);
    }
  });

  it("sizes chunks to fit inside the embedding model's input limit", () => {
    /*
     * gte-small truncates at 512 tokens and does not say so. A chunk over that
     * ceiling would be stored with an embedding computed from its opening
     * only — a valid-looking vector that does not represent the text it is
     * attached to. The ceiling is the hard one; the margin absorbs the
     * chunker's characters-per-token approximation.
     */
    expect(CHUNKING.maxTokens).toBeLessThan(EMBEDDING_MAX_INPUT_TOKENS);
    expect(CHUNKING.targetTokens).toBeLessThanOrEqual(CHUNKING.maxTokens);
    expect(CHUNKING.overlapTokens).toBeLessThan(CHUNKING.targetTokens);
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
      `revoke execute on function public.match_knowledge_chunks( extensions.vector(${MIGRATED_EMBEDDING_DIMENSIONS}), text, integer, double precision, text[] ) from public, anon, authenticated;`,
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
