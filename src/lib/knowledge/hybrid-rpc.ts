import "server-only";

import { RETRIEVAL } from "@/lib/config/models";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { MatchedChunkRow } from "./mappers";

/**
 * Stop waiting on match_knowledge_chunks_hybrid before its 6s
 * statement_timeout, and answer from match_knowledge_chunks instead.
 * The abandoned hybrid call still ends when the function timeout fires.
 */
export const HYBRID_RPC_BUDGET_MS = 5_000;

export interface HybridRpcRow extends MatchedChunkRow {
  vector_rank: number | null;
  keyword_rank: number | null;
  section_exact: boolean | null;
}

interface RpcError {
  message: string;
}

interface RpcResult<T> {
  data: T | null;
  error: RpcError | null;
}

function warnHybridFallback(reason: "timeout" | "rpc_error"): void {
  // The question is not included. A PostgREST error can echo the payload.
  console.warn(
    `[knowledge] hybrid retrieval ${reason}; falling back to match_knowledge_chunks`,
  );
}

/**
 * The same RPC `SupabaseKnowledgeProvider.match` calls. The embedding already
 * computed for the hybrid attempt is reused, so a slow hybrid call does not
 * pay for a second embed.
 */
async function matchKnowledgeChunks(input: {
  readonly queryEmbedding: readonly number[];
  readonly scopeId: string;
  readonly limit: number;
  readonly categories: readonly string[] | null;
}): Promise<MatchedChunkRow[]> {
  const { data, error } = await getSupabaseAdmin().rpc("match_knowledge_chunks", {
    query_embedding: [...input.queryEmbedding],
    scope_id: input.scopeId,
    match_count: input.limit,
    min_similarity: RETRIEVAL.minSimilarity,
    filter_categories: input.categories?.length ? [...input.categories] : null,
  });
  if (error) {
    throw new Error(`Knowledge retrieval failed: ${error.message}`);
  }
  return (data ?? []) as MatchedChunkRow[];
}

export async function loadHybridOrVector(input: {
  readonly queryEmbedding: readonly number[];
  readonly queryText: string;
  readonly scopeId: string;
  readonly hybridMatchCount: number;
  readonly hybridMinSimilarity: number;
  readonly filterCategories: readonly string[] | null;
  readonly fallbackLimit: number;
}): Promise<
  | { readonly kind: "hybrid"; readonly rows: HybridRpcRow[] }
  | { readonly kind: "fallback"; readonly rows: MatchedChunkRow[] }
> {
  const categories = input.filterCategories?.length ? [...input.filterCategories] : null;
  let abandoned = false;
  const pending = Promise.resolve(
    getSupabaseAdmin().rpc("match_knowledge_chunks_hybrid", {
      query_embedding: [...input.queryEmbedding],
      query_text: input.queryText,
      scope_id: input.scopeId,
      match_count: input.hybridMatchCount,
      min_similarity: input.hybridMinSimilarity,
      filter_categories: categories,
    }) as PromiseLike<RpcResult<HybridRpcRow[]>>,
  ).then(
    (result) => result,
    () => ({ data: null, error: { message: abandoned ? "" : "hybrid rpc failed" } }) satisfies RpcResult<HybridRpcRow[]>,
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("hybrid retrieval exceeded 5s")), HYBRID_RPC_BUDGET_MS);
  });

  try {
    const result = await Promise.race([pending, timeout]);
    if (result.error) {
      abandoned = true;
      warnHybridFallback("rpc_error");
      return {
        kind: "fallback",
        rows: await matchKnowledgeChunks({
          queryEmbedding: input.queryEmbedding,
          scopeId: input.scopeId,
          limit: input.fallbackLimit,
          categories,
        }),
      };
    }
    return { kind: "hybrid", rows: result.data ?? [] };
  } catch {
    abandoned = true;
    warnHybridFallback("timeout");
    return {
      kind: "fallback",
      rows: await matchKnowledgeChunks({
        queryEmbedding: input.queryEmbedding,
        scopeId: input.scopeId,
        limit: input.fallbackLimit,
        categories,
      }),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
