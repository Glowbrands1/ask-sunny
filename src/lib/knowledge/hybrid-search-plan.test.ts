import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { expandGlossaryQuery } from "@/lib/ai/glossary";
import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";
import { selectHybridMatches, type HybridCandidate } from "@/lib/knowledge/hybrid-rank";
import { bagOfWordsEmbedding, createMigratedTestDatabase } from "@/test/pglite-knowledge-db";

/**
 * The replacement function ORs significant words, so the late-arrival question
 * hits Attendance, and it reads candidates from the HNSW and GIN indexes
 * instead of a materialized copy of every visible chunk.
 */

const SQL = readFileSync(
  "supabase/migrations/20261023161000_match_knowledge_chunks_hybrid_index.sql",
  "utf8",
);

const Q1 = "what is the policy if an employee showed up late 3 times this month";

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
  "20261023001000_knowledge_hybrid_search",
  "20261023161000_match_knowledge_chunks_hybrid_index",
] as const;

const SCOPE = "hybrid-plan";
const MANUAL = "11111111-1111-4111-8111-111111111111";
const FRAMEWORK = "22222222-2222-4222-8222-222222222222";

function liveSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("hybrid index migration", () => {
  it("replaces the function body and keeps the previous body as rollback", () => {
    const live = liveSql(SQL);
    expect(live).toContain("create or replace function public.match_knowledge_chunks_hybrid");
    expect(live).toContain("websearch_to_tsquery");
    expect(live).toMatch(/order by c\.embedding operator\(extensions\.<=>\) query_embedding/i);
    expect(live).toMatch(/content_tsv @@ \(select keyword_query\.tsq from keyword_query\)/i);
    expect(live).toContain("set statement_timeout = '6s'");
    expect(live).toContain("set hnsw.iterative_scan = 'strict_order'");
    expect(live).not.toContain("plainto_tsquery");
    expect(live).not.toMatch(/drop (table|column|function|index)/i);
    expect(live).not.toMatch(/create or replace function public\.match_knowledge_chunks\(/i);
    expect(SQL).toMatch(/plainto_tsquery\('english', query_text\)/);
    expect(SQL).toContain("Rollback");
  });

  it("ORs the late-arrival question onto Attendance and prefers it to the framework", async () => {
    const harness = await createMigratedTestDatabase(PRIOR);
    try {
      const attendanceText = "Attendance. When an employee is late, the late arrival is recorded.";
      const frameworkText = "Performance Management Framework. Coaching comes before a written step on the ladder.";
      const frameworkVector = bagOfWordsEmbedding(frameworkText, EMBEDDING_DIMENSIONS);
      const attendanceVector = bagOfWordsEmbedding(attendanceText, EMBEDDING_DIMENSIONS);

      await insertDocument(harness.db, {
        id: MANUAL,
        title: "JBA Policy Manual Edited 5.2025",
        category: "policies_compliance",
        file: "JBA-Policy-Manual-Edited-5.2025.pdf",
      });
      await insertChunk(harness.db, {
        documentId: MANUAL,
        index: 0,
        section: "Attendance",
        page: 15,
        content: attendanceText,
        embedding: attendanceVector,
      });
      await insertDocument(harness.db, {
        id: FRAMEWORK,
        title: "Performance Management Framework",
        category: "leadership_coaching",
        file: "performance-management-framework.txt",
      });
      await insertChunk(harness.db, {
        documentId: FRAMEWORK,
        index: 0,
        section: "Performance Management Ladder",
        page: 2,
        content: frameworkText,
        embedding: frameworkVector,
      });

      for (let index = 0; index < 40; index += 1) {
        const id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
        await insertDocument(harness.db, {
          id,
          title: `Filler ${index}`,
          category: "operations",
          file: `filler-${index}.txt`,
        });
        await insertChunk(harness.db, {
          documentId: id,
          index: 0,
          section: "Notes",
          page: 1,
          content: `Filler alpha bravo charlie ${index}`,
          embedding: unitNoise(EMBEDDING_DIMENSIONS, index),
        });
      }

      const andMatch = await harness.db.query<{ n: number }>(
        `select count(*)::int as n
           from public.knowledge_chunks
          where knowledge_scope_id = $1
            and content_tsv @@ plainto_tsquery('english', $2)`,
        [SCOPE, Q1],
      );
      expect(andMatch.rows[0]?.n).toBe(0);

      const config = await harness.db.query<{ proconfig: string[] | null }>(
        `select proconfig from pg_proc where proname = 'match_knowledge_chunks_hybrid'`,
      );
      expect(config.rows[0]?.proconfig?.join(" ") ?? "").toContain("statement_timeout=6s");
      expect(config.rows[0]?.proconfig?.join(" ") ?? "").toContain("hnsw.iterative_scan=strict_order");

      const matched = await harness.db.query<{
        chunk_id: string;
        section: string;
        page: number;
        vector_rank: number | null;
        keyword_rank: number | null;
        similarity: number;
        document_title: string;
        category: string;
        content: string;
        document_id: string;
        locator: string;
      }>(
        `select * from public.match_knowledge_chunks_hybrid(
           $1::extensions.vector, $2, $3, 8, 0.78, null
         )`,
        [`[${frameworkVector.join(",")}]`, Q1, SCOPE],
      );
      const attendance = matched.rows.find((row) => row.section === "Attendance");
      const pmf = matched.rows.find((row) => row.section === "Performance Management Ladder");
      expect(attendance?.keyword_rank).toBe(1);
      expect(attendance?.page).toBe(15);
      expect(pmf?.vector_rank).toBe(1);

      const ranked = selectHybridMatches(
        matched.rows.map(
          (row): HybridCandidate => ({
            row: {
              chunk_id: row.chunk_id,
              document_id: row.document_id,
              document_title: row.document_title,
              category: row.category,
              locator: row.locator,
              page: row.page,
              section: row.section,
              content: row.content,
              similarity: Number(row.similarity),
            },
            vectorRank: row.vector_rank === null ? null : Number(row.vector_rank),
            keywordRank: row.keyword_rank === null ? null : Number(row.keyword_rank),
            sectionExact: false,
          }),
        ),
        Q1,
        { vectorFloor: 0.78, limit: 4 },
      );
      expect(ranked[0]?.section).toBe("Attendance");
      expect(ranked.findIndex((row) => row.section === "Attendance")).toBeLessThan(
        ranked.findIndex((row) => row.section === "Performance Management Ladder"),
      );

      const glossaryQuery = expandGlossaryQuery("tardy");
      expect(glossaryQuery).toContain("Attendance");
      const glossaryHit = await harness.db.query<{ section: string }>(
        `select section from public.match_knowledge_chunks_hybrid(
           $1::extensions.vector, $2, $3, 8, 0.0, null
         ) where section = 'Attendance'`,
        [`[${attendanceVector.join(",")}]`, glossaryQuery, SCOPE],
      );
      expect(glossaryHit.rows).toHaveLength(1);
      const glossaryAnd = await harness.db.query<{ n: number }>(
        `select count(*)::int as n
           from public.knowledge_chunks
          where knowledge_scope_id = $1
            and section = 'Attendance'
            and content_tsv @@ plainto_tsquery('english', $2)`,
        [SCOPE, glossaryQuery],
      );
      expect(glossaryAnd.rows[0]?.n).toBe(0);

      await harness.db.exec("analyze public.knowledge_chunks; analyze public.knowledge_documents;");
      const vectorLiteral = `[${frameworkVector.join(",")}]`;
      /*
       * Forty rows are cheaper to sort from the scope btree than to read from
       * HNSW. Turning the sort off leaves the ordered HNSW scan as the plan
       * that can satisfy ORDER BY embedding <=> query LIMIT, which is the
       * scan the old materialized CTE cannot use.
       */
      await harness.db.exec("set enable_seqscan = off");
      await harness.db.exec("set enable_sort = off");
      await harness.db.exec("set hnsw.iterative_scan = strict_order");
      const vectorPlan = await explain(
        harness.db,
        `select c.id
           from public.knowledge_chunks c
          where c.knowledge_scope_id = '${SCOPE}'
            and exists (
              select 1 from public.knowledge_documents d
               where d.id = c.document_id
                 and d.indexed = true
                 and d.status = 'indexed'
                 and d.version = c.version
            )
          order by c.embedding operator(extensions.<=>) '${vectorLiteral}'::extensions.vector
          limit 8`,
      );
      await harness.db.exec("set enable_sort = on");
      const keywordPlan = await explain(
        harness.db,
        `select c.id
           from public.knowledge_chunks c
          where c.content_tsv @@ websearch_to_tsquery('english', 'employee OR late OR policy')
          order by ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', 'employee OR late OR policy')) desc
          limit 8`,
      );
      const materializedPlan = await explain(
        harness.db,
        `with visible as (
           select c.id, c.embedding, c.content_tsv
             from public.knowledge_chunks c
             join public.knowledge_documents d on d.id = c.document_id
            where c.knowledge_scope_id = '${SCOPE}'
              and d.indexed = true
              and d.status = 'indexed'
              and c.version = d.version
         )
         select id from (
           (select id from visible
             order by embedding operator(extensions.<=>) '${vectorLiteral}'::extensions.vector
             limit 8)
           union all
           (select id from visible where content_tsv @@ plainto_tsquery('english', 'late') limit 8)
         ) old_shape`,
      );

      expect(vectorPlan, vectorPlan).toContain("knowledge_chunks_embedding_idx");
      expect(keywordPlan, keywordPlan).toContain("knowledge_chunks_content_tsv_idx");
      expect(materializedPlan, materializedPlan).not.toContain("knowledge_chunks_embedding_idx");
      expect(materializedPlan, materializedPlan).not.toContain("knowledge_chunks_content_tsv_idx");
    } finally {
      await harness.close();
    }
  }, 60_000);
});

async function explain(db: { query: (sql: string) => Promise<{ rows: { "QUERY PLAN": string }[] }> }, sql: string) {
  const result = await db.query(`explain (costs off) ${sql}`);
  return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
}

async function insertDocument(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  input: { id: string; title: string; category: string; file: string },
) {
  await db.query(
    `insert into public.knowledge_documents (
       id, knowledge_scope_id, title, description, category, tags, original_filename, mime_type, file_type,
       storage_path, size_bytes, character_count, source, status, indexed, version, previous_versions,
       uploaded_by_name, indexed_at
     ) values (
       $1, $2, $3, '', $4, '{}', $5, 'text/plain', 'txt', $6, 100, 100, 'upload', 'indexed', true, 1, '[]', 'fixture', now()
     )`,
    [input.id, SCOPE, input.title, input.category, input.file, `${SCOPE}/${input.id}/1/${input.file}`],
  );
}

async function insertChunk(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  input: {
    documentId: string;
    index: number;
    section: string;
    page: number;
    content: string;
    embedding: readonly number[];
  },
) {
  await db.query(
    `insert into public.knowledge_chunks (
       document_id, knowledge_scope_id, chunk_index, version, content, locator, page, section,
       embedding_model, embedding
     ) values (
       $1, $2, $3, 1, $4, $5, $6, $7, 'bag-of-words-test', $8::extensions.vector
     )`,
    [
      input.documentId,
      SCOPE,
      input.index,
      input.content,
      `Page ${input.page} — ${input.section}`,
      input.page,
      input.section,
      `[${input.embedding.join(",")}]`,
    ],
  );
}

/** A unit vector that is not the framework embedding. Seeded so the plan is stable. */
function unitNoise(dimensions: number, seed: number): number[] {
  const values = Array.from({ length: dimensions }, (_, index) => {
    const n = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
    return n - Math.floor(n) - 0.5;
  });
  const norm = Math.hypot(...values) || 1;
  return values.map((value) => value / norm);
}
