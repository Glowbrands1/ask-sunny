import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/test/pglite-knowledge-db";

/**
 * The hybrid migration only adds a column, an index, and a new function.
 * The similarity function and the embedding column stay as they are.
 */

const SQL = readFileSync(
  "supabase/migrations/20261023001000_knowledge_hybrid_search.sql",
  "utf8",
);

const PRIOR = [
  "20260829000100_extensions",
  "20260829000200_knowledge_schema",
  "20260829000300_match_knowledge_chunks",
  "20260829000400_rls",
  "20260831000600_rls_privilege_hardening",
  "20260831000800_embedding_dimensions_384",
  "20260929001000_woven_knowledge_sync",
  "20260930001000_woven_knowledge_inventory",
  "20260930002000_knowledge_document_superseded",
] as const;

describe("hybrid retrieval migration", () => {
  it("adds a tsvector and a new function without replacing the existing one", () => {
    const statements = SQL.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).toMatch(/add column if not exists content_tsv tsvector/i);
    expect(statements).toMatch(/using gin \(content_tsv\)/i);
    expect(statements).toContain("match_knowledge_chunks_hybrid");
    expect(statements).not.toMatch(/create or replace function public\.match_knowledge_chunks\(/i);
    expect(statements).not.toMatch(/drop (table|column|function|index)/i);
    expect(statements).not.toMatch(/alter column/i);
    expect(statements).not.toMatch(/vector\s*\(\s*\d+\s*\)/i);
    expect(statements).toMatch(/revoke execute on function public\.match_knowledge_chunks_hybrid/i);
    expect(statements).not.toMatch(/to anon\b/i);
  });

  it("applies beside the existing similarity function", async () => {
    const harness = await createMigratedTestDatabase([
      ...PRIOR,
      "20261023001000_knowledge_hybrid_search",
    ]);
    try {
      const column = await harness.db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'knowledge_chunks' and column_name = 'content_tsv'`,
      );
      const functions = await harness.db.query<{ proname: string }>(
        `select proname from pg_proc
          where proname in ('match_knowledge_chunks', 'match_knowledge_chunks_hybrid')`,
      );
      expect(column.rows.map((row) => row.column_name)).toEqual(["content_tsv"]);
      expect(functions.rows.map((row) => row.proname).sort()).toEqual([
        "match_knowledge_chunks",
        "match_knowledge_chunks_hybrid",
      ]);
    } finally {
      await harness.close();
    }
  }, 30_000);
});
