import "server-only";

import { z } from "zod";

import { applyRerank } from "@/lib/ai/retrieval-rerank";
import { callClaudeTool } from "@/lib/ai/call-claude";
import { expandGlossaryQuery } from "@/lib/ai/glossary";
import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import { EMBEDDING_DIMENSIONS, RETRIEVAL } from "@/lib/config/models";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { MatchedChunkRow } from "./mappers";
import { loadHybridOrVector, type HybridRpcRow } from "./hybrid-rpc";
import { selectRecallCandidates, type RecallCandidate } from "./recall-rank";

/**
 * Keyword + vector candidates with no similarity floor, fuzzy headings, and
 * a Haiku pick. Called only when RETRIEVAL_RECALL_ENABLED is on.
 *
 * There was no reranker before this flag. A Haiku failure keeps the fused
 * order, including every section the question or the glossary named. An RPC
 * error or a call past about 5s returns match_knowledge_chunks instead of
 * failing the turn.
 */

const pickSchema = z.object({ ids: z.array(z.string()) });

interface FuzzyRpcRow extends MatchedChunkRow {
  section_similarity: number | null;
}

function toRecall(row: HybridRpcRow, sectionSimilarity: number | null): RecallCandidate {
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
    vectorRank: row.vector_rank === null || row.vector_rank === undefined ? null : Number(row.vector_rank),
    keywordRank: row.keyword_rank === null || row.keyword_rank === undefined ? null : Number(row.keyword_rank),
    sectionExact: Boolean(row.section_exact),
    sectionSimilarity,
  };
}

async function fuzzyRows(query: string, scopeId: string, limit: number): Promise<FuzzyRpcRow[]> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("match_knowledge_sections_fuzzy", {
      query_text: query,
      scope_id: scopeId,
      match_count: Math.min(50, Math.max(limit, 8)),
      min_similarity: 0.3,
    });
    if (error) return [];
    return (data ?? []) as FuzzyRpcRow[];
  } catch {
    return [];
  }
}

async function pickIds(query: string, rows: readonly MatchedChunkRow[]): Promise<string[] | null> {
  try {
    const listed = rows
      .map((row) => {
        const excerpt = row.content.replace(/\s+/g, " ").trim().slice(0, 400);
        return `${row.chunk_id}\t${row.section ?? ""}\t${row.document_title}\t${excerpt}`;
      })
      .join("\n");
    const raw = await callClaudeTool({
      model: CLAUDE_HAIKU_MODEL,
      maxTokens: 300,
      system:
        "Pick the passages that answer the question. The heading often uses different words than the question; read the excerpt. Return their ids in the order they should be read. Return an empty ids list when none of them answer it.",
      tool: {
        name: "pick_passages",
        description: "The passage ids to keep, in reading order.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["ids"],
          properties: { ids: { type: "array", items: { type: "string" } } },
        },
      },
      messages: [{ role: "user", content: `Question:\n${query}\n\nPassages:\n${listed}` }],
    });
    const parsed = pickSchema.safeParse(raw);
    return parsed.success ? parsed.data.ids : null;
  } catch {
    return null;
  }
}

export async function matchRecallKnowledge(input: {
  readonly query: string;
  readonly scopeId: string;
  readonly limit?: number;
}): Promise<MatchedChunkRow[]> {
  const limit = input.limit ?? RETRIEVAL.topK;
  const keywordQuery = expandGlossaryQuery(input.query.trim());
  if (!keywordQuery) return [];

  const embeddings = getEmbeddingProvider();
  if (embeddings.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error("The configured embedding model does not match the database vector width.");
  }
  const queryEmbedding = await embeddings.embedQuery(keywordQuery);
  const loaded = await loadHybridOrVector({
    queryEmbedding,
    queryText: keywordQuery,
    scopeId: input.scopeId,
    hybridMatchCount: Math.min(50, Math.max(limit, 20)),
    hybridMinSimilarity: 0,
    filterCategories: null,
    fallbackLimit: limit,
  });
  if (loaded.kind === "fallback") return loaded.rows;

  const hybrid = loaded.rows.map((row) => toRecall(row, null));
  const bestHybrid = hybrid.reduce((max, candidate) => Math.max(max, candidate.row.similarity), 0);
  /*
   * A question the embedding already places above the floor used to wait on
   * a heading-only Haiku pick. That pick dropped the neighbor (the heading
   * did not say "swap" or "rude") and added a model round trip, which is why
   * answers took 12–25s and cited a different page. The fused order is the
   * answer. The fuzzy heading scan and Haiku run only when nothing cleared
   * the floor.
   */
  if (bestHybrid >= RETRIEVAL.minSimilarity) {
    return selectRecallCandidates(hybrid, keywordQuery, { limit }).rows;
  }

  const fuzzy = await fuzzyRows(keywordQuery, input.scopeId, limit);
  const similarityById = new Map(fuzzy.map((row) => [row.chunk_id, Number(row.section_similarity)]));
  const fused: RecallCandidate[] = hybrid.map((candidate) => ({
    ...candidate,
    sectionSimilarity: similarityById.get(candidate.row.chunk_id) ?? null,
  }));
  const seen = new Set(fused.map((candidate) => candidate.row.chunk_id));
  for (const row of fuzzy) {
    if (seen.has(row.chunk_id)) continue;
    fused.push(
      toRecall(
        { ...row, similarity: 0, vector_rank: null, keyword_rank: null, section_exact: false },
        Number(row.section_similarity),
      ),
    );
  }

  const selected = selectRecallCandidates(fused, keywordQuery, { limit });

  const picked = await pickIds(keywordQuery, selected.rows);
  return applyRerank(selected.rows, picked, selected.pinnedIds);
}
