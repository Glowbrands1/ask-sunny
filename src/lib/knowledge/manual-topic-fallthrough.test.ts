import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchedChunkRow } from "@/lib/knowledge/mappers";

/**
 * The 0.78 short-circuit, the reporters' questions, and the two sections
 * that already rank: cell phone (printed page 19) and attendance (printed
 * page 14). The flag is off unless a test turns it on.
 */

const rpc = vi.hoisted(() => vi.fn());
const claude = vi.hoisted(() => vi.fn());

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

vi.mock("@/lib/ai/call-claude", () => ({
  callClaudeTool: (...args: unknown[]) => claude(...args),
}));

const QUESTIONS = {
  timeOff: "How do I request time off?",
  sick: "How many sick days do I get?",
  w2: "How do I get my W-2?",
  deposit: "How do I update my direct deposit?",
  cell: "What does the cell phone policy say?",
  attendance: "What does the attendance policy say?",
  sunday: "what time do we open on Sunday",
} as const;

function hybrid(input: {
  id: string;
  title: string;
  section: string | null;
  locator: string;
  similarity: number;
  content?: string;
}) {
  return {
    chunk_id: input.id,
    document_id: input.title.startsWith("JBA") ? "manual" : "other",
    document_title: input.title,
    category: "operations",
    locator: input.locator,
    page: 1,
    section: input.section,
    content: input.content ?? input.section ?? "text",
    similarity: input.similarity,
    vector_rank: 1,
    keyword_rank: null,
    section_exact: false,
  };
}

const MYGLOW = hybrid({
  id: "myglow",
  title: "myGlow Guide",
  section: "Pay",
  locator: "Page 4 — Pay",
  similarity: 0.9,
  content: "Update pay in myGlow.",
});

const CELL = hybrid({
  id: "jba-cell",
  title: "JBA Policy Manual Edited 5.2025",
  section: "Cell Phone/Smart Watch Policy",
  locator: "Page 19 — Cell Phone/Smart Watch Policy",
  similarity: 0.9,
});

const ATTENDANCE = hybrid({
  id: "jba-attendance",
  title: "JBA Policy Manual Edited 5.2025",
  section: "Attendance",
  locator: "Page 14 — Attendance",
  similarity: 0.9,
});

const W2 = hybrid({
  id: "jba-w2",
  title: "JBA Policy Manual Edited 5.2025",
  section: "Liquidating 401K",
  locator: "Page 36 — Liquidating 401K",
  similarity: 0.885,
  content: "Accessing W-2's. Paycor lists the form.",
});

function fuzzyManual() {
  return {
    chunk_id: "fuzzy-manual",
    document_id: "manual",
    document_title: "JBA Policy Manual Edited 5.2025",
    category: "policies_compliance",
    locator: "Page 38 — Pay Periods",
    page: 39,
    section: "Pay Periods",
    content: "Pay Periods. Direct deposit is required.",
    similarity: 0.4,
    section_similarity: 0.8,
  };
}

function names(): string[] {
  return rpc.mock.calls.map((call) => call[0] as string);
}

async function recall(query: string, rows: readonly unknown[], question?: string): Promise<MatchedChunkRow[]> {
  rpc.mockClear();
  claude.mockClear();
  rpc.mockImplementation((name: string) => {
    if (name === "match_knowledge_chunks_hybrid") return Promise.resolve({ data: rows, error: null });
    if (name === "match_knowledge_sections_fuzzy") return Promise.resolve({ data: [fuzzyManual()], error: null });
    throw new Error(`unexpected rpc ${name}`);
  });
  claude.mockResolvedValue({ ids: ["fuzzy-manual"] });
  const { matchRecallKnowledge } = await import("./recall-match");
  return matchRecallKnowledge({ query, scopeId: "stc-core", limit: 8, question: question ?? query });
}

beforeEach(() => {
  delete process.env.MANUAL_TOPIC_PIN_ENABLED;
  rpc.mockReset();
  claude.mockReset();
});

afterEach(() => {
  delete process.env.MANUAL_TOPIC_PIN_ENABLED;
});

describe("flag off keeps the similarity short-circuit", () => {
  it.each([QUESTIONS.timeOff, QUESTIONS.sick, QUESTIONS.w2, QUESTIONS.deposit, QUESTIONS.cell, QUESTIONS.attendance])(
    "%s does not scan headings",
    async (question) => {
      const rows = await recall(question, [MYGLOW]);
      expect(names()).toEqual(["match_knowledge_chunks_hybrid"]);
      expect(rows.map((row) => row.chunk_id)).toEqual(["myglow"]);
      expect(claude).not.toHaveBeenCalled();
    },
  );
});

describe("flag on scans only when the current manual is missing", () => {
  beforeEach(() => {
    process.env.MANUAL_TOPIC_PIN_ENABLED = "1";
  });

  it("scans direct deposit when the window is another document", async () => {
    const rows = await recall(QUESTIONS.deposit, [MYGLOW]);
    expect(names()).toEqual(["match_knowledge_chunks_hybrid", "match_knowledge_sections_fuzzy"]);
    expect(rows.some((row) => row.chunk_id === "fuzzy-manual")).toBe(true);
  });

  it("scans time off and sick days the same way", async () => {
    for (const question of [QUESTIONS.timeOff, QUESTIONS.sick]) {
      await recall(question, [MYGLOW]);
      expect(names()).toContain("match_knowledge_sections_fuzzy");
    }
  });

  it("scans W-2 from the original question when the rewrite dropped it", async () => {
    const rows = await recall("payroll forms", [MYGLOW], QUESTIONS.w2);
    expect(names()).toContain("match_knowledge_sections_fuzzy");
    expect(rows.some((row) => row.chunk_id === "fuzzy-manual")).toBe(true);
  });

  it("does not scan W-2 when the manual chunk is already in the window", async () => {
    const rows = await recall(QUESTIONS.w2, [W2, MYGLOW]);
    expect(names()).toEqual(["match_knowledge_chunks_hybrid"]);
    expect(rows.map((row) => row.chunk_id)).toContain("jba-w2");
    expect(claude).not.toHaveBeenCalled();
  });

  it("does not scan cell phone when printed page 19 is already in the window", async () => {
    const rows = await recall(QUESTIONS.cell, [CELL, MYGLOW]);
    expect(names()).toEqual(["match_knowledge_chunks_hybrid"]);
    expect(rows.map((row) => row.locator)).toContain("Page 19 — Cell Phone/Smart Watch Policy");
    expect(rows.map((row) => row.chunk_id)).toContain("myglow");
    expect(claude).not.toHaveBeenCalled();
  });

  it("does not scan attendance when printed page 14 is already in the window", async () => {
    const rows = await recall(QUESTIONS.attendance, [ATTENDANCE, MYGLOW]);
    expect(names()).toEqual(["match_knowledge_chunks_hybrid"]);
    expect(rows.map((row) => row.locator)).toContain("Page 14 — Attendance");
    expect(claude).not.toHaveBeenCalled();
  });

  it("does scan cell phone when the window has no manual chunk", async () => {
    await recall(QUESTIONS.cell, [MYGLOW]);
    expect(names()).toContain("match_knowledge_sections_fuzzy");
  });

  it("does not scan a Sunday hours question", async () => {
    const rows = await recall(QUESTIONS.sunday, [MYGLOW]);
    expect(names()).toEqual(["match_knowledge_chunks_hybrid"]);
    expect(rows.map((row) => row.chunk_id)).toEqual(["myglow"]);
  });
});
