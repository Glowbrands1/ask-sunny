import { describe, expect, it } from "vitest";

import { JBA_MANUAL_CHUNKS } from "@/lib/ai/__fixtures__/jba-policy-manual";
import { expandGlossaryQuery } from "@/lib/ai/glossary";
import { applyRerank } from "@/lib/ai/retrieval-rerank";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import { selectRecallCandidates, type RecallCandidate } from "@/lib/knowledge/recall-rank";

import { citedSections, withMappedPolicy } from "./violation-policy";

/**
 * A phrase is not mapped onto a section title. The glossary no longer
 * attaches a manual section to a form. A question that already contains
 * the heading's own words can still pin that heading in recall.
 *
 * "Client Service Must-See Behaviors" is not a heading in the checked-in
 * manual fixture. The dress-code body is not in that fixture either.
 */

const PROPOSAL = "I'll draft a **Corrective Action Form**.\n\nCreate the draft here when you're ready.";

const DRESS: ManualChunk = {
  chunkIndex: 900,
  page: 16,
  printedPage: 15,
  section: "Dress Code for The Company",
  content: "Dress Code for The Company\nSynthetic policy wording, dress.",
};

const MUST_SEE: ManualChunk = {
  chunkIndex: 901,
  page: 40,
  section: "Client Service Must-See Behaviors",
  content: "Client Service Must-See Behaviors\nSynthetic policy wording, service.",
};

const CHUNKS: readonly ManualChunk[] = [...JBA_MANUAL_CHUNKS, DRESS, MUST_SEE];

const PHRASES = [
  "CA for cleaning duties not completed",
  "verbal CA for missing the 10/15 woven deadline",
  "new hire didn't complete policy acknowledgments",
  "she was tardy again",
  "the salon opened late",
  "add dress code policy too",
  "insubordination",
  "cell phone on the floor",
] as const;

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
    row("Open Door Policy", 0.91, 1),
    row(wanted, 0.55, 2),
    row("Safety in the Workplace", 0.86, 3),
    row("Visitors in the Workplace", 0.84, 4),
    row("Smoking/Vaping", 0.8, 5),
  ];
}

function baseline(candidates: readonly RecallCandidate[]): boolean {
  return candidates.some((candidate) => candidate.row.similarity >= 0.78 && candidate.row.section === candidates[1]?.row.section);
}

function flagsOnHit(query: string, wanted: string): boolean {
  const selected = selectRecallCandidates(pool(wanted), expandGlossaryQuery(query), { limit: 4 });
  const ranked = applyRerank(selected.rows, selected.pinnedIds, selected.pinnedIds);
  return ranked.slice(0, 4).some((item) => item.section === wanted);
}

describe("violation to policy section", () => {
  it("does not attach a section from a phrase", () => {
    for (const phrase of PHRASES) {
      expect(citedSections([phrase]), phrase).toEqual([]);
      expect(withMappedPolicy(PROPOSAL, [phrase], CHUNKS, true), phrase).toBe(PROPOSAL);
    }
  });

  it("pins a heading the question itself names", () => {
    expect(baseline(pool("Client Service Must-See Behaviors"))).toBe(false);
    expect(flagsOnHit("client service must-see behaviors", "Client Service Must-See Behaviors")).toBe(true);
    expect(flagsOnHit("what is the dress code policy", "Dress Code for The Company")).toBe(true);
    expect(flagsOnHit("CA for cleaning duties not completed", "Standards of Conduct")).toBe(false);
  });

  it("does not invent a passage the fixture does not hold", () => {
    expect(
      JBA_MANUAL_CHUNKS.some((chunk) => chunk.section === "Client Service Must-See Behaviors"),
    ).toBe(false);
    expect(
      JBA_MANUAL_CHUNKS.some(
        (chunk) =>
          chunk.section === "Dress Code for The Company" &&
          chunk.content.includes("Dress Code for The Company"),
      ),
    ).toBe(false);
  });
});
