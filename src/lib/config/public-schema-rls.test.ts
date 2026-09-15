import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * NO TABLE REACHES `public` WITHOUT ROW LEVEL SECURITY
 * ============================================================================
 *
 * THE REGRESSION. Supabase's project linter reported one ERROR against the
 * deployed database: `public.knowledge_chunks_backfill_20260911` — a snapshot
 * taken by hand before a September backfill — was exposed through PostgREST
 * with RLS off. Supabase grants `anon` and `authenticated` full DML on any new
 * table in `public`, so with RLS off the publishable key that ships in every
 * browser could read that table, and delete it.
 *
 * It was not created by a migration, and that is the whole lesson. Every table
 * that arrived through this directory got the security posture written beside
 * it in the same file; the one created out-of-band got nothing, and nothing
 * noticed for four days.
 *
 * TWO CHECKS, because there are two ways in. The first walks every `create
 * table` in the migrations and insists the same set of files secures it. The
 * second names the out-of-band table directly, because no static reading of
 * this directory could otherwise know it exists.
 *
 * A STATIC CHECK, and it says so. It reads SQL text, not a live database, so it
 * cannot prove production is secured — it proves the migrations would secure a
 * database they built, and pins the one table they did not build.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

/** Strips `--` comment lines, so prose cannot satisfy or fail an assertion. */
function statements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const ALL_SQL = migrations()
  .map((file) => statements(file.sql))
  .join("\n");

/**
 * Tables created in `public` by the migrations, in creation order.
 *
 * `if not exists` is optional in the pattern because both spellings appear.
 * Temporary and unlogged tables are not matched: neither is reachable through
 * PostgREST, so neither is what this suite is about.
 */
function createdTables(): string[] {
  const found = new Set<string>();
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(ALL_SQL)) !== null) found.add(match[1].toLowerCase());
  return [...found].sort();
}

function securedTables(): Set<string> {
  const found = new Set<string>();
  const pattern =
    /alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(ALL_SQL)) !== null) found.add(match[1].toLowerCase());
  return found;
}

describe("every table these migrations create is secured by these migrations", () => {
  it("finds tables to check at all", () => {
    // A regex that silently matched nothing would make the suite below vacuous.
    expect(createdTables().length).toBeGreaterThan(20);
  });

  it("enables row level security on each one", () => {
    const secured = securedTables();
    const unsecured = createdTables().filter((table) => !secured.has(table));

    expect(
      unsecured,
      `created in public with no 'enable row level security': ${unsecured.join(", ")}`,
    ).toEqual([]);
  });
});

describe("the snapshot created outside this directory", () => {
  /*
   * NAMED, because it cannot be derived. The table exists in the deployed
   * database and in no `create table` statement anywhere, so the sweep above
   * is blind to it by construction — the only way a test can hold the line is
   * to know the name.
   */
  const TABLE = "knowledge_chunks_backfill_20260911";

  it("is secured by a migration even though nothing here creates it", () => {
    expect(securedTables().has(TABLE)).toBe(true);
  });

  it("is guarded with IF EXISTS, so a database built from these files is fine", () => {
    /*
     * The table predates nothing in this directory: a fresh database built from
     * these migrations alone has never had it. An unguarded ALTER would abort
     * the migration run on every new environment.
     */
    const file = migrations().find((entry) => entry.sql.includes(TABLE));
    expect(file, `no migration mentions ${TABLE}`).toBeDefined();
    expect(file!.sql).toMatch(/to_regclass\s*\(\s*'public\.knowledge_chunks_backfill_20260911'\s*\)/);
  });

  it("takes back the privileges Supabase grants the browser roles", () => {
    const file = migrations().find((entry) => entry.sql.includes(TABLE))!;
    const sql = statements(file.sql).replace(/\s+/g, " ");
    expect(sql).toContain(`revoke all on public.${TABLE} `);
    expect(sql).toContain("from anon, authenticated");
  });

  it("does not drop it: the backfill it guards is still recent", () => {
    const file = migrations().find((entry) => entry.sql.includes(TABLE))!;
    expect(statements(file.sql)).not.toMatch(/drop\s+table/i);
    expect(statements(file.sql)).not.toMatch(/truncate/i);
    expect(statements(file.sql)).not.toMatch(/delete\s+from/i);
  });

  it("leaves knowledge retrieval alone", () => {
    /*
     * `match_knowledge_chunks` reads `knowledge_chunks`, which is a different
     * table and already enabled and forced. A migration that touched it while
     * securing a backup would be changing retrieval under cover of a fix.
     */
    const file = migrations().find((entry) => entry.sql.includes(TABLE))!;
    const sql = statements(file.sql);
    expect(sql).not.toMatch(/\bpublic\.knowledge_chunks\b(?!_backfill)/);
    expect(sql).not.toMatch(/match_knowledge_chunks/);
  });
});
