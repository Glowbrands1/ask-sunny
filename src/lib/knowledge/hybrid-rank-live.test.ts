import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { expandGlossaryQuery } from "@/lib/ai/glossary";
import { applyRerank } from "@/lib/ai/retrieval-rerank";
import { EMBEDDING_DIMENSIONS, RETRIEVAL } from "@/lib/config/models";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import { createMigratedTestDatabase } from "@/test/pglite-knowledge-db";

import { passageHeading, policyManualBoost, RRF_K, sectionTitleMatches } from "./hybrid-rank";
import type { MatchedChunkRow } from "./mappers";
import { sectionIsNamed, selectRecallCandidates, type RecallCandidate } from "./recall-rank";

/**
 * The four questions that regressed once both retrieval flags were on.
 * Vectors are the production gte-small embeddings of those questions (after
 * the same glossary expansion recall embeds), not a chunk matched to itself.
 * Headings are whatever the rows carry. Nothing here names the expected policy.
 */

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

const QUESTIONS = [
  "can employees swap shifts",
  "what is the policy if an employee showed up late 3 times this month",
  "late 3 times",
  "rude to a customer",
] as const;

const SCOPE = "live-rank";
const MANUAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const FRAMEWORK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

interface LiveChunk {
  id: string;
  section: string;
  page: number;
  contentSha256: string;
  embedding: number[];
  category: string;
  title: string;
  content?: string;
}

interface LiveFile {
  model: string;
  questions: { text: string; embedding: number[] }[];
  chunks: LiveChunk[];
}

interface RpcRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  category: string;
  locator: string;
  page: number;
  section: string | null;
  content: string;
  similarity: number;
  vector_rank: number | null;
  keyword_rank: number | null;
  section_exact: boolean;
}

const live = JSON.parse(readFileSync("src/lib/knowledge/live-question-embeddings.json", "utf8")) as LiveFile;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function contentFor(chunk: LiveChunk): string {
  if (chunk.content) return chunk.content;
  const fixture = JBA_MANUAL_CA_CHUNKS.find((row) => row.chunkId === chunk.id);
  if (!fixture) throw new Error(`no stand-in text for ${chunk.id}`);
  return fixture.content;
}

/** The ranker that shipped with the flags: reciprocal rank, and a heading only when `section` is set. */
function legacyRecall(candidates: readonly RecallCandidate[], query: string, limit: number): RecallCandidate[] {
  const scored = candidates.map((candidate) => {
    const named = sectionIsNamed(query, candidate.row.section, candidate.sectionExact);
    const sqlFuzzy = typeof candidate.sectionSimilarity === "number" && candidate.sectionSimilarity >= 0.3;
    let score = 0;
    if (candidate.vectorRank && candidate.vectorRank > 0) score += 1 / (RRF_K + candidate.vectorRank);
    if (candidate.keywordRank && candidate.keywordRank > 0) score += 1 / (RRF_K + candidate.keywordRank);
    if (named || sqlFuzzy) score += 1;
    score += candidate.sectionSimilarity ?? 0;
    score += policyManualBoost(query, candidate.row);
    return { candidate, named, keep: named || sqlFuzzy, score };
  });
  scored.sort((a, b) => b.score - a.score || b.candidate.row.similarity - a.candidate.row.similarity);
  const chosen: typeof scored = [];
  const seen = new Set<string>();
  for (const item of scored) {
    if (seen.has(item.candidate.row.chunk_id)) continue;
    if (item.keep || chosen.length < limit) {
      chosen.push(item);
      seen.add(item.candidate.row.chunk_id);
    }
  }
  chosen.sort((a, b) => Number(b.named) - Number(a.named) || b.score - a.score);
  return chosen.map((item) => item.candidate);
}

function headingNamed(query: string, row: MatchedChunkRow, exact = false): boolean {
  return sectionIsNamed(query, passageHeading(row), exact) || sectionTitleMatches(query, passageHeading(row));
}

/** Keyword rank may nudge by at most 0.001. A larger inversion is the old reciprocal-rank bug. */
function unnamedInSimilarityOrder(rows: readonly MatchedChunkRow[], query: string): boolean {
  const unnamed = rows.filter((row) => !headingNamed(query, row));
  for (let index = 1; index < unnamed.length; index += 1) {
    if (unnamed[index - 1].similarity + 0.001 < unnamed[index].similarity) return false;
  }
  return true;
}

