import { describe, expect, it } from "vitest";

import { expandGlossaryQuery } from "@/lib/ai/glossary";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import { selectHybridMatches, type HybridCandidate } from "@/lib/knowledge/hybrid-rank";
import { selectRecallCandidates } from "@/lib/knowledge/recall-rank";

/**
 * Production question. The glossary names Attendance for "showed up late" /
 * "late 3 times", and that heading has to lead a nearer framework chunk.
 * Keyword rank alone must not do it: a reciprocal keyword term was enough to
 * bury the question embedding's nearest neighbor.
 */

const Q1 = "what is the policy if an employee showed up late 3 times this month";

function row(input: {
  id: string;
  title: string;
  category: string;
  section: string;
  page: number;
  similarity: number;
  content: string;
}): MatchedChunkRow {
  return {
    chunk_id: input.id,
    document_id: input.id,
    document_title: input.title,
    category: input.category,
    locator: `Page ${input.page} — ${input.section}`,
    page: input.page,
    section: input.section,
    content: input.content,
    similarity: input.similarity,
  };
}

const attendance = row({
  id: "attendance",
  title: "JBA Policy Manual Edited 5.2025",
  category: "policies_compliance",
  section: "Attendance",
  page: 15,
  similarity: 0.41,
  content: "Attendance. When an employee is late, the late arrival is recorded.",
});

const framework = row({
  id: "pmf",
  title: "Performance Management Framework",
  category: "leadership_coaching",
  section: "Performance Management Ladder",
  page: 2,
  similarity: 0.93,
  content: "Performance Management Framework. Coaching comes before a written step on the ladder.",
});

const candidates: HybridCandidate[] = [
  { row: framework, vectorRank: 1, keywordRank: null, sectionExact: false },
  { row: attendance, vectorRank: null, keywordRank: 1, sectionExact: false },
];

describe("policy questions prefer the JBA manual over the framework", () => {
  it("ranks the Attendance chunk above the Performance Management Framework for the late-arrival question", () => {
    const ranked = selectHybridMatches(candidates, expandGlossaryQuery(Q1), { vectorFloor: 0.78, limit: 4 });
    expect(ranked.map((item) => item.section)).toEqual(["Attendance", "Performance Management Ladder"]);
    expect(ranked[0]).toMatchObject({ section: "Attendance", page: 15, document_title: "JBA Policy Manual Edited 5.2025" });
  });

  it("keeps the same order on the recall selector", () => {
    const ranked = selectRecallCandidates(
      candidates.map((candidate) => ({ ...candidate, sectionSimilarity: null })),
      expandGlossaryQuery(Q1),
      { limit: 4 },
    );
    expect(ranked.rows[0]?.section).toBe("Attendance");
    expect(ranked.rows.findIndex((item) => item.section === "Attendance")).toBeLessThan(
      ranked.rows.findIndex((item) => item.chunk_id === "pmf"),
    );
  });

  it("does not prefer the manual when the question is not a policy question", () => {
    const ranked = selectHybridMatches(candidates, "how do I coach this employee", {
      vectorFloor: 0.78,
      limit: 4,
    });
    expect(ranked[0]?.section).toBe("Performance Management Ladder");
  });
});
