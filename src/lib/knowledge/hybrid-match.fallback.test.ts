import { beforeEach, describe, expect, it, vi } from "vitest";

import { HYBRID_RPC_BUDGET_MS } from "@/lib/knowledge/hybrid-rpc";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";

/**
 * Hybrid and recall both call match_knowledge_chunks_hybrid. An error or a
 * call past about 5s must return match_knowledge_chunks instead of throwing,
 * which is what turns a statement_timeout into "The company knowledge base
 * could not be searched".
 */

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

vi.mock("@/lib/embeddings", async () => {
  const { EMBEDDING_DIMENSIONS } = await import("@/lib/config/models");
  return {
    getEmbeddingProvider: () => ({
      dimensions: EMBEDDING_DIMENSIONS,
      embedQuery: async () => [0.2, 0.1, 0.4],
    }),
  };
});

const QUESTION = "what is the policy if an employee showed up late 3 times this month";

const fallbackRow: MatchedChunkRow = {
  chunk_id: "vector-attendance",
  document_id: "manual",
  document_title: "JBA Policy Manual",
  category: "policies_compliance",
  locator: "Page 15 — Attendance",
  page: 15,
  section: "Attendance",
  content: "Attendance. When an employee is late, the late arrival is recorded.",
  similarity: 0.84,
};

const hybridRow = {
  ...fallbackRow,
  chunk_id: "hybrid-attendance",
  similarity: 0.9,
  vector_rank: 1,
  keyword_rank: 1,
  section_exact: false,
};

function hybridError() {
  return Promise.resolve({
    data: null,
    error: { message: "canceling statement due to statement timeout" },
  });
}

function vectorHit() {
  return Promise.resolve({ data: [fallbackRow], error: null });
}

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("hybrid retrieval falls back to match_knowledge_chunks", () => {
  it("returns the vector rows when the hybrid RPC errors, and does not log the question", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "match_knowledge_chunks_hybrid") return hybridError();
      if (name === "match_knowledge_chunks") return vectorHit();
      throw new Error(`unexpected rpc ${name}`);
    });
    const { matchHybridKnowledge } = await import("./hybrid-match");
    const rows = await matchHybridKnowledge({ query: QUESTION, scopeId: "scope", limit: 4 });
    expect(rows).toEqual([fallbackRow]);
    expect(rpc).toHaveBeenCalledWith(
      "match_knowledge_chunks",
      expect.objectContaining({ scope_id: "scope", match_count: 4 }),
    );
    const warnings = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(warnings).toContain("match_knowledge_chunks");
    expect(warnings).not.toContain(QUESTION);
    expect(warnings).not.toContain("showed up late");
  });

  it("returns the vector rows when the hybrid RPC exceeds about 5s", async () => {
    vi.useFakeTimers();
    rpc.mockImplementation((name: string) => {
      if (name === "match_knowledge_chunks_hybrid") return new Promise(() => {});
      if (name === "match_knowledge_chunks") return vectorHit();
      throw new Error(`unexpected rpc ${name}`);
    });
    const { matchHybridKnowledge } = await import("./hybrid-match");
    const pending = matchHybridKnowledge({ query: QUESTION, scopeId: "scope", limit: 4 });
    await vi.advanceTimersByTimeAsync(HYBRID_RPC_BUDGET_MS);
    await expect(pending).resolves.toEqual([fallbackRow]);
    expect(rpc).toHaveBeenCalledWith("match_knowledge_chunks", expect.any(Object));
    vi.useRealTimers();
  });

  it("does not call the vector RPC when hybrid succeeds", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "match_knowledge_chunks_hybrid") {
        return Promise.resolve({ data: [hybridRow], error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    const { matchHybridKnowledge } = await import("./hybrid-match");
    const rows = await matchHybridKnowledge({ query: QUESTION, scopeId: "scope", limit: 4 });
    expect(rows.map((row) => row.chunk_id)).toEqual(["hybrid-attendance"]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back from recall on a hybrid RPC error instead of throwing", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "match_knowledge_chunks_hybrid") return hybridError();
      if (name === "match_knowledge_chunks") return vectorHit();
      throw new Error(`unexpected rpc ${name}`);
    });
    const { matchRecallKnowledge } = await import("./recall-match");
    const rows = await matchRecallKnowledge({ query: QUESTION, scopeId: "scope", limit: 4 });
    expect(rows).toEqual([fallbackRow]);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "match_knowledge_chunks_hybrid",
      "match_knowledge_chunks",
    ]);
  });
});