describe("live question embeddings stay in cosine order", () => {
  it("keeps each question's neighbor ahead of an OR keyword hit", async () => {
    expect(live.model).toBe("gte-small");
    expect(live.questions.map((question) => question.text)).toEqual([...QUESTIONS]);
    const byId = new Map(live.chunks.map((chunk) => [chunk.id, chunk]));
    for (const chunk of live.chunks) {
      expect(chunk.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(sha256(contentFor(chunk)), chunk.id).toBe(chunk.contentSha256);
    }
    for (const question of live.questions) expect(question.embedding).toHaveLength(EMBEDDING_DIMENSIONS);

    const harness = await createMigratedTestDatabase(PRIOR);
    try {
      await insertDocument(harness.db, {
        id: MANUAL,
        title: "JBA Policy Manual Edited 5.2025",
        category: "policies_compliance",
      });
      await insertDocument(harness.db, {
        id: FRAMEWORK,
        title: "Performance Management Framework",
        category: "leadership_coaching",
      });
      const indexByChunk = new Map<string, string>();
      for (const chunk of live.chunks) {
        const documentId = chunk.id === "pmf" ? FRAMEWORK : MANUAL;
        const chunkIndex = chunk.id === "pmf" ? 0 : chunk.id === "buddy" ? 1001 : chunk.id === "start" ? 1002 : Number(chunk.id.slice(4));
        await insertChunk(harness.db, {
          documentId,
          index: chunkIndex,
          section: chunk.section,
          page: chunk.page,
          content: contentFor(chunk),
          embedding: chunk.embedding,
        });
        indexByChunk.set(`${documentId}:${chunkIndex}`, chunk.id);
      }
      const stored = await harness.db.query<{ id: string; document_id: string; chunk_index: number }>(
        `select id, document_id, chunk_index from public.knowledge_chunks where knowledge_scope_id = $1`,
        [SCOPE],
      );
      const fixtureByUuid = new Map<string, string>();
      for (const row of stored.rows) {
        const fixtureId = indexByChunk.get(`${row.document_id}:${row.chunk_index}`);
        if (fixtureId) fixtureByUuid.set(row.id, fixtureId);
      }

      const legacyOrders: boolean[] = [];

      for (const question of live.questions) {
        const expanded = expandGlossaryQuery(question.text);
        const matched = await harness.db.query<RpcRow>(
          `select chunk_id, document_id, document_title, category, locator, page, section, content,
                  similarity, vector_rank, keyword_rank, section_exact
             from public.match_knowledge_chunks_hybrid(
               $1::extensions.vector, $2, $3, 20, 0, null
             )`,
          [`[${question.embedding.join(",")}]`, expanded, SCOPE],
        );
        const candidates = matched.rows.map(toCandidate);
        const nearest = [...byId.values()].reduce((best, chunk) =>
          cosine(question.embedding, chunk.embedding) > cosine(question.embedding, best.embedding) ? chunk : best,
        );
        const vectorBest = candidates.find((candidate) => candidate.vectorRank === 1);
        expect(vectorBest, question.text).toBeTruthy();
        expect(fixtureByUuid.get(vectorBest?.row.chunk_id ?? ""), question.text).toBe(nearest.id);

        const legacy = legacyRecall(candidates, expanded, RETRIEVAL.contextChunks);
        const selected = selectRecallCandidates(candidates, expanded, { limit: RETRIEVAL.topK });
        const answer = selected.rows.slice(0, RETRIEVAL.contextChunks);
        const anyNamed = candidates.some((candidate) =>
          headingNamed(expanded, candidate.row, candidate.sectionExact),
        );
        if (anyNamed) {
          expect(headingNamed(expanded, answer[0], false), question.text).toBe(true);
        } else {
          expect(answer[0]?.chunk_id, question.text).toBe(vectorBest?.row.chunk_id);
        }
        expect(answer.some((row) => row.chunk_id === vectorBest?.row.chunk_id) || anyNamed, question.text).toBe(true);
        expect(Math.max(...answer.map((row) => row.similarity)), question.text).toBeGreaterThanOrEqual(
          RETRIEVAL.minSimilarity,
        );

        const named = candidates.filter((candidate) => headingNamed(expanded, candidate.row, candidate.sectionExact));
        const leaderPool = named.length > 0 ? named : candidates;
        const leader = leaderPool.reduce((best, candidate) =>
          candidate.row.similarity > best.row.similarity ? candidate : best,
        );
        expect(answer[0]?.chunk_id, question.text).toBe(leader.row.chunk_id);
        expect(unnamedInSimilarityOrder(answer, expanded), question.text).toBe(true);
        legacyOrders.push(unnamedInSimilarityOrder(legacy.map((candidate) => candidate.row), expanded));

        /*
         * Heading-only Haiku returned no ids. A neighbor that was not pinned
         * disappeared, which is the "nothing on this" answer. The fast path
         * keeps the fused rows once a neighbor has cleared the floor.
         */
        if (!selected.pinnedIds.includes(vectorBest?.row.chunk_id ?? "")) {
          const dropped = applyRerank(selected.rows, [], selected.pinnedIds);
          expect(dropped.some((row) => row.chunk_id === vectorBest?.row.chunk_id), question.text).toBe(false);
          if (!anyNamed) expect(answer[0]?.chunk_id, question.text).toBe(vectorBest?.row.chunk_id);
        }
      }
      expect(legacyOrders.some((sorted) => !sorted)).toBe(true);

      const swap = live.questions[0];
      const swapRows = await harness.db.query<RpcRow>(
        `select chunk_id, document_id, document_title, category, locator, page, section, content,
                similarity, vector_rank, keyword_rank, section_exact
           from public.match_knowledge_chunks_hybrid(
             $1::extensions.vector, $2, $3, 20, 0, null
           )`,
        [`[${swap.embedding.join(",")}]`, expandGlossaryQuery(swap.text), SCOPE],
      );
      const swapCandidates = swapRows.rows.map(toCandidate);
      const swapBest = swapCandidates.find((candidate) => candidate.vectorRank === 1);
      expect(swapBest).toBeTruthy();
      const dualListed = swapCandidates
        .filter(
          (candidate) =>
            candidate.row.chunk_id !== swapBest?.row.chunk_id &&
            candidate.keywordRank !== null &&
            candidate.vectorRank !== null,
        )
        .map((candidate) => ({
          ...candidate,
          row: { ...candidate.row, section: null, locator: "Text" },
          sectionExact: false,
        }));
      expect(dualListed.length).toBeGreaterThan(0);
      const missed: RecallCandidate = {
        ...swapBest!,
        row: {
          ...swapBest!.row,
          chunk_id: `${swapBest!.row.chunk_id}-missed`,
          section: null,
          locator: "Text",
        },
        keywordRank: null,
        sectionExact: false,
        sectionSimilarity: null,
      };
      const crowded = [...dualListed, missed];
      const window = dualListed.length;
      const before = legacyRecall(crowded, expandGlossaryQuery(swap.text), window);
      const after = selectRecallCandidates(crowded, expandGlossaryQuery(swap.text), { limit: window });
      expect(before[0]?.row.chunk_id).not.toBe(missed.row.chunk_id);
      expect(before.some((candidate) => candidate.row.chunk_id === missed.row.chunk_id)).toBe(false);
      expect(after.rows[0]?.chunk_id).toBe(missed.row.chunk_id);
    } finally {
      await harness.close();
    }
  }, 60_000);
});

function toCandidate(row: RpcRow): RecallCandidate {
  return {
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
    sectionExact: Boolean(row.section_exact),
    sectionSimilarity: null,
  };
}

async function insertDocument(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  input: { id: string; title: string; category: string },
) {
  await db.query(
    `insert into public.knowledge_documents (
       id, knowledge_scope_id, title, description, category, tags, original_filename, mime_type, file_type,
       storage_path, size_bytes, character_count, source, status, indexed, version, previous_versions,
       uploaded_by_name, indexed_at
     ) values (
       $1, $2, $3, '', $4, '{}', $5, 'text/plain', 'txt', $6, 100, 100, 'upload',
       'indexed'::public.knowledge_document_status, true, 1, '[]', 'fixture', now()
     )`,
    [input.id, SCOPE, input.title, input.category, `${input.id}.txt`, `${SCOPE}/${input.id}/1/${input.id}.txt`],
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
       $1, $2, $3, 1, $4, $5, $6, $7, 'gte-small', $8::extensions.vector
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
