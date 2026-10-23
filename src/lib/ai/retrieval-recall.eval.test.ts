import { describe, expect, it } from "vitest";

import { expandGlossaryQuery } from "@/lib/ai/glossary";
import { applyRerank } from "@/lib/ai/retrieval-rerank";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import { selectRecallCandidates, sectionFuzzyMatches, type RecallCandidate } from "@/lib/knowledge/recall-rank";

/**
 * Known policy misses. Baseline is the 0.78 similarity cutoff. Flags-on is
 * the guaranteed-candidate selector. A heading is pinned when the question
 * already contains that heading's words. Haiku is not called.
 *
 * "Client Service Must-See Behaviors" is not a heading in the checked-in
 * policy fixture. The chunk below is synthetic so the selector can be measured.
 * Production returns it only when a chunk with that heading is indexed.
 */

const CASES: { readonly query: string; readonly section: string }[] = [
  { query: "what is the late opening policy", section: "Late Opening" },
  { query: "client service must-see behaviors", section: "Client Service Must-See Behaviors" },
  { query: "cell phone on the floor during a tan", section: "Cell Phone/Smart Watch Policy" },
];

function row(section: string, similarity: number, vectorRank: number): RecallCandidate {
  const chunk: MatchedChunkRow = {
    chunk_id: section,
    document_id: "manual",
    document_title: "JBA Policy Manual",
    category: "policies",
    locator: section,
    page: 1,
    section,
    content: "Synthetic policy wording.",
    similarity,
  };
  return { row: chunk, vectorRank, keywordRank: null, sectionExact: false };
}

function pool(wanted: string): RecallCandidate[] {
  return [
    row("Standards of Conduct", 0.91, 1),
    row(wanted, 0.55, 2),
    row("Dress Code for The Company", 0.86, 3),
    row("Open Door Policy", 0.84, 4),
    row("Safety in the Workplace", 0.8, 5),
  ];
}

function baseline(candidates: readonly RecallCandidate[], k: number): MatchedChunkRow[] {
  return candidates
    .map((candidate) => candidate.row)
    .filter((item) => item.similarity >= 0.78)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

function flagsOn(query: string, candidates: readonly RecallCandidate[], k: number): MatchedChunkRow[] {
  const selected = selectRecallCandidates(candidates, expandGlossaryQuery(query), { limit: k });
  return applyRerank(selected.rows, selected.pinnedIds, selected.pinnedIds);
}

function recall(rows: readonly MatchedChunkRow[], section: string, k: number): number {
  return rows.slice(0, k).some((item) => item.section === section) ? 1 : 0;
}

describe("retrieval recall", () => {
  const table = CASES.map((item) => {
    const candidates = pool(item.section);
    return {
      query: item.query,
      section: item.section,
      baselineAt4: recall(baseline(candidates, 4), item.section, 4),
      flagsOnAt4: recall(flagsOn(item.query, candidates, 4), item.section, 4),
    };
  });

  it("raises recall@4 for the known misses", () => {
    expect(table).toHaveLength(3);
    for (const item of table) {
      expect(item.baselineAt4, item.query).toBe(0);
      expect(item.flagsOnAt4, item.query).toBe(1);
    }
  });

  it("lets a rerank that finds nothing drop an unnamed nearest chunk", () => {
    const candidates = pool("Late Opening");
    const selected = selectRecallCandidates(candidates, "what is the weather in paris", { limit: 4 });
    expect(selected.pinnedIds).toEqual([]);
    expect(applyRerank(selected.rows, [], [])).toEqual([]);
    expect(baseline(candidates, 4).length).toBeGreaterThan(0);
  });

  it("matches a parking-lot heading by a shared word and not by a lookalike number", () => {
    expect(sectionFuzzyMatches("where is the parking lot", "Employee Parking")).toBe(true);
    expect(sectionFuzzyMatches("what is the tardiness rule", "Attendance")).toBe(false);
    expect(expandGlossaryQuery("the parking lot rules")).toBe("the parking lot rules");
  });
});
